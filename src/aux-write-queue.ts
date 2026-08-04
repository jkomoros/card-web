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
//Card creation and comments ARE queued here (C18). They carry a materialized
//write PLAN in `payload` rather than the high-level user intent: the decision
//(which section, what sort order, which slug) is made once, at the moment the
//user acted, and the durable record is the exact set of documents to write.
//Re-deriving those decisions at replay time would need Redux state that may
//not exist yet on a fresh boot. Both are made replay-safe by a client-vended
//id plus a server existence preflight, the same shape star-add uses.

import {
	CardID,
	Uid
} from './types.js';

export type AuxWriteKind = 'star-add' | 'star-remove' | 'read-add' | 'read-remove' | 'reading-list-add' | 'reading-list-remove' | 'card-create' | 'comment-add' | 'comment-edit' | 'comment-delete' | 'card-delete';

//The materialized write plan for the kinds that need more than a cardID.
//Serialized into localStorage, so everything here must be JSON-round-trippable
//— card objects go through persistableCard/restoredPersistedCard, whose
//timestamps become {seconds, nanoseconds}.
export type CardCreatePayload = {
	kind: 'card-create',
	//Wire-format card (see persistableCard). Typed unknown here so this module
	//stays a leaf with no card-type imports.
	card: unknown,
	section: string,
	//Captured at intent creation: the section audit doc key was Date.now(), so
	//a replay would otherwise write a SECOND audit entry for one creation.
	sectionUpdateKey: string,
	//Fork only. The inbound-link mirror updates are a PURE function of the new
	//card (inboundLinksUpdates(id, null, card)), so the executor recomputes
	//them instead of serializing arrayUnion sentinels, which JSON cannot carry.
	deriveInboundLinks?: boolean,
	//Fork only. Tag audit doc keys, captured for the same reason as the
	//section one: they were Date.now().
	tagUpdateKeys?: {[tag : string] : string},
	//Bulk import only. ensureAuthor writes one hot document (authors/{uid}), so
	//doing it per card made an N-card import hammer a single doc N times — past
	//Firestore's ~1 write/sec sustained per-document ceiling. The first intent
	//of a group carries it and the rest skip. Absent means include, so intents
	//persisted before this field still behave correctly.
	skipAuthor?: boolean,
	//The card fields that were serverTimestamp SENTINELS when the user acted.
	//A sentinel is identified by object identity (firebase.ts keeps a registry),
	//so JSON destroys it; without this list the executor could only guess which
	//fields to re-stamp, and `updated_substantive` — the field every `updated/*`
	//collection sorts and buckets on — silently became a client-clock value.
	serverTimestampFields?: string[],
};

export type CommentAddPayload = {
	kind: 'comment-add',
	messageID: string,
	threadID: string,
	message: string,
	//True when this message opens a NEW thread (the transactional path that
	//also increments thread_count), false when it appends to an existing one.
	newThread: boolean,
};

//An edit and a delete are UPDATEs on a document that already exists, so unlike
//comment-add their idempotency cannot come from an existence check — existence
//proves nothing. They carry the text they were composed against and the
//executor compares VALUES, the same reasoning as durable-overwrite-guard.ts.
export type CommentEditPayload = {
	kind: 'comment-edit',
	messageID: string,
	//The new text. Content, not a path — deliberately unvalidated beyond being
	//a string, exactly as comment-add's `message` is.
	message: string,
	//The text this edit was composed AGAINST. Replaying an edit over content
	//written in between would destroy it silently.
	baseMessage: string,
};

export type CommentDeletePayload = {
	kind: 'comment-delete',
	messageID: string,
	//Deleting blanks `message` and nothing keeps the old text, so a delete
	//replayed days later must not erase words written after it was queued.
	baseMessage: string,
};

//Deleting a card writes a tombstone ATOMICALLY with the delete (the watermark
//planes need it, and the rules now require it), removes the card's updates
//subcollection, and clears inbound-reference entries on the cards it pointed
//at. Only the card itself is carried: the inbound-link updates are a pure
//function of it, like the fork's, and the updates subcollection is enumerated
//at execution time rather than at intent time — enumerating it is itself a
//server read, which is exactly what fails in the case this record exists for.
export type CardDeletePayload = {
	kind: 'card-delete',
	//Wire-format card (persistableCard), needed to recompute the inbound-link
	//cleanup and to know whether the card was published.
	card: unknown,
};

export type AuxWritePayload = CardCreatePayload | CommentAddPayload | CommentEditPayload | CommentDeletePayload | CardDeletePayload;

