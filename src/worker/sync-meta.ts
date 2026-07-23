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
	//Cold-sweep progress (FAST COLD BOOT): per-partition resumable cursors,
	//index-aligned with UNPUBLISHED_CARD_PARTITIONS. Replaces the retired
	//daily-budget cursor (an old persisted `coldLoad` value is simply
	//ignored and the sweep restarts — pre-ship, dev-only state).
	coldSweep : {
		//max(updated) served by the priority phase: a server-confirmed
		//bound from sweep START, promoted to watermarkClamp on completion.
		startBound : WireTimestamp | null,
		//Last document ID ingested per partition ('' = not started).
		cursors : string[],
		//Whether each partition is exhausted.
		done : boolean[]
	} | null,
	//Pending watermark clamp from a completed sweep, cleared once the delta
	//listener confirms its first server catch-up under it. The parallel sweep pages by documentId,
	//so a doc can be read BEFORE a mid-sweep edit lands on it while
	//max(updated) over the swept corpus advances past that edit — deriving
	//the watermark unclamped could then permanently skip the edit. Clamping
	//to the sweep-start bound keeps the delta listener's no-gap proof; the
	//cost is replaying the handful of edits made during the sweep.
	watermarkClamp : WireTimestamp | null,
	schemaVersion : 1
};

const EMPTY_META : SyncMeta = {
	tombstoneCursor: null,
	processedTombstoneIDs: [],
	coldSweep: null,
	watermarkClamp: null,
	schemaVersion: 1
};

const DB_NAME = 'corpus-worker-meta';
const STORE_NAME = 'sync';

type OwnershipToken = {ownerID : string, epoch : number};

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
					//Spread over EMPTY_META so fields added since the value
					//was persisted (coldSweep, watermarkClamp) default sanely.
					resolve(value && value.schemaVersion === 1 ? {...EMPTY_META, ...value} : {...EMPTY_META});
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
				const store = transaction.objectStore(STORE_NAME);
				const ownerRequest = store.get(`${this._key}:owner`);
				ownerRequest.onsuccess = () => {
					const owner = ownerRequest.result as OwnershipToken | undefined;
					if (owner && owner.ownerID === this._ownership.ownerID && owner.epoch === this._ownership.epoch) {
						store.put(meta, this._key);
					} else {
						transaction.abort();
					}
				};
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
			});
		} catch {
			//Best effort; see class comment.
		}
	}
}
