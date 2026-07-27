//Durable queue for auxiliary user-scoped writes (stars, reads, reading
//list). The main thread runs on a memory-only Firestore cache (the corpus
//worker owns the persistent one), so the SDK's offline write queue does not
//survive a reload — master's persistent cache used to give these writes
//durability for free. This restores it with the same write-ahead pattern the
//durable card editor uses, scaled down:
//
//  persist intent → attempt → remove on server ack
//  on boot (once signed in) and on the `online` event → replay survivors
//
//Replay safety:
//- Reads are pure set/delete of an own-uid doc: naturally idempotent.
//- Reading-list writes reuse the ORIGINAL audit-doc key carried in the
//  intent, so a replayed batch overwrites its own audit entry.
//- Star writes carry counter increments, which are NOT idempotent — but the
//  original batch is atomic, so on replay the star doc's server existence
//  tells us definitively whether the batch committed; executors preflight
//  that and no-op when the work already landed.
//- Intents in flight in THIS session are skipped by replay: on a same-session
//  reconnect the SDK's own memory queue delivers them, and replaying too
//  would double-apply.
//- Replay is strictly sequential in creation order per uid, so an offline
//  star-then-unstar pair nets correctly.
//
//Comments/threads are NOT queued here (transactional, generated IDs); losing
//an offline comment on reload remains a documented v2.

import {
	CardID,
	Uid
} from './types.js';

export type AuxWriteKind = 'star-add' | 'star-remove' | 'read-add' | 'read-remove' | 'reading-list-add' | 'reading-list-remove';

export type AuxWriteIntent = {
	version: 1,
	id: string,
	uid: Uid,
	kind: AuxWriteKind,
	cardID: CardID,
	//Reading-list audit doc key, captured at intent creation so replays are
	//idempotent; '' for kinds without an audit doc.
	auditKey: string,
	createdAt: number,
	//Cross-tab claim. `inFlight` is per-tab and the `online` event fires in
	//EVERY tab at once, so without a claim visible in shared storage two tabs
	//replay the same intent — and star writes carry increment(+/-1) on the
	//shared card document, so one star became +2. Written before an attempt,
	//cleared on failure, and ignored once stale (a tab can die mid-attempt).
	claimedBy?: string,
	claimedAt?: number,
};

export type AuxWriteExecutor = (intent : AuxWriteIntent, isReplay : boolean) => Promise<void>;

const STORAGE_KEY = 'card-web-pending-aux-writes-v1';
//An intent that has not managed to commit in this long is abandoned: the
//user has long since lost the context, and unbounded retry of ancient
//intents is worse than dropping them.
const MAX_INTENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

//Identifies this tab's claims in shared storage. Not security-relevant; it only
//has to be distinct between concurrent tabs of the same origin.
const TAB_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
//A claim older than this is assumed to belong to a tab that died mid-attempt.
//Generous: an offline-queued write can legitimately take a while to settle.
const CLAIM_STALE_MS = 60 * 1000;

const executors : Partial<Record<AuxWriteKind, AuxWriteExecutor>> = {};
//Keyed by intent id, but holding the INTENT: localStorage read-modify-write is
//not atomic across tabs, so a sibling tab writing from a stale snapshot can
//drop an intent this tab is still working on. Keeping the object lets the
//storage listener below put it back.
const inFlight : Map<string, AuxWriteIntent> = new Map();
let replayRunning = false;
let replayRetryScheduled = false;
//Live uid provider, installed with the watcher. Needed so the replay loop can
//notice a sign-out BETWEEN awaits rather than trusting the uid it started with.
let currentUid : () => Uid = () => '';
let watcherInstalled = false;
let intentCounter = 0;

const validIntent = (value : unknown) : value is AuxWriteIntent => {
	if (!value || typeof value !== 'object') return false;
	const intent = value as AuxWriteIntent;
	return intent.version === 1 && typeof intent.id === 'string' && Boolean(intent.id) &&
		typeof intent.uid === 'string' && Boolean(intent.uid) &&
		typeof intent.kind === 'string' && typeof intent.cardID === 'string' && Boolean(intent.cardID) &&
		typeof intent.auditKey === 'string' && typeof intent.createdAt === 'number';
};