export type AuxWriteIntent = {
	version: 1,
	id: string,
	uid: Uid,
	kind: AuxWriteKind,
	cardID: CardID,
	//Reading-list audit doc key, captured at intent creation so replays are
	//idempotent; '' for kinds without an audit doc.
	auditKey: string,
	//Present only for kinds that carry a write plan; absent on the original
	//six kinds, so previously-persisted records still validate.
	payload?: AuxWritePayload,
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

//v1 stored the whole queue in ONE key, so every mutation was a read-modify-write
//of the entire blob. That had two costs. The perf one is obvious once intents
//carry ~2KB card payloads. The correctness one is worse and is why this layout
//changed: read and write are two separate localStorage operations, so a sibling
//tab can write between them and this tab then overwrites with a snapshot that
//predates it — silently erasing a card the user wrote, with the storage listener
//unable to help because it only guards intents still in THIS tab's inFlight.
//
//v2 gives each intent its own key and keeps a small index for order. The intent
//BODY is immutable from creation to deletion (claims moved to their own key), so
//no tab ever rewrites another tab's body. The index is a hint: the source of
//truth is the set of body keys, recoverable by scanning. An index entry with no
//body reads as removed; a body with no index entry is adopted.
const STORAGE_KEY = 'card-web-pending-aux-writes-v1';
const PREFIX = 'card-web-aux-writes-v2';
const INDEX_KEY = `${PREFIX}-index`;
const bodyKey = (id : string) => `${PREFIX}-i-${id}`;
const claimKey = (id : string) => `${PREFIX}-c-${id}`;
//Consecutive failures, kept out of the intent body so the body stays immutable.
const failureKey = (id : string) => `${PREFIX}-f-${id}`;

//A DETERMINISTIC bug (the card-create executor once opened an atomic group it
//never closed) throws the same codeless error on every attempt. The queue
//classifies codeless as transient and retains — correctly, since it cannot know
//— so the intent retried forever while the UI kept promising it would be
//created when the connection recovered. After this many identical failures,
//say so once instead of promising indefinitely. The intent is RETAINED: the
//user's work is not thrown away just because we cannot currently apply it.
const FAILURES_BEFORE_REPORTING = 4;

const recordFailure = (intent : AuxWriteIntent, error : unknown) : void => {
	if (typeof localStorage === 'undefined') return;
	const message = (error as {message? : string})?.message || String(error);
	let count = 0;
	let alreadyReported = false;
	try {
		const raw = localStorage.getItem(failureKey(intent.id));
		const prior = raw ? JSON.parse(raw) as {count : number, message : string, reported? : boolean} : null;
		//Only a REPEAT of the same error counts; a changing error is progress.
		const sameError = Boolean(prior && prior.message === message);
		count = sameError && prior ? prior.count + 1 : 1;
		//A DIFFERENT error re-arms reporting: it is a new problem, not the one we
		//already told the user about.
		alreadyReported = sameError && Boolean(prior?.reported);
		localStorage.setItem(failureKey(intent.id), JSON.stringify({count, message, reported: alreadyReported}));
	} catch {
		return;
	}
	//Report ONCE per distinct wedged error, at or after the threshold — not on
	//the exact count. Keying on equality meant any reason to skip the report at
	//exactly the threshold silenced it PERMANENTLY, because count 5, 6, 7 ...
	//never matched again. The offline suppression below is exactly such a
	//reason, so the combination lost the report altogether for a user who
	//happened to be offline on the fourth failure.
	if (count < FAILURES_BEFORE_REPORTING || alreadyReported) return;
	//Being merely OFFLINE can reach the threshold across a couple of boots, and
	//telling that user "something is wrong" is both false and alarming. Only
	//report when the browser believes it has a connection. Deferred, NOT
	//cancelled: `reported` stays false, so the next failure while online tells
	//them.
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
	try {
		localStorage.setItem(failureKey(intent.id), JSON.stringify({count, message, reported: true}));
	} catch {
		//If we cannot record that we reported, still report: a duplicate alert is
		//better than a silent wedge.
	}
	console.error(`[aux-write] ${intent.kind} for ${intent.cardID} has failed ${count} times with the same error; it is being kept but is not succeeding:`, message);
	if (typeof window === 'undefined') return;
	const what = DISCARD_LABELS[intent.kind] || `the ${intent.kind} action`;
	window.setTimeout(() => alert(`${what} is not going through — it has failed repeatedly with the same error. Your change is still saved locally and will be retried, but something is wrong: ${message}`), 0);
};

const clearFailures = (id : string) : void => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(failureKey(id));
	} catch {
		//Best effort.
	}
};

type IndexEntry = {id : string, uid : Uid, kind : string, createdAt : number};

const readIndex = () : IndexEntry[] => {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(INDEX_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry : IndexEntry) => entry && typeof entry.id === 'string' && entry.id &&
			typeof entry.uid === 'string' && typeof entry.kind === 'string' && Number.isFinite(entry.createdAt));
	} catch {
		//The index is only a hint; the bodies are the truth. A scan rebuilds it.
		return [];
	}
};

const writeIndex = (entries : IndexEntry[]) : boolean => {
	if (typeof localStorage === 'undefined') return false;
	try {
		if (!entries.length) localStorage.removeItem(INDEX_KEY);
		else localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
		return true;
	} catch (err) {
		console.error('[aux-write] could not persist the queue index:', err);
		return false;
	}
};

//Replay order is load-bearing: intents must run in creation order per uid so an
//offline star-then-unstar nets correctly. The index is kept sorted on insert.
const byCreationEntry = (a : IndexEntry, b : IndexEntry) =>
	a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const indexEntryFor = (intent : AuxWriteIntent) : IndexEntry =>
	({id: intent.id, uid: intent.uid, kind: intent.kind, createdAt: intent.createdAt});

//BODY FIRST, INDEX SECOND. Crashing between them leaves an orphan body, which
//the scan adopts. The reverse order leaves an index entry pointing at nothing.
const persistIntentBody = (intent : AuxWriteIntent) : boolean => {
	if (typeof localStorage === 'undefined') return false;
	try {
		localStorage.setItem(bodyKey(intent.id), JSON.stringify(intent));
		return true;
	} catch (err) {
		console.error('[aux-write] could not persist intent:', err);
		return false;
	}
};

//removeItem cannot fail for quota, so a committed intent can no longer be
//stranded and re-preflighted on every boot — the v1 silent-failure edge is gone
//by construction rather than by checking a boolean.
const deleteIntentKeys = (id : string) : void => {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(bodyKey(id));
		localStorage.removeItem(claimKey(id));
		localStorage.removeItem(failureKey(id));
	} catch {
		//Nothing further to do; the index compaction below will drop it too.
	}
};

const loadIntentBody = (id : string) : AuxWriteIntent | null => {
	if (typeof localStorage === 'undefined') return null;
	let raw : string | null = null;
	try {
		raw = localStorage.getItem(bodyKey(id));
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (!validIntent(parsed)) {
			//One bad body no longer quarantines the other 99.
			quarantineRawQueue(raw, `malformed ${id}`);
			localStorage.removeItem(bodyKey(id));
			return null;
		}
		return parsed;
	} catch (err) {
		if (raw) quarantineRawQueue(raw, String(err));
		try { localStorage.removeItem(bodyKey(id)); } catch { /* best effort */ }
		return null;
	}
};

