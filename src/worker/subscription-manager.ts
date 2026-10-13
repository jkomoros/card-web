//Live collection subscriptions over the QueryEngine: the main thread
//subscribes a collection description once, and the worker pushes a fresh
//ordered result whenever engine state (cards, filter membership, sections,
//config) changes it — coalesced, and only when the result actually differs
//from the last push. This is the worker-side heart of the B3 cutover: the
//main thread stops computing collections and starts rendering pushed results.

import {
	QueryEngine,
	RunCollectionResult
} from './query-engine.js';

import {
	CardID,
	CardSimilarityMap,
	Uid
} from '../types.js';

import {
	SELECTED_FILTER_NAME,
	descriptionMayReadEditingCard,
	descriptionMayReadReads,
	descriptionMayReadStars,
	descriptionMayReadReadingList
} from '../filter-constants.js';

export type SubscriptionParams = {
	description : string,
	keyCardID : CardID | '',
	uid : Uid,
	randomSalt : string,
	cardSimilarity : CardSimilarityMap
};

export type SubscriptionPush = RunCollectionResult & {
	subscriptionID : number,
	ms : number
};

//What kind of engine change a markDirty describes. 'selection' means ONLY
//the selected-cards set changed — a per-keypress user action whose result
//can differ only for subscriptions that actually reference the selection
//filters. 'editing' means ONLY the mirrored editing card changed — which
//happens on every extraction while the user types, and in a signed-in
//profile on the real 40k corpus re-ran every open subscription each time
//(~46 collection runs per Save→New cycle, the largest single warm cost on
//the worker); only subscriptions whose description can read the editing
//card (EDITING_CARD_FILTER_NAMES) can change. 'reads', 'stars' and
//'reading-list' mean ONLY that per-user set changed (its listener
//delivered): the auto-read ~5s after every navigation used to re-run every
//open subscription on the real corpus, when only ones naming read/unread
//can differ. Everything else is 'all'.
export type DirtyScope = 'selection' | 'editing' | 'reads' | 'stars' | 'reading-list' | 'all';

type Subscription = SubscriptionParams & {
	lastIDs : CardID[] | null,
	lastLabels : string[] | null,
	//The last error message reported for this subscription, or null when it
	//is healthy. Failures repeat on every flush while the cause persists
	//(markDirty fires per ingested batch), so reporting is FIRST-ONLY per
	//(subscription, message): measured pre-fix, 200 flushes × 3 throwing
	//subscriptions produced 600 onError calls and 600 console.errors —
	//making the console useless exactly when it is needed (#739). A
	//successful run after a failure reports recovery (error null) exactly
	//once.
	lastErrorMessage : string | null,
	//Whether the description references the selection filters (selected /
	//not-selected), computed once at subscribe. Conservative substring test:
	//'not-selected' contains 'selected', union members and configurable
	//sub-expressions embed the literal name, and a false positive (e.g. a
	//query containing the word) merely recomputes — never skips a needed
	//recompute.
	dependsOnSelection : boolean,
	//Whether the description names a configurable filter that reads the
	//editing card (see DirtyScope 'editing'); computed once at subscribe.
	dependsOnEditingCard : boolean,
	//Whether the description names the viewer-state filters each scoped
	//dirt can change (see DirtyScope 'reads' / 'stars' / 'reading-list').
	dependsOnReads : boolean,
	dependsOnStars : boolean,
	dependsOnReadingList : boolean,
};

//For each narrow scope, the dependency that lets a subscription change.
const SCOPE_DEPENDENCY : {[scope in Exclude<DirtyScope, 'all'>] : (subscription : Subscription) => boolean} = {
	'selection': subscription => subscription.dependsOnSelection,
	'editing': subscription => subscription.dependsOnEditingCard,
	'reads': subscription => subscription.dependsOnReads,
	'stars': subscription => subscription.dependsOnStars,
	'reading-list': subscription => subscription.dependsOnReadingList,
};

const resultsEqual = (subscription : Subscription, result : RunCollectionResult) : boolean => {
	if (!subscription.lastIDs || !subscription.lastLabels) return false;
	if (subscription.lastIDs.length !== result.ids.length) return false;
	for (let i = 0; i < result.ids.length; i++) {
		if (subscription.lastIDs[i] !== result.ids[i]) return false;
	}
	if (subscription.lastLabels.length !== result.labels.length) return false;
	for (let i = 0; i < result.labels.length; i++) {
		if (subscription.lastLabels[i] !== result.labels[i]) return false;
	}
	return true;
};

export class SubscriptionManager {