export const readPendingAuxWrites = () : AuxWriteIntent[] => {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const now = Date.now();
		return parsed.filter(validIntent).filter(intent => now - intent.createdAt < MAX_INTENT_AGE_MS);
	} catch {
		//A corrupt record must never wedge stars/reads; these are
		//best-effort writes, unlike card edits.
		return [];
	}
};

const writePendingAuxWrites = (intents : AuxWriteIntent[]) : void => {
	if (typeof localStorage === 'undefined') return;
	try {
		if (intents.length === 0) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, JSON.stringify(intents));
	} catch {
		//Durable storage unavailable: writes degrade to session-only, which
		//is exactly the pre-queue behavior.
	}
};

const removeIntent = (id : string) : void => {
	writePendingAuxWrites(readPendingAuxWrites().filter(intent => intent.id !== id));
};

//Replay order is load-bearing: the module contract is that intents run in
//creation order per uid so an offline star-then-unstar nets correctly. Any
//merge back into storage must therefore re-sort rather than append.
const byCreation = (a : AuxWriteIntent, b : AuxWriteIntent) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const claimIsLive = (intent : AuxWriteIntent, now : number) : boolean =>
	Boolean(intent.claimedBy) && intent.claimedBy !== TAB_ID &&
	typeof intent.claimedAt === 'number' && now - intent.claimedAt < CLAIM_STALE_MS;

//Returns false when another live tab already claimed it.
const claimIntent = (id : string) : boolean => {
	const now = Date.now();
	const current = readPendingAuxWrites();
	const target = current.find(intent => intent.id === id);
	if (!target) return false;
	if (claimIsLive(target, now)) return false;
	writePendingAuxWrites(current.map(intent =>
		intent.id === id ? {...intent, claimedBy: TAB_ID, claimedAt: now} : intent).sort(byCreation));
	return true;
};

const releaseClaim = (id : string) : void => {
	writePendingAuxWrites(readPendingAuxWrites().map(intent => {
		if (intent.id !== id || intent.claimedBy !== TAB_ID) return intent;
		const {claimedBy: _claimedBy, claimedAt: _claimedAt, ...rest} = intent;
		return rest as AuxWriteIntent;
	}).sort(byCreation));
};

export const registerAuxWriteExecutor = (kind : AuxWriteKind, executor : AuxWriteExecutor) : void => {
	executors[kind] = executor;
};

export const makeAuxWriteIntent = (uid : Uid, kind : AuxWriteKind, cardID : CardID, auditKey = '') : AuxWriteIntent => ({
	version: 1,
	id: `${Date.now()}-${++intentCounter}-${Math.random().toString(36).slice(2, 8)}`,
	uid,
	kind,
	cardID,
	auditKey,
	createdAt: Date.now(),
});

//True for errors that will never succeed on retry, so the intent should be
//dropped rather than replayed forever.
const permanentFailure = (error : unknown) : boolean => {
	const code = (error as {code? : string})?.code || '';
	//not-found: the target card was deleted — a retry can never succeed, and
	//because replay stops at the first transient failure, treating it as
	//transient would head-of-line-block every later intent for the uid.
	return code === 'permission-denied' || code === 'invalid-argument' ||
		code === 'not-found' || code === 'failed-precondition';
};

//Persist the intent, then attempt it. On server ack the intent clears; on
//failure it stays queued for replay (unless the failure is permanent). The
//returned promise reports the attempt, but callers need not await it — the
//queue owns completion.
export const runDurableAuxWrite = (intent : AuxWriteIntent) : Promise<void> => {
	const executor = executors[intent.kind];
	if (!executor) return Promise.reject(new Error(`No executor for aux write kind ${intent.kind}`));
	writePendingAuxWrites([...readPendingAuxWrites(), intent]);
	inFlight.set(intent.id, intent);
	return executor(intent, false).then(() => {
		removeIntent(intent.id);
	}).catch(error => {
		//Dropping a user's intent must never be silent: this is the last point
		//at which the write still existed anywhere.
		if (permanentFailure(error)) {
			console.error(`Aux write ${intent.kind} for ${intent.cardID} failed permanently and was DISCARDED:`, error);
			removeIntent(intent.id);
		} else console.warn(`Aux write ${intent.kind} for ${intent.cardID} did not confirm; queued for replay:`, error);
	}).finally(() => {
		inFlight.delete(intent.id);
	});
};