//The bodies are the truth. Adopt any that the index lost — which is exactly the
//F8 case, where a sibling's stale write dropped an entry we still hold.
const repairIndexFromScan = () : void => {
	if (typeof localStorage === 'undefined') return;
	try {
		const known = new Set(readIndex().map(entry => entry.id));
		const adopted : IndexEntry[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !key.startsWith(`${PREFIX}-i-`)) continue;
			const id = key.slice(`${PREFIX}-i-`.length);
			if (known.has(id)) continue;
			const intent = loadIntentBody(id);
			if (intent) adopted.push(indexEntryFor(intent));
		}
		if (adopted.length) {
			console.warn(`[aux-write] adopted ${adopted.length} queued intent(s) missing from the index`);
			writeIndex([...readIndex(), ...adopted].sort(byCreationEntry));
		}
	} catch {
		//Scanning is best effort; a missing adoption costs a replay, not data.
	}
};


//One-time migration off the single-blob layout. The v1 key is removed LAST, so
//a failure part-way leaves it in place to retry on the next boot.
const migrateLegacyQueue = () : void => {
	if (typeof localStorage === 'undefined') return;
	let raw : string | null = null;
	try {
		//Checked on every read rather than once: a sibling tab running older
		//code, or a restored backup, can write the legacy key at any time.
		raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) { quarantineRawQueue(raw, 'legacy blob is not an array'); localStorage.removeItem(STORAGE_KEY); return; }
		const intents = parsed.filter(validIntent) as AuxWriteIntent[];
		for (const intent of intents) {
			//Claims were part of the body in v1; they belong in their own key.
			const {claimedBy: _by, claimedAt: _at, ...body} = intent;
			if (!persistIntentBody(body as AuxWriteIntent)) return;
		}
		if (!writeIndex([...readIndex(), ...intents.map(indexEntryFor)].sort(byCreationEntry))) return;
		localStorage.removeItem(STORAGE_KEY);
		if (intents.length) console.warn(`[aux-write] migrated ${intents.length} queued intent(s) to the per-intent layout`);
	} catch (err) {
		if (raw) quarantineRawQueue(raw, String(err));
	}
};

//The ~5MB origin budget is shared with card-web-pending-multi-edit-v1 (which
//stores WHOLE cards in oversizedBaseCards), the bulk-tag record, the edit
//draft and the ownership lease. An unbounded queue can starve the edit draft,
//whose loss is also the user's work — so this queue gets a share, not the lot.
const MAX_QUEUE_BYTES = 1_500_000;
//A group must be persisted ENTIRELY before its first attempt (that is what
//makes a stalled import survive), so the peak is the whole group, not a
//steady state. 250 x ~2KB leaves room for a few oversized cards.
const MAX_QUEUED_INTENTS = 250;

const queueByteSize = () : number => {
	if (typeof localStorage === 'undefined') return 0;
	try {
		let total = (localStorage.getItem(INDEX_KEY) || '').length;
		for (const entry of readIndex()) total += (localStorage.getItem(bodyKey(entry.id)) || '').length;
		return total;
	} catch {
		return 0;
	}
};

//Admission control, deliberately NOT eviction for high-value kinds: dropping a
//queued card to make room for a new one trades work the user already did for
//work they are about to do, invisibly.
const groupFitsInQueue = (intents : AuxWriteIntent[]) : {ok : true} | {ok : false, message : string} => {
	const existing = readPendingAuxWrites();
	const count = existing.length + intents.length;
	if (count > MAX_QUEUED_INTENTS) {
		return {ok: false, message: `That is more than can be safely queued offline (${count} of a ${MAX_QUEUED_INTENTS} limit). Do it in smaller batches, or reconnect first.`};
	}
	const bytes = queueByteSize() + intents.reduce((total, intent) => total + JSON.stringify(intent).length, 0);
	if (bytes > MAX_QUEUE_BYTES) {
		return {ok: false, message: `That is more than can be safely queued offline (about ${Math.round(bytes / 1000)}KB of a ${Math.round(MAX_QUEUE_BYTES / 1000)}KB limit). Do it in smaller batches, or reconnect first.`};
	}
	return {ok: true};
};
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
//Null until installed: a direct replayPendingAuxWrites() call (tests, or any
//caller before auth resolves) must still run rather than aborting because the
//default provider reports no user.
let currentUid : (() => Uid) | null = null;
let watcherInstalled = false;
let intentCounter = 0;

//The queue's contents are attacker-writable if the machine is shared or an XSS
//exists, and `kind` flows straight into `executors[intent.kind]` — an unguarded
//lookup on a plain object literal, so `"constructor"` resolves to Object (a
//callable that silently discards the intent) and `"__proto__"` throws and
//head-of-line-blocks the rest of the queue. `cardID` and `auditKey` become
//Firestore path segments, where a '/' would silently retarget the write.
const AUX_WRITE_KINDS : ReadonlySet<string> = new Set<AuxWriteKind>([
	'star-add', 'star-remove', 'read-add', 'read-remove', 'reading-list-add', 'reading-list-remove',
	'card-create', 'comment-add', 'comment-edit', 'comment-delete', 'card-delete'
]);

//Kinds whose intent is meaningless without its plan. Validating this at read
//time keeps a truncated or hand-edited record from reaching an executor that
//would then dereference undefined.
const KINDS_REQUIRING_PAYLOAD : ReadonlySet<string> = new Set<AuxWriteKind>(['card-create', 'comment-add', 'comment-edit', 'comment-delete', 'card-delete']);

