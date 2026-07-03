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
	query,
	collection,
	where,
	Firestore,
	QuerySnapshot
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
	CardID
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

//The name of the cards collection; mirrored from src/actions/database.ts
//(not imported: that module pulls in the store and DOM-touching deps).
const CARDS_COLLECTION = 'cards';

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

const corpus : Map<CardID, Card> = new Map();
const index = new SearchIndex();
let cardsWithStoredTokens = 0;
let indexBuildMs = 0;

let publishedUnsubscribe : (() => void) | null = null;

const send = (message : WorkerToMainMessage) => workerScope.postMessage(message);

const status = (message : string) => send({type: 'status', generation, message});

const ingestSnapshot = (snapshot : QuerySnapshot) => {
	const start = performance.now();
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
	indexBuildMs += performance.now() - indexStart;

	const count = Object.keys(cards).length;
	if (count || removedIDs.length) {
		status(`ingested ${count} cards (${removedIDs.length} removed) in ${(performance.now() - start).toFixed(1)}ms (index share ${(performance.now() - indexStart).toFixed(1)}ms); corpus=${corpus.size}`);
	}
};

const connect = (devMode : boolean) => {
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

	publishedUnsubscribe = onSnapshot(
		query(collection(db, CARDS_COLLECTION), where('published', '==', true)),
		ingestSnapshot,
		error => send({type: 'error', generation, message: `published listener: ${error.message}`})
	);

	status('connected; published listener attached');
};

const teardown = () => {
	if (publishedUnsubscribe) {
		publishedUnsubscribe();
		publishedUnsubscribe = null;
	}
	//SearchIndex has no clear(); remove all cards before clearing the corpus.
	for (const id of [...corpus.keys()]) index.removeCard(id);
	corpus.clear();
	cardsWithStoredTokens = 0;
	indexBuildMs = 0;
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
		connect(message.devMode);
		break;
	case 'reconnect':
		generation = message.generation;
		teardown();
		//Reattach listeners under the new generation. (B0 scope: published
		//only; permission-scoped unpublished listeners arrive with B1.)
		if (db) {
			publishedUnsubscribe = onSnapshot(
				query(collection(db, CARDS_COLLECTION), where('published', '==', true)),
				ingestSnapshot,
				error => send({type: 'error', generation, message: `published listener: ${error.message}`})
			);
		}
		break;
	case 'spike':
		spike();
		break;
	case 'query':
		runQuery(message.id, message.text);
		break;
	}
});

send({type: 'ready', generation});
