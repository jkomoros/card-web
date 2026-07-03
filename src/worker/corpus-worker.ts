//The corpus worker: owns a Firestore SDK instance and (eventually) the full
//card corpus + search index + query engine, keeping all O(corpus) work off
//the UI thread. See docs/fast-corpus-design-doc.md (Plan B) and
//docs/fast-corpus-implementation-log.md.
//
//IMPORTANT: this module must never import src/firebase.ts (it touches window
//at module load) or anything that assumes a DOM. It initializes its own
//Firebase app; auth comes from the credential the main thread persisted to
//IndexedDB during interactive sign-in.

import {
	initializeApp,
	FirebaseApp
} from 'firebase/app';

import {
	initializeFirestore,
	persistentLocalCache,
	onSnapshot,
	getDocs,
	query,
	collection,
	where,
	documentId,
	Firestore,
	QuerySnapshot,
	Timestamp
} from 'firebase/firestore';

import {
	initializeAuth,
	indexedDBLocalPersistence,
	Auth
} from 'firebase/auth';

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG
} from '../config.GENERATED.SECRET.js';

import {
	normalizedWords,
	stemmedNormalizedWords,
	withoutStopWords,
	ngrams
} from '../../shared/nlp.js';

import {
	Card,
	Cards,
	CardID,
	CardFetchType
} from '../types.js';

import {
	MainToWorkerMessage,
	WorkerToMainMessage,
	WorkerGeneration,
	searchTokensForCard
} from './worker-protocol.js';

import {
	SearchIndex
} from './search-index.js';

import {
	QueryEngine
} from './query-engine.js';

import {
	SomeAction
} from '../actions.js';

import {
	toWire,
	fromWire
} from './wire-format.js';

//The name of the cards collection; mirrored from src/actions/database.ts
//(not imported: that module pulls in the store and DOM-touching deps).
const CARDS_COLLECTION = 'cards';

//Mirrored from src/actions/database.ts — permission key for editor listeners.
const PERMISSION_EDIT_CARD = 'editCard';

//How long ingestion batches accumulate before being flushed to the main
//thread during the initial load (mirrors A4's boot coalescing).
const COALESCE_INTERVAL_MS = 750;

//Narrow view of the dedicated-worker global scope, to avoid needing the
//"webworker" tsconfig lib (which conflicts with "dom" in the same program).
const workerScope = globalThis as unknown as {
	postMessage: (message : WorkerToMainMessage) => void,
	addEventListener: (type : 'message', listener : (event : {data : MainToWorkerMessage}) => void) => void,
};

let app : FirebaseApp | null = null;
let db : Firestore | null = null;
let auth : Auth | null = null;

let generation : WorkerGeneration = 0;
//Internal connection generation, bumped on every (re)connect to invalidate
//in-flight partition fetches (mirrors unpublishedConnectionGeneration).
let connectionGeneration = 0;

const corpus : Map<CardID, Card> = new Map();
const index = new SearchIndex();
const engine = new QueryEngine();
let cardsWithStoredTokens = 0;
let indexBuildMs = 0;

const unsubscribes : (() => void)[] = [];

const send = (message : WorkerToMainMessage) => workerScope.postMessage(message);

const status = (message : string) => send({type: 'status', generation, message});

const isTimestamp = (value : unknown) : boolean => value instanceof Timestamp;
const getTime = (timestamp : unknown) => {
	const ts = timestamp as Timestamp;
	return {seconds: ts.seconds, nanoseconds: ts.nanoseconds};
};

//Fields stored on the doc for server-side querying only; stripped before
//forwarding to the main thread (mirrors stripEphemeralCardFields in
//src/util.ts). The worker keeps the tokens for its own index first.
const stripForWire = (card : Card) : Card => {
	if (!('nlp_search_tokens' in card)) return card;
	const result = {...card};
	delete result.nlp_search_tokens;
	return result;
};

const parseSnapshot = (snapshot : QuerySnapshot) : {cards : Cards, removedIDs : CardID[]} => {
	const cards : Cards = {};
	const removedIDs : CardID[] = [];
	snapshot.docChanges().forEach(change => {
		if (change.type === 'removed') {
			removedIDs.push(change.doc.id);
			return;
		}
		const id : CardID = change.doc.id;
		const card : Card = {...change.doc.data({serverTimestamps: 'estimate'}), id} as Card;
		cards[id] = card;
	});
	return {cards, removedIDs};
};

const updateLocalState = (cards : Cards, removedIDs : CardID[]) => {
	const indexStart = performance.now();
	for (const [id, card] of Object.entries(cards)) {
		const previous = corpus.get(id);
		if (previous && searchTokensForCard(previous).length) cardsWithStoredTokens--;
		corpus.set(id, card);
		const tokens = searchTokensForCard(card);
		if (tokens.length) {
			cardsWithStoredTokens++;
			index.updateCard(id, tokens);
		} else {
			index.removeCard(id);
		}
	}
	for (const id of removedIDs) {
		corpus.delete(id);
		index.removeCard(id);
	}
	//The engine keeps its own plain-object mirror (identity-preserving per
	//card) plus filter membership via the real reducer. Strip the ephemeral
	//search tokens just like main-thread Redux does, so processing and filter
	//behavior match exactly.
	engine.updateCards(Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, stripForWire(card)])), removedIDs);
	indexBuildMs += performance.now() - indexStart;
};

