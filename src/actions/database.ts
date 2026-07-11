import {
	db,
	functions
} from '../firebase.js';

import {
	ThunkSomeAction,
	store
} from '../store.js';

import {
	receiveCards,
	updateSections,
	updateAuthors,
	updateTags,
	removeCards,
	expectUnpublishedCards,
} from './data.js';

import {
	updateMessages,
	updateThreads
} from './comments.js';

import {
	updateStars,
	updateReads,
	updateReadingList
} from './user.js';

import {
	selectUserMayViewApp,
	selectSlugIndex,
	selectLoadingCardFetchTypes,
	selectUserMayViewUnpublished,
	selectUid,
} from '../selectors.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	collection,
	onSnapshot,
	getDocs,
	where,
	query,
	orderBy,
	documentId,
	QuerySnapshot,
	doc,
} from 'firebase/firestore';

import {
	httpsCallable
} from 'firebase/functions';

import {
	DISABLE_CALLABLE_CLOUD_FUNCTIONS
} from '../config.GENERATED.SECRET.js';

import {
	State,
	Slug,
	CommentMessages,
	CommentMessage,
	CommentThreads,
	CommentThread,
	CommentThreadID,
	Uid,
	CardID,
	AuthorsMap,
	Author,
	Cards,
	Card,
	Sections,
	Tags,
	Section,
	CardFetchType
} from '../types.js';

import {
	LegalRequestData,
	LegalResponseData,
} from '../../shared/types.js';

import {
	MESSAGES_COLLECTION,
	THREADS_COLLECTION,
	STARS_COLLECTION,
	READS_COLLECTION,
	READING_LISTS_COLLECTION,
	AUTHORS_COLLECTION,
	CARDS_COLLECTION,
	SECTIONS_COLLECTION,
	TAGS_COLLECTION,
	PERMISSIONS_COLLECTION
} from '../../shared/collection-constants.js';

import {
	STOP_EXPECTING_FETCHED_CARDS,
	UPDATE_USER_PERMISSIONS
} from '../actions.js';

import {
	fetchTypeIsUnpublished,
	stripEphemeralCardFields
} from '../util.js';

import {
	corpusWorkerOwnsCardIngestion,
	corpusWorkerConnectCards
} from '../corpus-bridge.js';

import {
	UNPUBLISHED_CARD_PARTITIONS
} from '../card-partitions.js';

import {
	perfEnabled
} from '../perf.js';

import { TypedObject } from '../../shared/typed_object.js';


const legalCallable = httpsCallable<LegalRequestData, LegalResponseData>(functions, 'legal');

//slugLegal returns an object with {legal: bool, reason: string}
export const slugLegal = async (newSlug : Slug) : Promise<LegalResponseData>  => {

	//First, early reject any slugs we already know exist.
	const slugIndex = selectSlugIndex(store.getState() as State);
	if (slugIndex[newSlug]) {
		return {
			legal: false,
			reason: 'The card with ID ' + slugIndex[newSlug] + ' already has that slug.'
		};
	}

	//TODO: this may technically be wrong; a card we can't see might have the same slug.
	if (DISABLE_CALLABLE_CLOUD_FUNCTIONS) return {legal: true, reason: ''};

	const result = await legalCallable({type:'slug', value:newSlug});
	return result.data;
};

const warmupSlugLegal = (force = false) : void => {
	if (DISABLE_CALLABLE_CLOUD_FUNCTIONS) return;
	if (!force && !userHadActivity) return;
	//Mark that we've already triggered for that activity, and will need new
	//activity to trigger again.
	userHadActivity = false;
	legalCallable({type:'warmup'});
	return;
};

let slugLegalInterval = 0;
const KEEP_WARM_INTERVAL = 2 * 60 * 1000;

let userHadActivity = false;

const userActivity = () => {
	userHadActivity = true;
};