	_engine : QueryEngine;
	_subscriptions : Map<number, Subscription>;
	_push : (push : SubscriptionPush) => void;
	//message null = recovered. A string — computed here via String(e) — is a
	//failure, which keeps a pathological `throw null` from masquerading as
	//the recovery sentinel.
	_onError : ((subscriptionID : number, description : string, message : string | null) => void) | null;
	_flushDelayMs : number;
	_flushTimeout : ReturnType<typeof setTimeout> | null;
	_scheduledDelayMs : number;
	_dirty : boolean;
	_dirtyScope : DirtyScope | null;
	_paused : boolean;
	//When the last flush ENDED — the leading-edge guard in flushImmediately
	//reads this so an echo burst coalesces onto the batching floor instead of
	//paying a full recompute per echo.
	_lastFlushEndMs : number;

	//push is called with each fresh result; flushDelayMs coalesces bursts of
	//engine mutations (e.g. ingestion batches) into one recompute. onError is
	//called when a subscription's collection run THROWS — first-only per
	//(subscription, message) — and again with error null when it recovers.
	//See flush().
	constructor(engine : QueryEngine, push : (push : SubscriptionPush) => void, flushDelayMs = 50, onError : ((subscriptionID : number, description : string, message : string | null) => void) | null = null) {
		this._engine = engine;
		this._subscriptions = new Map();
		this._push = push;
		this._onError = onError;
		this._flushDelayMs = flushDelayMs;
		this._flushTimeout = null;
		this._scheduledDelayMs = 0;
		this._dirty = false;
		this._dirtyScope = null;
		this._paused = false;
		//Far enough in the past that the first interactive echo of a session
		//takes the immediate path.
		this._lastFlushEndMs = -Infinity;
	}

	//While paused, no flush runs at all: subscriptions can be registered and
	//dirtiness accumulates, but nothing is computed or pushed. This exists
	//for the initial-load window — the main thread now subscribes the active
	//collection at CONNECT (so the first result can ride immediately behind
	//the prime's card batches), and without a pause every cold-sweep batch
	//would burn an O(corpus) recompute on a push the bridge is going to drop
	//anyway (it refuses results until loadComplete).
	pause() : void {
		this._paused = true;
	}

	//Resuming flushes SYNCHRONOUSLY: the caller resumes exactly when the
	//corpus becomes servable (loadComplete), and the whole point is for the
	//first authoritative result to be computed and pushed in that same turn,
	//directly behind the loadComplete message.
	resume() : void {
		if (!this._paused) return;
		this._paused = false;
		if (this._flushTimeout) {
			clearTimeout(this._flushTimeout);
			this._flushTimeout = null;
		}
		this.flush();
	}

	subscribe(subscriptionID : number, params : SubscriptionParams) : void {
		this._subscriptions.set(subscriptionID, {
			...params,
			lastIDs: null,
			lastLabels: null,
			lastErrorMessage: null,
			dependsOnSelection: params.description.includes(SELECTED_FILTER_NAME),
			dependsOnEditingCard: descriptionMayReadEditingCard(params.description),
			dependsOnReads: descriptionMayReadReads(params.description),
			dependsOnStars: descriptionMayReadStars(params.description),
			dependsOnReadingList: descriptionMayReadReadingList(params.description),
		});
		//New subscriptions get a result promptly.
		this._scheduleFlush();
	}

	unsubscribe(subscriptionID : number) : void {
		this._subscriptions.delete(subscriptionID);
	}

	//Drops every subscription. Called on (re)connect: subscriptions were
	//created under the previous connection's parameters (uid, permissions)
	//and must not keep pushing results computed under the old world.
	clear() : void {
		this._subscriptions.clear();
	}

	get size() : number {
		return this._subscriptions.size;
	}

	//Call whenever engine state may have changed results (card batches,
	//replayed actions, config updates). Pass 'selection' when ONLY the
	//selected-cards set changed: the flush then skips every subscription
	//whose description does not reference the selection filters, and runs
	//without the coalescing delay — a selection toggle is a single user
	//keypress, not an ingestion batch, and making it wait on the batch
	//floor is what made Space-to-select feel laggy (#760).
	markDirty(scope : DirtyScope = 'all') : void {
		this._dirty = true;
		this._dirtyScope = this._dirtyScope === null || this._dirtyScope === scope ? scope : 'all';
		//The DELAY follows the incoming change, not the merged scope: a
		//selection keypress means a user is waiting, so it pulls even a
		//pending batch flush forward (sooner-wins in _scheduleFlush). The
		//SKIP logic in flush() follows the merged scope, so mixed dirt still
		//recomputes everything.
		this._scheduleFlush(scope === 'selection' ? 0 : this._flushDelayMs);
	}

