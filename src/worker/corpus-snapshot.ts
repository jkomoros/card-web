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
	//Frozen working-notes display titles, [key, title] per card id (see
	//corpus-worker displayTitleFor). Optional: an older record loads without.
	displayTitles? : {[id : string] : [string, string]},
};

export type CorpusSnapshot = CorpusSnapshotV1 | CorpusSnapshotV2;

//On disk the cards are split across part records. Chromium refuses a single
//IndexedDB value above ~127 MiB ("The serialized keys and/or value are too
//large"), and the privileged snapshot of the real corpus crossed it at
//46.5k cards (157 MB serialized): every save failed, and because a failing
//put's error event reaches the transaction before transaction.error is set,
//the failure read as "ownership changed" for a whole rehearsal. The manifest
//at `key` carries everything but the cards plus the part count; parts live at
//`key:cards:<i>`. One readwrite transaction writes manifest and parts (and
//deletes a previous save's surplus parts), so a crash still leaves the
//previous complete snapshot, exactly as the single record did. load()
//reassembles a V2-shaped snapshot, so nothing above this store changes.
export type CorpusSnapshotManifest = Omit<CorpusSnapshotV2, 'cards' | 'schemaVersion'> & {
	schemaVersion : 3,
	cardsParts : number,
	cardsCount : number,
};

//Cards per part. Measured on the DEV export: the mean card serializes to
//~3 KB, the fattest (a hub with 130 KB of inbound-reference mirrors) to
//137 KB, and the 3,000 fattest together to 27 MB. At 2,000 a part the
//realistic ceiling is a ~66 KB AVERAGE within one part before the ~127 MiB
//value limit; the fattest 2,000 real cards are ~18 MB. Cheap count-based
//chunking rather than byte-budgeting, because budgeting would serialize
//every card once more per save. test/corpus-snapshot pins the part size
//against a byte budget on a realistic corpus.
export const SNAPSHOT_CARDS_PER_PART = 2000;
//A manifest claiming more parts than this is corrupt, not large.
const MAX_SNAPSHOT_PARTS = 10000;

const DB_NAME = 'corpus-worker-snapshot';
const STORE_NAME = 'snapshots';
const SCHEMA_VERSION = 2;
const MANIFEST_SCHEMA_VERSION = 3;
const partKey = (key : string, index : number) : string => `${key}:cards:${index}`;
//Every part of a key, whatever the manifest says: cleanup must not depend on
//a manifest that an older build (which knows nothing of parts) may have
//overwritten with a single record, or that a sign-out purge found absent.
const partsRange = (key : string) : IDBKeyRange => IDBKeyRange.bound(`${key}:cards:`, `${key}:cards:\uffff`);

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
		(v2.watermarkClamp === null || validWireTimestamp(v2.watermarkClamp)) &&
		(v2.displayTitles === undefined || (typeof v2.displayTitles === 'object' && v2.displayTitles !== null && !Array.isArray(v2.displayTitles) &&
			Object.values(v2.displayTitles).every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'string')));
};

const validManifest = (value : unknown) : value is CorpusSnapshotManifest => {
	if (!value || typeof value !== 'object') return false;
	const manifest = value as Partial<CorpusSnapshotManifest>;
	if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) return false;
	if (!Number.isInteger(manifest.cardsParts) || (manifest.cardsParts as number) < 0 || (manifest.cardsParts as number) > MAX_SNAPSHOT_PARTS) return false;
	if (!Number.isInteger(manifest.cardsCount) || (manifest.cardsCount as number) < 0) return false;
	//Everything else is validated on the assembled snapshot.
	return true;
};

const validCardsPart = (value : unknown) : value is {[id : string] : unknown} =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

//The key for a scope's snapshot. A PUBLISHED-only record deliberately carries
//no uid: published content is identical for every viewer, so one record serves
//them all, is shared between anonymous visits, and survives the anonymous uid
//churning between sessions. A privileged record is per-user and must never be
//shared.
export type SnapshotScope = 'published' | 'privileged';

//THE ONE DECISION. The key and the card filter below MUST agree: the published
//key is shared and carries no uid, so if anything ever writes privileged cards
//under it, a signed-in user's unpublished cards are handed to the next
//anonymous visitor on that device. Deriving both from this single value is what
//makes that disagreement impossible to express, rather than something a reader
//has to notice — before this, the key came from which code path you were on and
//the filter from a separately-computed boolean.
export const snapshotScopeForSession = (mayViewUnpublished : boolean) : SnapshotScope =>
	mayViewUnpublished ? 'privileged' : 'published';

const describeOwnership = (token : OwnershipToken) : string => `{${token.ownerID ? token.ownerID.slice(0, 8) : '(none)'}, epoch ${token.epoch}}`;

export const corpusSnapshotKey = (projectID : string, uid : string, scope : SnapshotScope) : string =>
	scope === 'published' ? `${projectID}:published` : `${projectID}:${uid}:privileged`;

//True when the key for this scope is SHARED between accounts, which is exactly
//when the contents must be public.
export const snapshotScopeIsShared = (scope : SnapshotScope) : boolean => scope === 'published';