const validPayload = (kind : string, payload : unknown) : boolean => {
	if (!KINDS_REQUIRING_PAYLOAD.has(kind)) return payload === undefined;
	if (!payload || typeof payload !== 'object') return false;
	const candidate = payload as AuxWritePayload;
	if (candidate.kind !== kind) return false;
	if (candidate.kind === 'card-create') {
		const tagKeys = candidate.tagUpdateKeys;
		const tagKeysValid = tagKeys === undefined || (
			typeof tagKeys === 'object' && tagKeys !== null && !Array.isArray(tagKeys) &&
			//Both halves become path segments: the tag names a document, the
			//value names the audit doc under it.
			Object.entries(tagKeys).every(([tag, key]) => validPathSegment(tag) && typeof key === 'string' && validPathSegment(key))
		);
		return Boolean(candidate.card) && typeof candidate.card === 'object' &&
			typeof candidate.section === 'string' &&
			(candidate.section === '' || validPathSegment(candidate.section)) &&
			typeof candidate.sectionUpdateKey === 'string' &&
			(candidate.sectionUpdateKey === '' || validPathSegment(candidate.sectionUpdateKey)) &&
			(candidate.deriveInboundLinks === undefined || typeof candidate.deriveInboundLinks === 'boolean') &&
			(candidate.skipAuthor === undefined || typeof candidate.skipAuthor === 'boolean') &&
			tagKeysValid;
	}
	//EXPLICIT per-kind branches with a terminating `return false`. This used to
	//fall through to comment-add's schema for anything that was not
	//card-create; adding a kind without restructuring would have checked every
	//comment-edit against comment-add's shape, failed on threadID/newThread,
	//and had validIntent silently drop the user's edit on the next read.
	//Runtime narrowing cannot be trusted here — the value comes from
	//attacker-writable storage.
	if (candidate.kind === 'comment-add') {
		//Message text is content, not a path, so it is deliberately
		//unconstrained beyond being a string; the ids become path segments.
		return validPathSegment(candidate.messageID) && validPathSegment(candidate.threadID) &&
			typeof candidate.message === 'string' && typeof candidate.newThread === 'boolean';
	}
	if (candidate.kind === 'comment-edit') {
		return validPathSegment(candidate.messageID) &&
			typeof candidate.message === 'string' && typeof candidate.baseMessage === 'string';
	}
	if (candidate.kind === 'comment-delete') {
		return validPathSegment(candidate.messageID) && typeof candidate.baseMessage === 'string';
	}
	if (candidate.kind === 'card-delete') {
		return Boolean(candidate.card) && typeof candidate.card === 'object';
	}
	return false;
};

const validPathSegment = (value : string) : boolean =>
	Boolean(value) && !value.includes('/') && !value.includes('..') && value.length < 1500;

const validIntent = (value : unknown) : value is AuxWriteIntent => {
	if (!value || typeof value !== 'object') return false;
	const intent = value as AuxWriteIntent;
	return intent.version === 1 && typeof intent.id === 'string' && Boolean(intent.id) &&
		typeof intent.uid === 'string' && Boolean(intent.uid) &&
		typeof intent.kind === 'string' && AUX_WRITE_KINDS.has(intent.kind) &&
		typeof intent.cardID === 'string' && validPathSegment(intent.cardID) &&
		typeof intent.auditKey === 'string' && (intent.auditKey === '' || validPathSegment(intent.auditKey)) &&
		validPayload(intent.kind, intent.payload) &&
		typeof intent.createdAt === 'number' && Number.isFinite(intent.createdAt);
};

//Kinds whose loss is the loss of something the user WROTE. The queue's original
//"drop anything questionable" policy was written when it held only stars, reads
//and reading-list entries — all best-effort and reconstructible. Card creations
//and comments are neither.
//comment-delete is deliberately absent: it carries no content the user typed
//(the comment is still on screen and can be deleted again), and its call site
//is dispatched unawaited — a rejection there would be an unhandled one, and
//there is no unhandledrejection handler anywhere in src/.
const HIGH_VALUE_KINDS : ReadonlySet<string> = new Set<AuxWriteKind>(['card-create', 'comment-add', 'comment-edit']);

//A corrupt or unreadable blob used to return [] — and because every mutation is
//read-modify-write, the very next star would persist that empty list and erase
//every queued card creation and comment. Keep the raw text under a quarantine
//key instead, so it can be recovered, and say so loudly.
const quarantineRawQueue = (raw : string, reason : string) : void => {
	console.error(`[aux-write] pending queue is unreadable (${reason}); quarantining it rather than discarding it`);
	try {
		localStorage.setItem(`${STORAGE_KEY}-corrupt-${Date.now()}`, raw);
	} catch {
		//Nothing further we can do; the error above is the record.
	}
};

//Index entries only — no body parsing. Used by the replay loop and the
//registration check so a queue full of 2KB cards is not deserialized just to
//ask "is anything pending for this uid?".
export const readPendingAuxHeaders = () : IndexEntry[] => {
	migrateLegacyQueue();
	const now = Date.now();
	return readIndex().filter(entry => now - entry.createdAt < MAX_INTENT_AGE_MS).sort(byCreationEntry);
};

export const readPendingAuxWrites = () : AuxWriteIntent[] => {
	migrateLegacyQueue();
	const now = Date.now();
	const result : AuxWriteIntent[] = [];
	for (const entry of readIndex().sort(byCreationEntry)) {
		if (now - entry.createdAt >= MAX_INTENT_AGE_MS) {
			//Ageing out a star is fine. Ageing out something the user wrote,
			//silently, is not — this is the last place it exists.
			if (HIGH_VALUE_KINDS.has(entry.kind)) {
				const aged = loadIntentBody(entry.id);
				console.error(`[aux-write] ${entry.kind} for ${aged?.cardID || entry.id} aged out after ${Math.round(MAX_INTENT_AGE_MS / 86400000)} days and was DISCARDED`);
				if (aged) reportDiscardedIntent(aged, new Error('it could not be saved for 30 days'));
			}
			deleteIntentKeys(entry.id);
			continue;
		}
		const intent = loadIntentBody(entry.id);
		//A missing body means removed: the delete lands before the index is
		//compacted, so an index entry alone is a tombstone, never a phantom.
		if (intent) result.push(intent);
	}
	return result;
};