const forwardBatch = (cards : Cards, removedIDs : CardID[], fetchType : CardFetchType, fastDedupe : boolean) => {
	const wireCards = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, toWire(stripForWire(card), isTimestamp, getTime)])) as Cards;
	send({
		type: 'cards',
		generation,
		batch: {cards: wireCards, removedIDs, fetchType, fastDedupe}
	});
};

//Ingests a snapshot: updates worker-local corpus/index and forwards the batch
//to the main thread. Empty batches are forwarded too — the main thread's
//UPDATE_CARDS clears loading indicators for the fetchType even with no cards,
//matching the behavior of a main-thread listener receiving an empty snapshot.
const ingestSnapshot = (snapshot : QuerySnapshot, fetchType : CardFetchType, fastDedupe = false) => {
	const start = performance.now();
	const {cards, removedIDs} = parseSnapshot(snapshot);
	updateLocalState(cards, removedIDs);
	const count = Object.keys(cards).length;
	forwardBatch(cards, removedIDs, fetchType, fastDedupe);
	if (count || removedIDs.length) {
		status(`ingested ${count} cards (${removedIDs.length} removed, ${fetchType}) in ${(performance.now() - start).toFixed(1)}ms; corpus=${corpus.size}`);
	}
};

//A listener that errors (e.g. permission denied for anonymous users on
//author/editor queries) will never deliver a snapshot; forward an empty batch
//so the main thread's loading indicators clear rather than spinning forever.
const listenerError = (fetchType : CardFetchType, context : string) => (error : {message : string}) => {
	send({type: 'error', generation, message: `${context}: ${error.message}`});
	forwardBatch({}, [], fetchType, false);
};

const teardownListeners = () => {
	connectionGeneration++;
	for (const unsubscribe of unsubscribes) unsubscribe();
	unsubscribes.length = 0;
};

const connectFirebase = (devMode : boolean) => {
	if (app) return;
	const config = devMode ? FIREBASE_DEV_CONFIG : FIREBASE_PROD_CONFIG;
	app = initializeApp(config, 'corpus-worker');
	//The main thread signs in interactively and persists the credential to
	//IndexedDB; initializeAuth here picks it up and receives refreshes.
	auth = initializeAuth(app, {persistence: indexedDBLocalPersistence});
	//NOTE: deliberately NOT persistentMultipleTabManager for now — multi-tab
	//coordination from inside a worker is the open Stage-B0 question; the
	//single-tab default is the documented fallback. The main thread's own
	//Firestore instance keeps using the multi-tab persistent cache.
	db = initializeFirestore(app, {
		experimentalForceLongPolling: true,
		localCache: persistentLocalCache({})
	});
};

const connectPublished = () => {
	if (!db) return;
	unsubscribes.push(onSnapshot(
		query(collection(db, CARDS_COLLECTION), where('published', '==', true)),
		snapshot => ingestSnapshot(snapshot, 'published'),
		listenerError('published', 'published listener')
	));
	status('published listener attached');
};

//Mirrors the partitioned unpublished fetch in src/actions/database.ts:
//parallel getDocs by document-ID range (a single query on 38k+ docs hits the
//~60s Firestore timeout), coalesced into batched forwards, then a full
//onSnapshot whose initial delivery is flagged for fast dedupe.
const connectUnpublishedPrivileged = async () => {
	if (!db) return;
	const database = db;
	const myConnectionGeneration = connectionGeneration;

	const PARTITIONS = [
		{ gte: '', lt: 'c-2' },
		{ gte: 'c-2', lt: 'c-4' },
		{ gte: 'c-4', lt: 'c-6' },
		{ gte: 'c-6', lt: 'c-8' },
		{ gte: 'c-8', lt: '' },
	];

	const pendingCards : Cards = {};
	let flushTimeout : ReturnType<typeof setTimeout> | null = null;
	const flushPending = () => {
		if (flushTimeout) {
			clearTimeout(flushTimeout);
			flushTimeout = null;
		}
		if (myConnectionGeneration !== connectionGeneration) return;
		const ids = Object.keys(pendingCards);
		if (ids.length === 0) return;
		const cards = {...pendingCards};
		for (const id of ids) delete pendingCards[id];
		updateLocalState(cards, []);
		forwardBatch(cards, [], 'unpublished', false);
		status(`flushed ${ids.length} coalesced unpublished cards; corpus=${corpus.size}`);
	};

	const startTime = performance.now();
	try {
		const partitionPromises = PARTITIONS.map(async (partition) => {
			const partitionQuery = partition.gte
				? query(collection(database, CARDS_COLLECTION),
					where('published', '==', false),
					where(documentId(), '>=', partition.gte),
					where(documentId(), '<', partition.lt))
				: query(collection(database, CARDS_COLLECTION),
					where('published', '==', false),
					where(documentId(), '<', partition.lt));
			const snapshot = await getDocs(partitionQuery);
			if (myConnectionGeneration !== connectionGeneration) return 0;
			if (snapshot.size > 0) {
				const {cards} = parseSnapshot(snapshot);
				Object.assign(pendingCards, cards);
				if (!flushTimeout) flushTimeout = setTimeout(flushPending, COALESCE_INTERVAL_MS);
			}
			return snapshot.size;
		});
		const sizes = await Promise.all(partitionPromises);
		if (myConnectionGeneration !== connectionGeneration) return;
		flushPending();
		status(`unpublished getDocs complete: ${sizes.reduce((a, b) => a + b, 0)} cards in ${(performance.now() - startTime).toFixed(0)}ms`);
	} catch (e) {
		flushPending();
		send({type: 'error', generation, message: `unpublished getDocs: ${String(e)}`});
	}

	if (myConnectionGeneration !== connectionGeneration) return;
	let firstDelivery = true;
	unsubscribes.push(onSnapshot(
		query(collection(database, CARDS_COLLECTION), where('published', '==', false)),
		snapshot => {
			const fastDedupe = firstDelivery;
			firstDelivery = false;
			ingestSnapshot(snapshot, 'unpublished', fastDedupe);
		},
		listenerError('unpublished', 'unpublished listener')
	));
	status('unpublished listener attached');
};