//Whether a card may go into a snapshot at this scope. The published record is
//SHARED, so this is a privacy boundary, not an optimization: a signed-in
//non-privileged user runs author/editor listeners, so their own unpublished
//cards sit in the same corpus, and writing those into the shared record would
//hand them to the next anonymous visitor on the device.
//Takes the SCOPE, not a separately-derived boolean, so it cannot disagree with
//the key that scope produced.
export const snapshotEligibleCard = (card : {published? : boolean}, scope : SnapshotScope) : boolean =>
	scope !== 'published' || Boolean(card.published);

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
				const store = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
				const request = store.get(this._key);
				request.onerror = () => resolve(null);
				request.onsuccess = () => {
					const record = request.result as unknown;
					//A record written before the parts split is complete in itself.
					if (validCorpusSnapshot(record)) { resolve(record); return; }
					if (!validManifest(record)) { resolve(null); return; }
					const manifest = record;
					const cards : {[id : string] : unknown} = {};
					let remaining = manifest.cardsParts;
					let failed = false;
					const finish = () => {
						if (failed) { resolve(null); return; }
						const {cardsParts, cardsCount, ...rest} = manifest;
						void cardsParts;
						const assembled = {...rest, schemaVersion: SCHEMA_VERSION, cards} as CorpusSnapshotV2;
						//A missing or truncated part is a damaged snapshot, not a
						//smaller one: the count pins what the manifest promised.
						resolve(Object.keys(cards).length === cardsCount && validCorpusSnapshot(assembled) ? assembled : null);
					};
					if (remaining === 0) { finish(); return; }
					for (let index = 0; index < manifest.cardsParts; index++) {
						const partRequest = store.get(partKey(this._key, index));
						partRequest.onerror = () => { failed = true; if (--remaining === 0) finish(); };
						partRequest.onsuccess = () => {
							if (validCardsPart(partRequest.result)) Object.assign(cards, partRequest.result);
							else failed = true;
							if (--remaining === 0) finish();
						};
					}
				};
			});
		} catch {
			return null;
		}
	}

	//A single-record put gives generation-pointer semantics for free: a crash
	//before transaction completion leaves the previous complete snapshot, never
	//a half-updated corpus.
	async save(cards : {[id : string] : unknown}, clientClockCardIDs : string[], processedTombstoneIDs : string[], tombstoneCursor : WireTimestamp | null, watermarkClamp : WireTimestamp | null, supplemental? : {sections : {[id : string] : unknown}, tags : {[id : string] : unknown}}, displayTitles? : {[id : string] : [string, string]}) : Promise<void> {
		const ids = Object.keys(cards);
		const parts : {[id : string] : unknown}[] = [];
		for (let start = 0; start < ids.length; start += SNAPSHOT_CARDS_PER_PART) {
			const part : {[id : string] : unknown} = {};
			for (const id of ids.slice(start, start + SNAPSHOT_CARDS_PER_PART)) part[id] = cards[id];
			parts.push(part);
		}
		const manifest : CorpusSnapshotManifest = {
			schemaVersion: MANIFEST_SCHEMA_VERSION,
			cardsParts: parts.length,
			cardsCount: ids.length,
			clientClockCardIDs: [...clientClockCardIDs],
			processedTombstoneIDs: [...processedTombstoneIDs],
			tombstoneCursor: tombstoneCursor ? {...tombstoneCursor} : null,
			watermarkClamp: watermarkClamp ? {...watermarkClamp} : null,
			savedAt: Date.now(),
			...(supplemental ? {sections: supplemental.sections, tags: supplemental.tags} : {}),
			...(displayTitles ? {displayTitles} : {}),
		};
		const database = await this._database();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			const ownerRequest = store.get(`${this._key}:owner`);
			//Name the failure. The DEV rehearsal spent an hour on saves that
			//reported only "ownership changed during the write" while the
			//ownership record matched: a failing put request's error event
			//bubbles to the transaction BEFORE the transaction has aborted,
			//when transaction.error is still null, so rejecting with
			//transaction.error there reads exactly like the deliberate
			//abort of the mismatch branch. Keep the put request's own error,
			//keep a synchronous throw from put (serialization, size), and
			//describe a real mismatch with both tokens; reject once, on abort.
			//First failure wins: once one request fails, IndexedDB fires an
			//AbortError at every request still pending, and recording those
			//would bury the cause (the review showed a mid-part failure
			//reported as a bare AbortError). On abort, transaction.error is
			//also set by then; prefer it when what we hold is only a bystander.
			let failure : unknown = null;
			const noteFailure = (request : IDBRequest) => {
				request.onerror = () => { if (!failure) failure = request.error || new Error('snapshot request failed without an error'); };
			};
			ownerRequest.onsuccess = () => {
				const owner = ownerRequest.result as OwnershipToken | undefined;
				if (owner && owner.ownerID === this._ownership.ownerID && owner.epoch === this._ownership.epoch) {
					try {
						//Every previous part, whatever the manifest said: a
						//legacy single record at `key` is simply overwritten.
						noteFailure(store.delete(partsRange(this._key)));
						parts.forEach((part, index) => noteFailure(store.put(part, partKey(this._key, index))));
						noteFailure(store.put(manifest, this._key));
					} catch (err) {
						failure = err instanceof Error ? err : new Error(String(err));
						transaction.abort();
					}
				} else {
					failure = new Error(`snapshot ownership mismatch for ${this._key}: held ${describeOwnership(this._ownership)}, record ${owner ? describeOwnership(owner) : 'absent'}`);
					transaction.abort();
				}
			};
			noteFailure(ownerRequest);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => { /* the abort that follows carries the cause */ };
			transaction.onabort = () => {
				const bystander = Boolean(failure) && (failure as {name? : string}).name === 'AbortError';
				reject((bystander && transaction.error) || failure || transaction.error || new Error('snapshot transaction aborted'));
			};
		});
	}

	async clear() : Promise<void> {
		try {
			const database = await this._database();
			await new Promise<void>((resolve, reject) => {
				const transaction = database.transaction(STORE_NAME, 'readwrite');
				const store = transaction.objectStore(STORE_NAME);
				//Parts by range, not by the manifest's count: an older build may
				//have replaced the manifest with a single record, and these parts
				//hold the signed-out account's unpublished cards (C11).
				store.delete(partsRange(this._key));
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
