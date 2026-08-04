//A compact, worker-owned boot snapshot. Firestore's persistent cache is the
//authoritative offline cache, but materializing ~40k documents through its
//query layer takes tens of seconds even when every byte is local. This store
//keeps the already-materialized wire representation in one atomic record so
//a warm worker can serve it with one IndexedDB read.
//
//The snapshot is only a starting point. Callers must still run the tombstone
//catch-up, server count trust gate, and watermark delta listener before
//calling the corpus live.

import {
	WireTimestamp
} from './watermark.js';

type CorpusSnapshotBase = {
	cards : {[id : string] : unknown},
	//Optimistic/pending-write cards may contain client-clock serverTimestamp
	//estimates. Persisting the exclusion set with the cards is essential: those
	//timestamps must never be allowed to advance the next session's watermark.
	clientClockCardIDs : string[],
	//Known cache ghosts must remain suppressed even when the compact snapshot
	//is served before the separate sync-meta database finishes opening.
	//Optional only for the first backward-compatible read of pre-field records.
	processedTombstoneIDs? : string[],
	savedAt : number
};

export type CorpusSnapshotV1 = CorpusSnapshotBase & {
	schemaVersion : 1
};

export type CorpusSnapshotV2 = CorpusSnapshotBase & {
	schemaVersion : 2,
	processedTombstoneIDs : string[],
	//Safety bounds captured atomically with cards. Rolling both back together
	//is conservative: old cursors/clamps only cause extra server replay.
	tombstoneCursor : WireTimestamp | null,
	watermarkClamp : WireTimestamp | null,
	//Sections and tags, carried in the SAME record as the cards.
	//
	//A reader has no Firestore persistence at all — `persist` is false on the
	//reader path, because Firestore inside a worker offers only a single-tab
	//lease and a reader must not contend for it — so moving these listeners into
	//the worker gave a reader nothing offline. This record is the reader's
	//persistence layer, so they belong here beside the cards they navigate.
	//
	//Optional so a record written before this field loads unchanged; an absent
	//value simply means "nothing persisted yet", exactly as before.
	sections? : {[id : string] : unknown},
	tags? : {[id : string] : unknown},
};

export type CorpusSnapshot = CorpusSnapshotV1 | CorpusSnapshotV2;

const DB_NAME = 'corpus-worker-snapshot';
const STORE_NAME = 'snapshots';
const SCHEMA_VERSION = 2;

type OwnershipToken = {ownerID : string, epoch : number};

const validWireTimestamp = (value : unknown) : value is WireTimestamp => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Partial<WireTimestamp>;
	return Number.isInteger(candidate.seconds) && Number.isInteger(candidate.nanoseconds) &&
		(candidate.nanoseconds as number) >= 0 && (candidate.nanoseconds as number) < 1_000_000_000;
};

const openDB = () : Promise<IDBDatabase> => new Promise((resolve, reject) => {
	const request = indexedDB.open(DB_NAME, 1);
	request.onupgradeneeded = () => {
		if (!request.result.objectStoreNames.contains(STORE_NAME)) {
			request.result.createObjectStore(STORE_NAME);
		}
	};
	request.onsuccess = () => {
		//Without this, a deleteDatabase from another context — including the
		//browser's own "Clear site data" — BLOCKS indefinitely, because this
		//worker holds the connection open for the whole session and nothing
		//ever closes it. Yield the connection instead of wedging the browser.
		request.result.onversionchange = () => request.result.close();
		resolve(request.result);
	};
	request.onerror = () => reject(request.error);
	//A blocked open means another context holds an older version open; surface
	//it rather than hanging silently forever.
	request.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
});

export const validCorpusSnapshot = (value : unknown) : value is CorpusSnapshot => {
	if (!value || typeof value !== 'object') return false;
	const snapshot = value as Partial<CorpusSnapshot>;
	const baseValid = (snapshot.schemaVersion === 1 || snapshot.schemaVersion === SCHEMA_VERSION) &&
		Boolean(snapshot.cards && typeof snapshot.cards === 'object' && !Array.isArray(snapshot.cards)) &&
		Object.entries(snapshot.cards || {}).every(([id, card]) => Boolean(id) && Boolean(card) &&
			typeof card === 'object' && !Array.isArray(card) && (card as {id?: unknown}).id === id) &&
		Array.isArray(snapshot.clientClockCardIDs) &&
		snapshot.clientClockCardIDs.every(id => typeof id === 'string') &&
		(snapshot.processedTombstoneIDs === undefined ||
			(Array.isArray(snapshot.processedTombstoneIDs) && snapshot.processedTombstoneIDs.every(id => typeof id === 'string')));
	if (!baseValid) return false;
	if (snapshot.schemaVersion === 1) return true;
	const v2 = snapshot as Partial<CorpusSnapshotV2>;
	return Array.isArray(v2.processedTombstoneIDs) &&
		(v2.tombstoneCursor === null || validWireTimestamp(v2.tombstoneCursor)) &&
		(v2.watermarkClamp === null || validWireTimestamp(v2.watermarkClamp));
};

