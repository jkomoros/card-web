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
};

export type CorpusSnapshot = CorpusSnapshotV1 | CorpusSnapshotV2;

const DB_NAME = 'corpus-worker-snapshot';
const STORE_NAME = 'snapshots';
const SCHEMA_VERSION = 2;

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
	request.onsuccess = () => resolve(request.result);
	request.onerror = () => reject(request.error);
});

export const validCorpusSnapshot = (value : unknown) : value is CorpusSnapshot => {
	if (!value || typeof value !== 'object') return false;
	const snapshot = value as Partial<CorpusSnapshot>;
	const baseValid = (snapshot.schemaVersion === 1 || snapshot.schemaVersion === SCHEMA_VERSION) &&
		Boolean(snapshot.cards && typeof snapshot.cards === 'object' && !Array.isArray(snapshot.cards)) &&
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

export class CorpusSnapshotStore {

	_key : string;
	_db : Promise<IDBDatabase> | null;

	constructor(key : string) {
		this._key = key;
		this._db = null;
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
	async save(cards : {[id : string] : unknown}, clientClockCardIDs : string[], processedTombstoneIDs : string[], tombstoneCursor : WireTimestamp | null, watermarkClamp : WireTimestamp | null) : Promise<void> {
		const snapshot : CorpusSnapshotV2 = {
			schemaVersion: SCHEMA_VERSION,
			cards,
			clientClockCardIDs: [...clientClockCardIDs],
			processedTombstoneIDs: [...processedTombstoneIDs],
			tombstoneCursor: tombstoneCursor ? {...tombstoneCursor} : null,
			watermarkClamp: watermarkClamp ? {...watermarkClamp} : null,
			savedAt: Date.now()
		};
		const database = await this._database();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, 'readwrite');
			transaction.objectStore(STORE_NAME).put(snapshot, this._key);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
}