const connectUnpublishedAuthorEditor = (uid : string) => {
	if (!db || !uid) return;
	unsubscribes.push(onSnapshot(
		query(collection(db, CARDS_COLLECTION), where('author', '==', uid), where('published', '==', false)),
		snapshot => ingestSnapshot(snapshot, 'unpublished-author'),
		listenerError('unpublished-author', 'unpublished-author listener')
	));
	unsubscribes.push(onSnapshot(
		query(collection(db, CARDS_COLLECTION), where('permissions.' + PERMISSION_EDIT_CARD, 'array-contains', uid), where('published', '==', false)),
		snapshot => ingestSnapshot(snapshot, 'unpublished-editor'),
		listenerError('unpublished-editor', 'unpublished-editor listener')
	));
	status('author/editor listeners attached');
};

const connectCards = (mayViewUnpublished : boolean, uid : string) => {
	teardownListeners();
	connectPublished();
	if (mayViewUnpublished) {
		connectUnpublishedPrivileged();
	} else if (uid) {
		connectUnpublishedAuthorEditor(uid);
	}
};

const spike = () => {
	send({
		type: 'spikeReport',
		generation,
		report: {
			cardCount: corpus.size,
			tokenCount: index.tokenCount,
			indexedCardCount: index.cardCount,
			cardsWithStoredTokens,
			indexBuildMs: Math.round(indexBuildMs * 10) / 10,
			authUid: auth?.currentUser?.uid || null,
			firestoreSource: 'unknown'
		}
	});
};

//Tokenize a query string the same way nlp_search_tokens are generated at save
//time: stemmed, stop-word-free unigrams plus bigrams.
const queryTokens = (text : string) : string[] => {
	const normalized = withoutStopWords(stemmedNormalizedWords(normalizedWords(text)));
	if (!normalized) return [];
	const unigrams = normalized.split(' ').filter(word => Boolean(word));
	return [...unigrams, ...ngrams(normalized, 2)];
};

const runQuery = (id : number, text : string) => {
	const start = performance.now();
	const tokens = queryTokens(text);
	const candidates = index.candidates(tokens);
	const ms = performance.now() - start;
	send({
		type: 'queryResult',
		generation,
		id,
		ids: candidates ? [...candidates] : [],
		ms: Math.round(ms * 100) / 100,
		fullScanFallback: candidates === null
	});
};

workerScope.addEventListener('message', event => {
	const message = event.data;
	switch (message.type) {
	case 'connect':
		generation = message.generation;
		connectFirebase(message.devMode);
		connectCards(message.mayViewUnpublished, message.uid);
		break;
	case 'reconnect':
		generation = message.generation;
		connectCards(message.mayViewUnpublished, message.uid);
		break;
	case 'spike':
		spike();
		break;
	case 'query':
		runQuery(message.id, message.text);
		break;
	case 'action':
		engine.applyAction(fromWire(message.action, (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds)) as SomeAction);
		break;
	case 'configureCollections':
		engine.configureCollections(message.fallbacks, message.startCards);
		break;
	case 'shadowCollection': {
		const start = performance.now();
		try {
			const result = engine.runCollection(message.description, {
				keyCardID: message.keyCardID,
				uid: message.uid,
				randomSalt: message.randomSalt,
				cardSimilarity: message.cardSimilarity
			});
			send({
				type: 'shadowCollectionResult',
				generation,
				id: message.id,
				ids: result.ids,
				labels: result.labels,
				numCards: result.numCards,
				isFallback: result.isFallback,
				preview: result.preview,
				ms: Math.round((performance.now() - start) * 10) / 10
			});
		} catch (e) {
			send({type: 'error', generation, message: `shadowCollection(${message.description}): ${String(e)}`});
		}
		break;
	}
	}
});

send({type: 'ready', generation});