//keepSlugLegalWarm should be called whenever we notice that the user should
//keep slugLegal warm. Repeated calls won't cause it to call extra times.
export const keepSlugLegalWarm = () => {
	//Only start the interval once.
	if (slugLegalInterval) return;
	document.addEventListener('mousemove', userActivity);
	document.addEventListener('keydown', userActivity);
	warmupSlugLegal(true);
	slugLegalInterval = window.setInterval(warmupSlugLegal, KEEP_WARM_INTERVAL);
};



export const connectLiveMessages = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	//Deliberately DO fetch deleted messages, so we can render stubs for them.
	onSnapshot(collection(db, MESSAGES_COLLECTION), snapshot => {
		const messages : CommentMessages = {};
		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const message : CommentMessage = {...doc.data(), id} as CommentMessage;
			messages[id] = message;
		});

		store.dispatch(updateMessages(messages));
	});
};

export const connectLiveThreads = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(query(collection(db, THREADS_COLLECTION), where('deleted', '==', false), where('resolved', '==', false)), snapshot => {
		const threads : CommentThreads = {};
		const threadsToAdd : CommentThreadID[] = [];
		const threadsToRemove : CommentThreadID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
			if (change.type === 'removed') {
				threadsToRemove.push(doc.id);
				return;
			}
			const id = doc.id;
			const thread : CommentThread = {...doc.data(), id} as CommentThread;
			threadsToAdd.push(id);
			threads[id] = thread;
		});
		store.dispatch(updateThreads(threads));
	});
};

let liveStarsUnsubscribe : (() => void) | null = null;
let liveReadsUnsubscribe : (() => void) | null  = null;
let liveReadingListUnsubscribe : (() => void) | null = null;
let livePermissionsUnsubscribe : (() => void) | null = null;

export const disconnectLiveStars = () => {
	if (liveStarsUnsubscribe) {
		liveStarsUnsubscribe();
		liveStarsUnsubscribe = null;
	}
};

export const connectLiveStars = (uid : Uid) => {
	disconnectLiveStars();
	liveStarsUnsubscribe = onSnapshot(query(collection(db, STARS_COLLECTION), where('owner', '==', uid)), snapshot => {
		const starsToAdd : CardID[] = [];
		const starsToRemove : CardID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
			if (change.type === 'removed') {
				starsToRemove.push(doc.data().card);
				return;
			}
			starsToAdd.push(doc.data().card);
		});
		store.dispatch(updateStars(starsToAdd, starsToRemove));
	});
};

export const disconnectLiveReads = () => {
	if (liveReadsUnsubscribe) {
		liveReadsUnsubscribe();
		liveReadsUnsubscribe = null;
	}
};

export const connectLiveReads = (uid : Uid) => {
	disconnectLiveReads();
	liveReadsUnsubscribe = onSnapshot(query(collection(db, READS_COLLECTION), where('owner', '==', uid)),  snapshot => {
		const readsToAdd : CardID[] = [];
		const readsToRemove : CardID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
			if (change.type === 'removed') {
				readsToRemove.push(doc.data().card);
				return;
			}
			readsToAdd.push(doc.data().card);
		});
		store.dispatch(updateReads(readsToAdd, readsToRemove));
	});
};

export const disconnectLiveReadingList = () => {
	if (liveReadingListUnsubscribe) {
		liveReadingListUnsubscribe();
		liveReadingListUnsubscribe = null;
	}
};

export const connectLiveReadingList = (uid : Uid) => {
	disconnectLiveReadingList();
	liveReadingListUnsubscribe = onSnapshot(query(collection(db, READING_LISTS_COLLECTION), where('owner', '==', uid)), snapshot => {
		let list : CardID[] = [];
		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
			if (change.type === 'removed') {
				return;
			}
			list = doc.data().cards;
		});
		store.dispatch(updateReadingList(list));
	});
};

export const disconnectLivePermissions = () => {
	if (livePermissionsUnsubscribe) {
		livePermissionsUnsubscribe();
		livePermissionsUnsubscribe = null;
	}
	// Clear permissions from state when disconnecting
	store.dispatch({
		type: UPDATE_USER_PERMISSIONS,
		permissions: {},
	});
};