//Append one intent without touching any other body — the operation the F8
//window used to make destructive.
const appendIntent = (intent : AuxWriteIntent) : boolean => {
	if (!persistIntentBody(intent)) return false;
	return writeIndex([...readIndex().filter(entry => entry.id !== intent.id), indexEntryFor(intent)].sort(byCreationEntry));
};

const removeIntent = (id : string) : void => {
	//O(1), and removeItem cannot fail for quota.
	deleteIntentKeys(id);
	writeIndex(readIndex().filter(entry => entry.id !== id));
};

type StoredClaim = {by : string, at : number};

const readClaim = (id : string) : StoredClaim | null => {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(claimKey(id));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredClaim;
		return typeof parsed?.by === 'string' && Number.isFinite(parsed?.at) ? parsed : null;
	} catch {
		return null;
	}
};

const claimIsLive = (claim : StoredClaim | null, now : number) : boolean =>
	Boolean(claim) && claim!.by !== TAB_ID && now - claim!.at < CLAIM_STALE_MS;

//Returns false when another live tab already claimed it.
const claimIntent = (id : string) : boolean => {
	if (typeof localStorage === 'undefined') return false;
	const now = Date.now();
	//The body is never rewritten by a claim now, which is what makes the
	//index/body split safe: no tab mutates another tab's intent.
	if (!localStorage.getItem(bodyKey(id))) return false;
	if (claimIsLive(readClaim(id), now)) return false;
	try {
		localStorage.setItem(claimKey(id), JSON.stringify({by: TAB_ID, at: now}));
	} catch {
		//Advisory only; the Web Lock is what actually serializes tabs.
	}
	return true;
};

const releaseClaim = (id : string) : void => {
	if (typeof localStorage === 'undefined') return;
	const held = readClaim(id);
	if (held && held.by === TAB_ID) localStorage.removeItem(claimKey(id));
};

//The text a message will HAVE once the queue drains, or null if nothing is
//pending for it. The main thread's Firestore cache is memory-only, so after a
//reload Redux shows the PRE-edit server text while an edit is still queued —
//basing a second edit on Redux would record a base the first edit has already
//moved past, and the second edit (the one the user made most recently) would
//lose the conflict. Intents are returned in creation order, so the last write
//wins here exactly as it will on the server.
export const pendingCommentTextFor = (messageID : string) : string | null => {
	let result : string | null = null;
	for (const intent of readPendingAuxWrites()) {
		const payload = intent.payload;
		if (!payload) continue;
		if (payload.kind === 'comment-add' && payload.messageID === messageID) result = payload.message;
		if (payload.kind === 'comment-edit' && payload.messageID === messageID) result = payload.message;
		if (payload.kind === 'comment-delete' && payload.messageID === messageID) result = '';
	}
	return result;
};

export const registerAuxWriteExecutor = (kind : AuxWriteKind, executor : AuxWriteExecutor) : void => {
	const isNew = !executors[kind];
	executors[kind] = executor;
	//Replay SKIPS intents whose executor is not registered yet, and nothing
	//re-triggered it when the module that registers one finally loaded — so a
	//kind registered in a lazily-imported module (card-create in actions/data,
	//comment-add in actions/comments) survived every boot without ever
	//executing. Registration is itself a trigger: if this kind has survivors
	//waiting, replay them now.
	if (!isNew || !currentUid) return;
	const uid = currentUid();
	if (!uid) return;
	if (!readPendingAuxWrites().some(intent => intent.kind === kind && intent.uid === uid)) return;
	void replayPendingAuxWrites(uid);
};

export const makeAuxWriteIntent = (uid : Uid, kind : AuxWriteKind, cardID : CardID, auditKey = '', payload? : AuxWritePayload) : AuxWriteIntent => ({
	version: 1,
	id: `${Date.now()}-${++intentCounter}-${Math.random().toString(36).slice(2, 8)}`,
	uid,
	kind,
	cardID,
	auditKey,
	...(payload ? {payload} : {}),
	createdAt: Date.now(),
});

//Losing one of these is a user ACTION disappearing — a star they set, a card
//they added to their reading list. Every call site is `void
//runDurableAuxWrite(...)` with no catch, so console.error alone meant it
//vanished with nothing on screen. Named actions, so the message is meaningful.
const DISCARD_LABELS : Record<AuxWriteKind, string> = {
	'star-add': 'starring that card',
	'star-remove': 'removing your star from that card',
	'read-add': 'marking that card read',
	'read-remove': 'marking that card unread',
	'reading-list-add': 'adding that card to your reading list',
	'reading-list-remove': 'removing that card from your reading list',
	'card-create': 'creating that card',
	'comment-add': 'posting your comment',
	'comment-edit': 'saving your edit to that comment',
	'comment-delete': 'deleting that comment',
	'card-delete': 'deleting that card',
};

//Terminal-discard subscribers. An intent can be discarded LONG after the call
//that created it returned: `runDurableAuxWrite` answers 'queued' for anything
//retryable, and the intent may then die on a later replay (a permanent failure
//such as the target card having been deleted) or age out after 30 days. A
//caller that applied something optimistically therefore cannot learn the real
//outcome by observing its own first attempt — it has already returned.
//
//Every terminal discard funnels through reportDiscardedIntent, so this is the
//one place that knows. Subscribers are notified BEFORE the user-facing alert,
//so the UI has already corrected itself by the time the alert is read.
const discardListeners : ((intent : AuxWriteIntent) => void)[] = [];

export const onAuxWriteDiscarded = (listener : (intent : AuxWriteIntent) => void) : void => {
	discardListeners.push(listener);
};