//The key for a scope's snapshot. A PUBLISHED-only record deliberately carries
//no uid: published content is identical for every viewer, so one record serves
//them all, is shared between anonymous visits, and survives the anonymous uid
//churning between sessions. A privileged record is per-user and must never be
//shared.
export const corpusSnapshotKey = (projectID : string, uid : string, scope : 'published' | 'privileged') : string =>
	scope === 'published' ? `${projectID}:published` : `${projectID}:${uid}:privileged`;

//Whether a card may go into a snapshot at this scope. The published record is
//SHARED, so this is a privacy boundary, not an optimization: a signed-in
//non-privileged user runs author/editor listeners, so their own unpublished
//cards sit in the same corpus, and writing those into the shared record would
//hand them to the next anonymous visitor on the device.
export const snapshotEligibleCard = (card : {published? : boolean}, publishedOnlyScope : boolean) : boolean =>
	!publishedOnlyScope || Boolean(card.published);

export class CorpusSnapshotStore {

	_key : string;
	_db : Promise<IDBDatabase> | null;
	_ownership : OwnershipToken;

	constructor(key : string, ownership : OwnershipToken = {ownerID: '', epoch: 0}) {
		this._key = key;
		this._db = null;
		this._ownership = ownership;
	}

	async claimOwnership() : Promise<boolean> {
		const database = await this._database();
		return new Promise<boolean>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const ownerKey = `${this._key}:owner`;
			const request = store.get(ownerKey);
			let accepted = false;
			request.onsuccess = () => {
				const current = request.result as OwnershipToken | undefined;
				if (!current || current.epoch <= this._ownership.epoch) {
					store.put({...this._ownership}, ownerKey);
					accepted = true;
				}
			};
			transaction.oncomplete = () => resolve(accepted);
			transaction.onerror = () => reject(transaction.error);
		});
	}

	//Tri-state on purpose. Callers use a false answer to STOP the worker as
	//superseded, so an IndexedDB failure must not be reported as false: that
	//self-closes a healthy worker while the page still believes sync is live
	//and still permits saves against a corpus that has silently stopped
	//updating. 'unknown' means "could not determine" — treat as not-superseded.
	async ownsCurrentOwnership() : Promise<boolean | 'unknown'> {
		try {
			const database = await this._database();
			return await new Promise<boolean | 'unknown'>(resolve => {
				const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(`${this._key}:owner`);
				request.onsuccess = () => {
					const owner = request.result as OwnershipToken | undefined;
					resolve(Boolean(owner && owner.ownerID === this._ownership.ownerID && owner.epoch === this._ownership.epoch));
				};
				request.onerror = () => resolve('unknown');
			});
		} catch {
			//A failed open can also mean the cached connection is dead; drop it
			//so the next call reopens instead of failing forever.
			this._db = null;
			return 'unknown';
		}
	}

	_database() : Promise<IDBDatabase> {
		if (!this._db) this._db = openDB();
		return this._db;
	}

	async load() : Promise<CorpusSnapshot | null> {
		try {
			const database = await this._database();
			return await new Promise<CorpusSnapshot | null>((resolve) => {
				const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(this._key);
				request.onsuccess = () => resolve(validCorpusSnapshot(request.result) ? request.result : null);
				request.onerror = () => resolve(null);
			});
		} catch {
			return null;
		}
	}

	//A single-record put gives generation-pointer semantics for free: a crash
	//before transaction completion leaves the previous complete snapshot, never
	//a half-updated corpus.
	async save(cards : {[id : string] : unknown}, clientClockCardIDs : string[], processedTombstoneIDs : string[], tombstoneCursor : WireTimestamp | null, watermarkClamp : WireTimestamp | null, supplemental? : {sections : {[id : string] : unknown}, tags : {[id : string] : unknown}}) : Promise<void> {
		const snapshot : CorpusSnapshotV2 = {
			schemaVersion: SCHEMA_VERSION,
			cards,
			clientClockCardIDs: [...clientClockCardIDs],
			processedTombstoneIDs: [...processedTombstoneIDs],
			tombstoneCursor: tombstoneCursor ? {...tombstoneCursor} : null,
			watermarkClamp: watermarkClamp ? {...watermarkClamp} : null,
			savedAt: Date.now(),
			...(supplemental ? {sections: supplemental.sections, tags: supplemental.tags} : {})
		};
		const database = await this._database();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const ownerRequest = store.get(`${this._key}:owner`);
			ownerRequest.onsuccess = () => {
				const owner = ownerRequest.result as OwnershipToken | undefined;
				if (owner && owner.ownerID === this._ownership.ownerID && owner.epoch === this._ownership.epoch) {
					store.put(snapshot, this._key);
				} else {
					transaction.abort();
				}
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}

	async clear() : Promise<void> {
		try {
			const database = await this._database();
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(STORE_NAME, 'readwrite');
				const store = transaction.objectStore(STORE_NAME);
				store.delete(this._key);
				//Also drop the ownership token. Leaving it behind kept a record
				//keyed to the signed-out account, and a stale epoch there can
				//affect the next session's claim.
				store.delete(`${this._key}:owner`);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		} catch {
			//Best effort on auth revocation; the in-memory corpus is still purged.
		}
	}
}