export const connectLivePermissions = (uid : Uid) => {
	disconnectLivePermissions();
	livePermissionsUnsubscribe = onSnapshot(doc(db, PERMISSIONS_COLLECTION, uid), snapshot => {
		store.dispatch({
			type: UPDATE_USER_PERMISSIONS,
			//If the snapshot doesn't exist then data() will be undefined, so always return a {}.
			permissions: snapshot.data() || {},
		});
	}, (error) => {
		//Log errors but don't stop trying - onSnapshot will automatically retry when connection is restored
		console.warn('Error fetching permissions, onSnapshot will retry automatically:', error);
	});
};

export const connectLiveAuthors = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(collection(db, AUTHORS_COLLECTION), snapshot => {

		const authors : AuthorsMap = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const author : Author = {...doc.data(), id} as Author;
			authors[id] = author;
		});

		store.dispatch(updateAuthors(authors));

	});
};

const parseCardSnapshot = (snapshot : QuerySnapshot) : {cards : Cards, cardIDsToRemove : CardID[]} => {
	const cards : Cards = {};
	const cardIDsToRemove : CardID[] = [];

	snapshot.docChanges().forEach(change => {
		if (change.type === 'removed') {
			cardIDsToRemove.push(change.doc.id);
			return;
		}
		const doc = change.doc;
		const id : CardID = doc.id;
		//Ensure that timestamps are never null. If this isn't set, then
		//when cards are first created (and other times) they will have null
		//timestamps on some of the updates, an if we read them we'll get
		//confused. Without this you can't open a card immediately for
		//editing for example. See
		//https://medium.com/firebase-developers/the-secrets-of-firestore-fieldvalue-servertimestamp-revealed-29dd7a38a82b
		const card : Card = {...doc.data({serverTimestamps: 'estimate'}), id} as Card;
		cards[id] = stripEphemeralCardFields(card);
	});

	return {cards, cardIDsToRemove};
};

const cardSnapshotReceiver = (fetchType : CardFetchType, options? : {fastDedupe? : boolean}) =>{

	return (snapshot : QuerySnapshot) => {
		const startTime = performance.now();
		const {cards, cardIDsToRemove} = parseCardSnapshot(snapshot);

		const cardCount = Object.keys(cards).length;
		const parseTime = performance.now() - startTime;
		//Gated: these fired on every snapshot for every user (ambient noise);
		//DEBUG_PERF.enable() turns them on.
		if (perfEnabled()) console.log(`[PERF] cardSnapshotReceiver(${fetchType}): parsed ${cardCount} cards in ${parseTime.toFixed(1)}ms`);

		const dispatchStart = performance.now();
		store.dispatch(receiveCards(cards, fetchType, options?.fastDedupe));
		if (cardIDsToRemove.length) store.dispatch(removeCards(cardIDsToRemove, fetchTypeIsUnpublished(fetchType)));
		if (perfEnabled()) console.log(`[PERF] cardSnapshotReceiver(${fetchType}): dispatched in ${(performance.now() - dispatchStart).toFixed(1)}ms (total: ${(performance.now() - startTime).toFixed(1)}ms)`);
	};

};

//NOTE: the main-thread warm-boot prime that used to live here is gone. In
//worker modes the main thread's Firestore uses a MEMORY cache (see
//src/firebase.ts — the worker owns the persistent cache now), so there is
//nothing local to prime from. Warm boots come from the worker's own
//persistent cache instead: one copy, correct permission scoping via the
//worker's own queries, and — unlike the prime — since-deleted cards are
//removed properly because resume-token catch-up delivers real removals.