const reportDiscardedIntent = (intent : AuxWriteIntent, error : unknown) : void => {
	for (const listener of discardListeners) {
		try {
			listener(intent);
		} catch (err) {
			//A broken subscriber must never suppress the user-facing report.
			console.warn('[aux-write] a discard listener threw:', err);
		}
	}
	if (typeof window === 'undefined') return;
	const what = DISCARD_LABELS[intent.kind] || `the ${intent.kind} action`;
	const detail = (error as {message? : string})?.message || String(error);
	window.setTimeout(() => alert(`${what} could not be saved and has been discarded: ${detail}`), 0);
};

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

//What actually happened to an attempt. Callers that must not proceed on a
//write which has not landed (card creation waits for the card to exist, and
//then chases an auto-slug) need to tell 'committed' from 'queued for later'
//and from 'discarded' — resolving void for all three made a discarded
//creation look exactly like a successful one.
export type AuxWriteOutcome = 'committed' | 'queued' | 'discarded';

//Persist the intent, then attempt it. On server ack the intent clears; on
//failure it stays queued for replay (unless the failure is permanent). The
//returned promise reports the attempt, but callers need not await it — the
//queue owns completion.
export const runDurableAuxWrite = (intent : AuxWriteIntent) : Promise<AuxWriteOutcome> => {
	const executor = executors[intent.kind];
	if (!executor) return Promise.reject(new Error(`No executor for aux write kind ${intent.kind}`));
	//Over budget, a best-effort write degrades to session-only exactly as it
	//does on quota; something the user WROTE must be refused loudly instead.
	if (HIGH_VALUE_KINDS.has(intent.kind)) {
		const admission = groupFitsInQueue([intent]);
		if (!admission.ok) return Promise.reject(new Error(admission.message));
	}
	const persisted = appendIntent(intent);
	//If we could not persist something the user WROTE, do not proceed as
	//though it were durable — reject so the caller runs its own failure path
	//(restore the compose text, tell the user the card was not created)
	//instead of showing a success it cannot back up.
	if (!persisted && HIGH_VALUE_KINDS.has(intent.kind)) {
		return Promise.reject(new Error('This change could not be saved locally, so it was not submitted. Browser storage may be full or blocked.'));
	}
	inFlight.set(intent.id, intent);
	//Claim it before attempting, not just on replay. The type comment always
	//said the claim was "written before an attempt", but only replay wrote one
	//— so a fresh intent sat unclaimed in shared storage for the whole
	//attempt, and a sibling tab handling the same `online` event could claim
	//and execute it too. star-add then double-increments the card's counters
	//and comment-add double-increments thread_count.
	claimIntent(intent.id);
	return attemptPersistedIntent(intent).finally(() => releaseClaim(intent.id));
};

//A Firestore commit on the main thread's MEMORY-ONLY cache neither resolves nor
//rejects while offline, so awaiting the executor could hang forever: callers
//never learned the write had not landed, the 'queued' outcome was unreachable
//in exactly the situation it exists for, and the intent stayed in `inFlight`
//where replay skips it — permanently. Report 'queued' once this expires. The
//original promise stays wired, so a late ack still clears the intent and a late
//permanent failure still alerts.
let attemptTimeoutMs = 8000;

//Testing hook: the real 8s wait makes the unit suite pointlessly slow.
export const setAuxWriteAttemptTimeoutForTesting = (ms : number) : void => {
	attemptTimeoutMs = ms;
};

//Attempts that timed out but whose promise has NOT settled. The timeout drops
//the intent from `inFlight` on purpose — that is what stops a stranded attempt
//from wedging the queue for the session — but it also re-opens the double-apply
//the in-flight check exists to prevent. Offline, the SDK has the mutation
//queued locally and WILL flush it on reconnect, so a replay triggered by that
//same `online` event can commit a second copy. The star and comment executors
//preflight the server on replay, which narrows the window but does not close
//it: the preflight can read before the original mutation lands. star_count /
//star_count_manual / thread_count are `increment()` fanouts, so a second commit
//is a permanently wrong count, not a harmless repeat.
//
//Keeping the promise here lets replay WAIT for the original to settle before
//starting a rival. It is a bounded wait, so a genuinely stranded attempt still
//gets replayed rather than blocking forever.
const unsettledAttempts : Map<string, Promise<AuxWriteOutcome>> = new Map();

//The attempt already had `attemptTimeoutMs` and did not settle; give it that
//much again on the fresh readiness edge before racing it. Deriving this from
//the timeout rather than hard-coding it also keeps the unit suite fast.
const settleGraceMs = () => attemptTimeoutMs;

//Attempt an intent that is ALREADY persisted and already marked in flight.
const attemptPersistedIntent = (intent : AuxWriteIntent) : Promise<AuxWriteOutcome> => {
	const executor = executors[intent.kind];
	if (!executor) return Promise.reject(new Error(`No executor for aux write kind ${intent.kind}`));
	const attempt = executor(intent, false).then<AuxWriteOutcome, AuxWriteOutcome>(() => {
		removeIntent(intent.id);
		return 'committed';
	}, error => {
		//Dropping a user's intent must never be silent: this is the last point
		//at which the write still existed anywhere.
		if (permanentFailure(error)) {
			console.error(`Aux write ${intent.kind} for ${intent.cardID} failed permanently and was DISCARDED:`, error);
			removeIntent(intent.id);
			reportDiscardedIntent(intent, error);
			return 'discarded';
		}
		console.warn(`Aux write ${intent.kind} for ${intent.cardID} did not confirm; queued for replay:`, error);
		recordFailure(intent, error);
		return 'queued';
	}).finally(() => {
		inFlight.delete(intent.id);
		unsettledAttempts.delete(intent.id);
	});
	unsettledAttempts.set(intent.id, attempt);
	return Promise.race([
		attempt,
		new Promise<AuxWriteOutcome>(resolve => setTimeout(() => {
			//Not an error and not a discard: the write may still land. The
			//intent stays persisted, and dropping it from `inFlight` is what
			//lets a later replay pick it up if this attempt never settles.
			if (inFlight.has(intent.id)) {
				console.warn(`Aux write ${intent.kind} for ${intent.cardID} has not confirmed in ${attemptTimeoutMs}ms; treating it as queued`);
				inFlight.delete(intent.id);
				//COUNT IT. A deterministic hang is exactly as wedged as a
				//deterministic throw, and only the throw was being counted —
				//so the shape that never settles would have gone on promising
				//"it will go through when the connection recovers" forever.
				recordFailure(intent, new Error(`no response within ${attemptTimeoutMs}ms`));
			}
			resolve('queued');
		}, attemptTimeoutMs))
	]);
};

