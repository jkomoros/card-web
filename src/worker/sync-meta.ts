//Worker-owned IndexedDB store for delta-sync state that is NOT derivable
//from the card corpus itself (docs/corpus-sync-design.md §3 sync-meta).
//localStorage doesn't exist in workers, and the Firestore cache's internals
//are opaque — this is a tiny purpose-built store. All writes are best-effort
//and strictly AFTER the corresponding ingest/forward (persist-late is safe:
//an over-old cursor just re-reads a few docs; persist-early could skip
//data).

import {
	WireTimestamp
} from './watermark.js';

export type SyncMeta = {
	//The greatest tombstone `deleted` timestamp fully processed (removed +
	//laundered). Tombstones older than this are never re-fetched.
	tombstoneCursor : WireTimestamp | null,
	//Tombstoned card IDs whose cache-laundering getDocFromServer hasn't
	//confirmed yet: re-suppressed at prime time so a ghost can't resurface
	//from the (client-unpurgeable) SDK cache between boots.
	processedTombstoneIDs : string[],
	//Cold-load progress (Phase 2): resumable cursor + per-day read budget.
	coldLoad : {
		cursorUpdated : WireTimestamp,
		cursorDocID : string,
		readsToday : number,
		day : string
	} | null,
	schemaVersion : 1
};

const EMPTY_META : SyncMeta = {
	tombstoneCursor: null,
	processedTombstoneIDs: [],
	coldLoad: null,
	schemaVersion: 1
};

const DB_NAME = 'corpus-worker-meta';
const STORE_NAME = 'sync';

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

export class SyncMetaStore {

	//Key scopes the state to a (project, uid, privilege) world; a reconnect
	//under different parameters reads different state.
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

	async load() : Promise<SyncMeta> {
		try {
			const database = await this._database();
			return await new Promise<SyncMeta>((resolve) => {
				const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(this._key);
				request.onsuccess = () => {
					const value = request.result as SyncMeta | undefined;
					resolve(value && value.schemaVersion === 1 ? value : {...EMPTY_META});
				};
				request.onerror = () => resolve({...EMPTY_META});
			});
		} catch {
			//A wiped/broken meta DB only costs re-reading old tombstones
			//(pruned at ~90 days ⇒ tens of docs) and restarting any cold load.
			return {...EMPTY_META};
		}
	}

	async save(meta : SyncMeta) : Promise<void> {
		try {
			const database = await this._database();
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(STORE_NAME, 'readwrite');
				transaction.objectStore(STORE_NAME).put(meta, this._key);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		} catch {
			//Best effort; see class comment.
		}
	}
}