	//For interactive local echoes (a just-created card, whose navigation
	//gates on the next collection result): the batching floor that protects
	//ingestion sweeps is pure added latency when a user is actively waiting.
	//Flushes synchronously and cancels any scheduled flush — flush()
	//recomputes every subscription regardless of dirt, so leaving the timer
	//armed would only buy a second full recompute that pushes nothing.
	//
	//LEADING EDGE ONLY. An echo BURST — twenty rapid creations, a bulk
	//import's per-card commits — must not pay a full every-subscription
	//recompute per card: at a 40k corpus that wedged the worker for the
	//length of the burst, and every navigation's subscribe message froze in
	//the queue behind it (the very hazard the batching floor exists for).
	//The first echo after an idle stretch flushes in this turn; an echo
	//landing within the batching floor of the previous flush's END falls
	//back to the flush markDirty already scheduled. Measured from the end,
	//not the start: a flush long enough to matter ends just before the next
	//queued echo message is processed, so every echo behind it coalesces.
	flushImmediately() : void {
		if (this._paused) return;
		if (performance.now() - this._lastFlushEndMs < this._flushDelayMs) return;
		if (this._flushTimeout) {
			clearTimeout(this._flushTimeout);
			this._flushTimeout = null;
		}
		this.flush();
	}

	_scheduleFlush(delayMs = this._flushDelayMs) : void {
		if (this._paused) return;
		if (this._flushTimeout) {
			//A sooner deadline wins; a later one never postpones a scheduled
			//flush. NOTE this compares DELAYS, not absolute deadlines — safe
			//while the only tiers are 0 and _flushDelayMs (0 is always sooner
			//than any pending deadline), but a third tier would need real
			//deadline math here.
			if (delayMs >= this._scheduledDelayMs) return;
			clearTimeout(this._flushTimeout);
		}
		this._scheduledDelayMs = delayMs;
		this._flushTimeout = setTimeout(() => {
			this._flushTimeout = null;
			this.flush();
		}, delayMs);
	}

	//Recomputes every subscription and pushes those whose results changed.
	//Exposed for tests (and for an eventual synchronous flush on demand).
	flush() : void {
		//A flush while paused would mark results as pushed (lastIDs) even if
		//the push callback's consumer discards them; refuse wholesale so the
		//resume-time flush is guaranteed to actually deliver.
		if (this._paused) return;
		const scope : DirtyScope = this._dirtyScope ?? 'all';
		this._dirty = false;
		this._dirtyScope = null;
		for (const [subscriptionID, subscription] of this._subscriptions.entries()) {
			//A selection-only change can alter results only for
			//subscriptions that reference the selection filters. Skipping
			//the rest is the difference between Space-to-select costing one
			//cheap recompute and costing a full recompute of every open
			//subscription over the corpus (#760). Subscriptions that have
			//never been pushed (lastIDs null) always compute, whatever the
			//scope — they may have subscribed during the selection burst.
			//A FAILED subscription (lastErrorMessage set) never skips: its
			//recovery would otherwise wait for the next 'all'-scope dirt,
			//leaving the failure banner up after the cause healed.
			//Same shape for the mirrored editing card (the worker corpus does
			//not change until the card is saved) and for the viewer-state
			//sets: a subscription that cannot read what changed cannot change.
			if (scope !== 'all' && subscription.lastIDs !== null && !SCOPE_DEPENDENCY[scope](subscription) && subscription.lastErrorMessage === null) continue;
			let result : RunCollectionResult;
			const start = performance.now();
			try {
				result = this._engine.runCollection(subscription.description, {
					keyCardID: subscription.keyCardID,
					uid: subscription.uid,
					randomSalt: subscription.randomSalt,
					cardSimilarity: subscription.cardSimilarity
				});
			} catch (e) {
				//`continue` keeps ONE bad subscription from killing every other
				//subscription's flush, which is still right — but on its own it
				//also converts a thrown filter into a collection that renders
				//permanently empty, indistinguishable from "no cards matched".
				//That silence is what made #731 (a one-line type bug) take so
				//long to find: the only trace was a console.warn inside the
				//worker, which nobody is looking at. Surface it on the same
				//error channel the direct runCollection path already uses —
				//but only ONCE per (subscription, message); see
				//lastErrorMessage.
				const message = String(e);
				if (subscription.lastErrorMessage !== message) {
					subscription.lastErrorMessage = message;
					console.error(`subscription ${subscription.description} failed: ${message}`);
					if (this._onError) this._onError(subscriptionID, subscription.description, message);
				}
				continue;
			}
			//Recovery must be reported even when the fresh result equals the
			//last pushed one (no push would follow), or the UI would show a
			//failure forever after a transient throw.
			if (subscription.lastErrorMessage !== null) {
				subscription.lastErrorMessage = null;
				if (this._onError) this._onError(subscriptionID, subscription.description, null);
			}
			if (resultsEqual(subscription, result)) continue;
			subscription.lastIDs = result.ids;
			subscription.lastLabels = result.labels;
			this._push({
				...result,
				subscriptionID,
				ms: Math.round((performance.now() - start) * 10) / 10
			});
		}
		this._lastFlushEndMs = performance.now();
	}
}