export const connectLivePublishedCards = () => {
	const state = store.getState() as State;
	if (!selectUserMayViewApp(state)) return;
	if (corpusWorkerOwnsCardIngestion()) {
		//The corpus worker owns the Firestore card listeners; batches arrive
		//via the bridge and are dispatched through the same receiveCards path.
		corpusWorkerConnectCards(selectUserMayViewUnpublished(state), selectUid(state));
		return;
	}
	if (perfEnabled()) console.log('[PERF] connectLivePublishedCards: starting listener');
	if (perfEnabled()) console.time('[PERF] published-cards-first-snapshot');
	let first = true;
	onSnapshot(query(collection(db, CARDS_COLLECTION), where('published', '==', true)), (snapshot) => {
		if (first) { console.timeEnd('[PERF] published-cards-first-snapshot'); first = false; }
		cardSnapshotReceiver('published')(snapshot);
	});
};

let liveUnpublishedCardsForUserAuthorUnsubscribe : (() => void) | null = null;
let liveUnpublishedCardsForUserEditorUnsubscribe : (() => void) | null  = null;
let liveUnpublishedCardsUnsubcribe : (() => void) | null = null;
let unpublishedConnectionGeneration = 0;

const stopExpectingFetchedCards = (fetchType : CardFetchType) : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();
	const loading = selectLoadingCardFetchTypes(state);

	//Nothing to do.
	if (!loading[fetchType]) return;

	dispatch({
		type: STOP_EXPECTING_FETCHED_CARDS,
		fetchType
	});
};

const disconnectLiveUnpublishedCards = () => {
	unpublishedConnectionGeneration++;
	const loading = selectLoadingCardFetchTypes(store.getState() as State);
	for (const key of TypedObject.keys(loading)) {
		store.dispatch(stopExpectingFetchedCards(key));
	}
	if (liveUnpublishedCardsForUserAuthorUnsubscribe) {
		liveUnpublishedCardsForUserAuthorUnsubscribe();
		liveUnpublishedCardsForUserAuthorUnsubscribe = null;
	}
	if (liveUnpublishedCardsForUserEditorUnsubscribe) {
		liveUnpublishedCardsForUserEditorUnsubscribe();
		liveUnpublishedCardsForUserEditorUnsubscribe = null;
	}
	if (liveUnpublishedCardsUnsubcribe) {
		liveUnpublishedCardsUnsubcribe();
		liveUnpublishedCardsUnsubcribe = null;
	}
};