//Persist a GROUP of intents in one storage write, then attempt them with
//bounded concurrency. Giving each imported card its own durable intent is the
//right call — an import that dies halfway used to lose every card — but doing
//that with one runDurableAuxWrite per card turned a single batched commit into
//N SERIALIZED server round trips: at this branch's own measured ~0.6-1s commit,
//a 100-card import would take 60-100s behind an indefinite spinner. The cards
//are independent, so nothing forbids overlapping them.
//
//One storage write rather than N read-modify-writes also keeps the persist step
//from being O(N^2) in bytes for a large import.
export const runDurableAuxWrites = async (intents : AuxWriteIntent[], concurrency = 8) : Promise<AuxWriteOutcome[]> => {
	if (!intents.length) return [];
	for (const intent of intents) {
		if (!executors[intent.kind]) throw new Error(`No executor for aux write kind ${intent.kind}`);
	}
	//Refuse an oversized group BEFORE writing any of it, so the queue cannot be
	//left half-populated and the caller's failure path runs with nothing
	//committed.
	const admission = groupFitsInQueue(intents);
	if (!admission.ok) throw new Error(admission.message);
	//Persist the WHOLE group before attempting any of it. Previously each
	//intent was persisted inside its own awaited call, so a bulk import that
	//stalled on card 1 had never written intents 2..N — 199 of 200 imported
	//cards were simply gone on reload.
	//Bodies first, one at a time, then ONE index write. The previous form read
	//the whole queue and wrote it back — the exact read-modify-write window F8
	//closed everywhere else, left open on the bulk-import path, where the
	//queue is largest and a sibling's interleaving does the most damage.
	//Rolls back on failure, or the recovery scan would adopt bodies belonging
	//to an import the caller was told did not happen.
	const written : string[] = [];
	for (const intent of intents) {
		if (persistIntentBody(intent)) {
			written.push(intent.id);
			continue;
		}
		for (const id of written) deleteIntentKeys(id);
		throw new Error('These changes could not be saved locally, so they were not submitted. Browser storage may be full or blocked.');
	}
	if (!writeIndex([...readIndex(), ...intents.map(indexEntryFor)].sort(byCreationEntry))) {
		for (const id of written) deleteIntentKeys(id);
		throw new Error('These changes could not be saved locally, so they were not submitted. Browser storage may be full or blocked.');
	}
	for (const intent of intents) {
		inFlight.set(intent.id, intent);
		claimIntent(intent.id);
	}
	const outcomes : AuxWriteOutcome[] = new Array(intents.length);
	let next = 0;
	//localStorage mutation inside the settle path is synchronous, so concurrent
	//attempts cannot interleave a read-modify-write within this tab.
	const runner = async () : Promise<void> => {
		for (;;) {
			const index = next++;
			if (index >= intents.length) return;
			outcomes[index] = await attemptPersistedIntent(intents[index]).finally(() => releaseClaim(intents[index].id));
		}
	};
	await Promise.all(Array.from({length: Math.min(concurrency, intents.length)}, () => runner()));
	return outcomes;
};

//Replays every surviving intent for the given uid, strictly in order,
//stopping at the first transient failure (offline again). Intents currently
//in flight in this session are the SDK queue's responsibility and are
//skipped.
//localStorage read-modify-write is not atomic across renderer processes, so the
//claim written below can be observed-unclaimed and written by TWO tabs, both of
//which then execute the same intent — and star writes carry increment(+/-1), so
//one star became +2. A real mutex is required. Web Locks is the primitive this
//app already uses for corpus ownership; holding one for the whole replay makes
//claim-and-execute atomic with respect to other tabs, and the localStorage
//claim remains as a best-effort marker for browsers without the API.
const AUX_REPLAY_LOCK = 'card-web-aux-write-replay';

const withReplayLock = async (fn : () => Promise<void>) : Promise<void> => {
	const locks = (globalThis as {navigator? : {locks? : {request : (name : string, options : {ifAvailable : boolean}, cb : (lock : unknown) => Promise<void>) => Promise<void>}}}).navigator?.locks;
	if (!locks) {
		//No Web Locks (older Safari, some embedded views). Fall back to the
		//advisory claim alone: strictly worse, but better than not replaying.
		await fn();
		return;
	}
	//ifAvailable: another tab replaying is not an error — it is doing the work.
	await locks.request(AUX_REPLAY_LOCK, {ifAvailable: true}, async lock => {
		if (!lock) return;
		await fn();
	});
};