//Replays every surviving intent for the given uid, strictly in order,
//stopping at the first transient failure (offline again). Intents currently
//in flight in this session are the SDK queue's responsibility and are
//skipped.
export const replayPendingAuxWrites = async (uid : Uid) : Promise<void> => {
	//A replay already running for a DIFFERENT uid will notice the switch and
	//break out (see the live-uid check below), but it cannot start this one, so
	//the new account's intents would never replay this page. Let the caller
	//retry once the loop unwinds.
	if (!uid) return;
	if (replayRunning) {
		//At most one deferred retry in flight, or repeated triggers (online +
		//sign-in + a storage event) would pile up timers.
		if (replayRetryScheduled) return;
		replayRetryScheduled = true;
		setTimeout(() => {
			replayRetryScheduled = false;
			void replayPendingAuxWrites(uid);
		}, 250);
		return;
	}
	replayRunning = true;
	try {
		for (const intent of readPendingAuxWrites()) {
			if (intent.uid !== uid || inFlight.has(intent.id)) continue;
			const executor = executors[intent.kind];
			if (!executor) continue;
			//Re-check the LIVE uid between awaits. It was captured once at call
			//time, so a sign-out or account switch mid-replay left the loop
			//committing the old account's intents under new auth — earning
			//permission-denied, which is classified permanent, which DISCARDED
			//them. Reads and reading-list writes have no preflight to save
			//them, unlike stars.
			if (currentUid() !== uid) break;
			//Claim it in shared storage. A sibling tab's `online` handler fires
			//at the same moment as ours, and its `inFlight` set is not ours, so
			//without this both tabs replay the same intent and a single star
			//becomes +2 on the shared card document.
			if (!claimIntent(intent.id)) continue;
			try {
				await executor(intent, true);
				removeIntent(intent.id);
			} catch (error) {
				if (permanentFailure(error)) {
					console.error(`Aux write ${intent.kind} for ${intent.cardID} failed permanently on replay and was DISCARDED:`, error);
					removeIntent(intent.id);
					continue;
				}
				//Transient (likely offline): keep this and everything after
				//it, in order, for the next replay trigger. Release the claim
				//so another tab (or a later replay here) may take it.
				releaseClaim(intent.id);
				break;
			}
		}
	} finally {
		replayRunning = false;
	}
};

//Install the boot/online replay triggers. Call once auth has resolved; the
//uid provider is consulted at each trigger so sign-out stops replays.
export const installAuxWriteReplayWatcher = (uidProvider : () => Uid) : void => {
	currentUid = uidProvider;
	void replayPendingAuxWrites(uidProvider());
	if (watcherInstalled || typeof window === 'undefined') return;
	watcherInstalled = true;
	window.addEventListener('online', () => void replayPendingAuxWrites(uidProvider()));
	//localStorage read-modify-write is not atomic ACROSS TABS: a sibling can
	//read the queue, we can append, and the sibling can then write back its
	//stale snapshot — silently dropping an intent we are still working on,
	//while our own catch handler logs "queued for replay". Restore anything
	//still in flight here that vanished from storage.
	window.addEventListener('storage', event => {
		if (event.key !== STORAGE_KEY || !inFlight.size) return;
		const current = readPendingAuxWrites();
		const present = new Set(current.map(intent => intent.id));
		const dropped = [...inFlight.values()].filter(intent => !present.has(intent.id));
		if (!dropped.length) return;
		console.warn(`Restoring ${dropped.length} in-flight aux write intent(s) dropped by a concurrent tab`);
		//Re-sort: appending at the tail discarded creation order, so a restored
		//[star-add, star-remove] pair could replay as [star-remove, star-add]
		//and leave the card STARRED — the opposite of the user's last action.
		writePendingAuxWrites([...current, ...dropped].sort(byCreation));
	});
};

//Testing hook: clears module state that would otherwise leak between tests.
export const resetAuxWriteQueueForTesting = () : void => {
	for (const key of Object.keys(executors)) delete executors[key as AuxWriteKind];
	inFlight.clear();
	replayRunning = false;
	replayRetryScheduled = false;
	currentUid = () => '';
	watcherInstalled = false;
};