export const connectLiveUnpublishedCards = async () => {
	const state = store.getState() as State;
	if (!selectUserMayViewApp(state)) {
		if (perfEnabled()) console.log('[PERF] connectLiveUnpublishedCards: skipped (user may not view app)');
		return;
	}

	if (corpusWorkerOwnsCardIngestion()) {
		//Clear any loading flags from a previous connection under different
		//permissions (mirrors disconnectLiveUnpublishedCards): e.g. the
		//pre-permission author/editor flags must not stick around after the
		//privileged reconnect stops those listeners.
		const loading = selectLoadingCardFetchTypes(state);
		for (const key of TypedObject.keys(loading)) {
			store.dispatch(stopExpectingFetchedCards(key));
		}
		//Keep the loading indicator semantics; the worker's forwarded batches
		//clear the flags through the normal UPDATE_CARDS path.
		if (selectUserMayViewUnpublished(state)) {
			store.dispatch(expectUnpublishedCards('unpublished'));
		} else if (selectUid(state)) {
			store.dispatch(expectUnpublishedCards('unpublished-author'));
			store.dispatch(expectUnpublishedCards('unpublished-editor'));
		}
		corpusWorkerConnectCards(selectUserMayViewUnpublished(state), selectUid(state));
		return;
	}

	disconnectLiveUnpublishedCards();

	const userMayViewUnpublished = selectUserMayViewUnpublished(state);
	const uid = selectUid(state);
	if (perfEnabled()) console.log(`[PERF] connectLiveUnpublishedCards: mayViewUnpublished=${userMayViewUnpublished}, uid=${uid}`);

	if (userMayViewUnpublished) {
		const connectionGeneration = ++unpublishedConnectionGeneration;
		// Load ALL unpublished cards client-side. Two-phase approach:
		//
		// Phase 1 (paginated getDocs): Fetch all unpublished cards in batches.
		// Firestore has a ~60s server-side timeout (non-configurable) that
		// prevents loading 38k+ docs in a single request, especially with
		// experimentalForceLongPolling. We paginate with orderBy + startAfter
		// + limit, dispatching each batch to Redux as it arrives so the UI
		// populates progressively. getDocs also primes the IndexedDB cache.
		//
		// Phase 2 (onSnapshot): Attach a real-time listener on the full query.
		// Since the cache was primed by getDocs, the initial delivery comes
		// from cache (instant), then the listener watches for live changes.
		//
		// The deepEqualIgnoringTimestamps dedup in receiveCards() prevents
		// redundant Redux dispatches when onSnapshot re-delivers cached cards.
		//
		// On subsequent loads (warm cache), getDocs returns from cache almost
		// instantly, and onSnapshot syncs only deltas from the server.
		store.dispatch(expectUnpublishedCards('unpublished'));

		const unpublishedQuery = query(
			collection(db, CARDS_COLLECTION),
			where('published', '==', false)
		);

		// Phase 1: Parallel getDocs to prime cache and populate Redux.
		// A single getDocs for 38k+ docs takes ~37s per 10k batch due to
		// the experimentalForceLongPolling overhead. Running 5 partitions
		// in parallel (by document ID range) cuts wall-clock time by ~4-5x.
		// The partition table is shared with the corpus worker (which used
		// to carry a drifted copy).
		const PARTITIONS = UNPUBLISHED_CARD_PARTITIONS;

		// Coalesce partition arrivals into batched dispatches: each
		// UPDATE_CARDS dispatch runs the full selector cascade over the
		// whole (growing) cards map, so dispatching once per flush interval
		// instead of once per partition cuts boot-time cascades from
		// partitions+1 to ~2-3, at the cost of up to
		// BOOT_COALESCE_INTERVAL_MS of display latency during boot.
		const BOOT_COALESCE_INTERVAL_MS = 750;
		const pendingBootCards : Cards = {};
		let bootFlushTimeout : ReturnType<typeof setTimeout> | null = null;
		const flushBootCards = () => {
			if (bootFlushTimeout) {
				clearTimeout(bootFlushTimeout);
				bootFlushTimeout = null;
			}
			if (connectionGeneration !== unpublishedConnectionGeneration) return;
			const ids = Object.keys(pendingBootCards);
			if (ids.length === 0) return;
			const cards = {...pendingBootCards};
			for (const id of ids) delete pendingBootCards[id];
			if (perfEnabled()) console.log(`[PERF] flushing ${ids.length} coalesced unpublished cards`);
			store.dispatch(receiveCards(cards, 'unpublished'));
		};
		const enqueueBootSnapshot = (snapshot : QuerySnapshot) => {
			const {cards} = parseCardSnapshot(snapshot);
			Object.assign(pendingBootCards, cards);
			if (!bootFlushTimeout) bootFlushTimeout = setTimeout(flushBootCards, BOOT_COALESCE_INTERVAL_MS);
		};

		if (perfEnabled()) console.time('[PERF] unpublished-getDocs-total');
		try {
			const partitionPromises = PARTITIONS.map(async (partition, i) => {
				const constraints = [
					where('published', '==', false),
					where(documentId(), '>=', partition.gte),
					where(documentId(), '<', partition.lt),
				];
				// Filter out empty gte to avoid querying with >= ''
				const partitionQuery = partition.gte
					? query(collection(db, CARDS_COLLECTION), ...constraints)
					: query(collection(db, CARDS_COLLECTION),
						where('published', '==', false),
						where(documentId(), '<', partition.lt));

					if (perfEnabled()) console.time(`[PERF] unpublished-getDocs-partition-${i}`);
					const snapshot = await getDocs(partitionQuery);
					if (perfEnabled()) console.timeEnd(`[PERF] unpublished-getDocs-partition-${i}`);

					if (connectionGeneration !== unpublishedConnectionGeneration) {
						if (perfEnabled()) console.log(`[PERF] getDocs partition ${i}: ignored stale result`);
						return 0;
					}
					if (snapshot.size > 0) {
						enqueueBootSnapshot(snapshot);
						if (perfEnabled()) console.log(`[PERF] getDocs partition ${i}: ${snapshot.size} cards`);
					}
					return snapshot.size;
				});

				const sizes = await Promise.all(partitionPromises);
				if (connectionGeneration !== unpublishedConnectionGeneration) {
					if (perfEnabled()) console.timeEnd('[PERF] unpublished-getDocs-total');
					if (perfEnabled()) console.log('[PERF] unpublished getDocs complete: ignored stale connection');
					return;
				}
				flushBootCards();
				const totalLoaded = sizes.reduce((a, b) => a + b, 0);
				if (perfEnabled()) console.timeEnd('[PERF] unpublished-getDocs-total');
				if (perfEnabled()) console.log(`[PERF] getDocs complete: ${totalLoaded} unpublished cards across ${PARTITIONS.length} parallel partitions`);
		} catch (e) {
			//Flush whatever did arrive before the failure.
			flushBootCards();
			if (perfEnabled()) console.timeEnd('[PERF] unpublished-getDocs-total');
			console.warn('[PERF] getDocs partitioned fetch failed:', e);
		}

			// Phase 2: Real-time listener for ongoing changes. The initial
			// delivery redelivers everything getDocs just primed, so it uses
			// the fast timestamp-based dedupe; subsequent deltas use the full
			// deep compare.
			if (connectionGeneration !== unpublishedConnectionGeneration) return;
			let firstListenerDelivery = true;
			liveUnpublishedCardsUnsubcribe = onSnapshot(
			unpublishedQuery,
			(snapshot : QuerySnapshot) => {
				const fastDedupe = firstListenerDelivery;
				firstListenerDelivery = false;
				cardSnapshotReceiver('unpublished', {fastDedupe})(snapshot);
			}
		);
		return;
	}

	if (uid) {
		store.dispatch(expectUnpublishedCards('unpublished-author'));
		store.dispatch(expectUnpublishedCards('unpublished-editor'));
		liveUnpublishedCardsForUserAuthorUnsubscribe = onSnapshot(
			query(collection(db, CARDS_COLLECTION), where('author', '==', uid), where('published', '==', false)),
			cardSnapshotReceiver('unpublished-author')
		);
		liveUnpublishedCardsForUserEditorUnsubscribe = onSnapshot(
			query(collection(db, CARDS_COLLECTION), where('permissions.' + PERMISSION_EDIT_CARD, 'array-contains', uid), where('published', '==', false)),
			cardSnapshotReceiver('unpublished-editor')
		);
	}
};

export const connectLiveSections = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	onSnapshot(query(collection(db, SECTIONS_COLLECTION), orderBy('order')), snapshot => {

		const sections : Sections = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const section = {...doc.data(), id} as Section;
			sections[id] = section;
		});

		store.dispatch(updateSections(sections));

	});
};

export const connectLiveTags = () => {
	if (!selectUserMayViewApp(store.getState() as State)) return;
	console.log('[connectLiveTags] Setting up live tags listener');
	onSnapshot(collection(db, TAGS_COLLECTION), snapshot => {

		const tags : Tags = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			const doc = change.doc;
			const id = doc.id;
			const tag = {...doc.data(), id} as Section;
			tags[id] = tag;
		});

		console.log('[connectLiveTags] Received snapshot with', Object.keys(tags).length, 'tag changes');
		store.dispatch(updateTags(tags));

	}, error => {
		console.error('[connectLiveTags] Error in onSnapshot:', error);
	});
};