export const replayPendingAuxWrites = async (uid : Uid) : Promise<void> => {
	//Adopt any body the index lost before deciding what to replay. A sibling
	//tab writing between our read and our write can drop an index entry, and
	//the body is the truth — without this the intent would sit on disk,
	//unreplayed, until something else happened to scan.
	repairIndexFromScan();
	//A replay already running for a DIFFERENT uid will notice the switch and
	//break out (see the live-uid check below), but it cannot start this one, so
	//the new account's intents would never replay this page. Let the caller
	//retry once the loop unwinds.
	if (!uid) {
		console.warn(`[aux-write] replay skipped: no uid (${readPendingAuxWrites().length} intents waiting)`);
		return;
	}
	console.log(`[aux-write] replay for ${uid}: ${readPendingAuxWrites().length} intents in the queue`);
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
		await withReplayLock(async () => {
		for (const intent of readPendingAuxWrites()) {
			if (intent.uid !== uid || inFlight.has(intent.id)) continue;
			const executor = executors[intent.kind];
			if (!executor) {
				//Not an error: the registering module may simply not be loaded
				//yet. Registration re-triggers replay (see above). Logged
				//because a silent skip here is indistinguishable from a
				//successful replay when reading the queue from outside.
				console.warn(`[aux-write] no executor for ${intent.kind} yet; retaining intent ${intent.id} for a later replay`);
				continue;
			}
			//Re-check the LIVE uid between awaits. It was captured once at call
			//time, so a sign-out or account switch mid-replay left the loop
			//committing the old account's intents under new auth — earning
			//permission-denied, which is classified permanent, which DISCARDED
			//them. Reads and reading-list writes have no preflight to save
			//them, unlike stars.
			if (currentUid && currentUid() !== uid) break;
			//This tab already has an attempt out for this intent that timed out
			//without settling. Give it a bounded chance to land NOW — a replay
			//is usually triggered by the very `online` event that lets the SDK
			//flush it — rather than immediately committing a rival copy.
			const unsettled = unsettledAttempts.get(intent.id);
			if (unsettled) {
				await Promise.race([
					unsettled.catch(() => undefined),
					new Promise<void>(resolve => setTimeout(resolve, settleGraceMs())),
				]);
				//It landed (or failed permanently and was discarded) while we
				//waited: there is nothing left to replay.
				if (!readPendingAuxWrites().some(pending => pending.id === intent.id)) continue;
			}
			//Claim it in shared storage as a secondary marker (the Web Lock
			//above is what actually serializes tabs). If another tab holds a
			//live claim on this intent we must STOP, not skip: replay order is
			//load-bearing per uid, and skipping ahead let a `star-remove`
			//execute while the matching `star-add` was still owned elsewhere —
			//the remove no-ops against an absent star, the add then lands, and
			//the card ends up starred, the opposite of the user's last action.
			//The same inversion applies to read and reading-list pairs.
			if (!claimIntent(intent.id)) break;
			try {
				//BOUND THE REPLAY ATTEMPT, for the same reason the first attempt
				//is bounded and then some. A Firestore commit on a memory-only
				//cache neither resolves nor rejects while offline, so a bare
				//await here hung the replay loop forever WHILE HOLDING THE
				//REPLAY WEB LOCK — no tab could replay anything after it — and
				//the intent accumulated exactly one failure, so the wedge report
				//(which needs four) could never fire. That is precisely the
				//"deterministic hang is as wedged as a deterministic throw" case
				//the counter exists for.
				//
				//The rejection carries no `code`, so it is classified transient:
				//the intent is retained and retried, which is correct — we do
				//not know that it failed, only that it did not answer in time.
				const attempt = executor(intent, true);
				//The original promise stays live, so a later replay must not
				//race a rival copy of the same write against it. Reuse the same
				//bookkeeping the first-attempt timeout uses; the loop above
				//already waits on anything recorded here.
				unsettledAttempts.set(intent.id, attempt.then(() => 'committed' as AuxWriteOutcome, () => 'queued' as AuxWriteOutcome));
				void attempt.catch(() => undefined).finally(() => unsettledAttempts.delete(intent.id));
				await Promise.race([
					attempt,
					new Promise<never>((_, reject) => setTimeout(
						() => reject(new Error(`no response within ${attemptTimeoutMs}ms`)), attemptTimeoutMs))
				]);
				unsettledAttempts.delete(intent.id);
				clearFailures(intent.id);
				removeIntent(intent.id);
			} catch (error) {
				if (permanentFailure(error)) {
					console.error(`Aux write ${intent.kind} for ${intent.cardID} failed permanently on replay and was DISCARDED:`, error);
					removeIntent(intent.id);
					reportDiscardedIntent(intent, error);
					continue;
				}
				//Transient (likely offline): keep this and everything after
				//it, in order, for the next replay trigger. Release the claim
				//so another tab (or a later replay here) may take it.
				//LOGGED: this used to break silently, which made a replay that
				//ran and failed indistinguishable from one that never ran at
				//all — the queue just sat there with no explanation anywhere.
				console.warn(`Aux write ${intent.kind} for ${intent.cardID} did not confirm on replay; retained for the next trigger:`, error);
				recordFailure(intent, error);
				releaseClaim(intent.id);
				break;
			}
		}
		});
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
		//A null key means another context called localStorage.clear(); v1 ignored it.
		if (event.key !== null && !event.key.startsWith(PREFIX) && event.key !== STORAGE_KEY) return;
		const present = new Set(readIndex().map(entry => entry.id));
		const dropped = [...inFlight.values()].filter(intent => !present.has(intent.id));
		if (dropped.length) {
			console.warn(`Restoring ${dropped.length} in-flight aux write intent(s) dropped by a concurrent tab`);
			for (const intent of dropped) appendIntent(intent);
		}
		//And adopt any survivor the index lost that is NOT in flight here — the
		//gap the v1 listener could not cover, because an intent leaves inFlight
		//the moment its attempt settles or times out. Bodies are the truth.
		repairIndexFromScan();
	});
};

//Testing hook: clears module state that would otherwise leak between tests.
//At module load: recover anything a previous session's interleaving dropped
//from the index before any caller reads the queue.
if (typeof localStorage !== 'undefined') {
	try {
		migrateLegacyQueue();
		repairIndexFromScan();
	} catch {
		//Never let queue recovery keep the module from loading.
	}
}

export const resetAuxWriteQueueForTesting = () : void => {
	for (const key of Object.keys(executors)) delete executors[key as AuxWriteKind];
	inFlight.clear();
	unsettledAttempts.clear();
	discardListeners.length = 0;
	replayRunning = false;
	replayRetryScheduled = false;
	currentUid = null;
	watcherInstalled = false;
	attemptTimeoutMs = 8000;
};
