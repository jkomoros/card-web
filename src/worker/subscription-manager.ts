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

type Subscription = SubscriptionParams & {
	lastIDs : CardID[] | null,
	lastLabels : string[] | null,
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
	_flushDelayMs : number;
	_flushTimeout : ReturnType<typeof setTimeout> | null;
	_dirty : boolean;

	//push is called with each fresh result; flushDelayMs coalesces bursts of
	//engine mutations (e.g. ingestion batches) into one recompute.
	constructor(engine : QueryEngine, push : (push : SubscriptionPush) => void, flushDelayMs = 50) {
		this._engine = engine;
		this._subscriptions = new Map();
		this._push = push;
		this._flushDelayMs = flushDelayMs;
		this._flushTimeout = null;
		this._dirty = false;
	}

	subscribe(subscriptionID : number, params : SubscriptionParams) : void {
		this._subscriptions.set(subscriptionID, {...params, lastIDs: null, lastLabels: null});
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
	//replayed actions, config updates).
	markDirty() : void {
		this._dirty = true;
		this._scheduleFlush();
	}

	_scheduleFlush() : void {
		if (this._flushTimeout) return;
		this._flushTimeout = setTimeout(() => {
			this._flushTimeout = null;
			this.flush();
		}, this._flushDelayMs);
	}

	//Recomputes every subscription and pushes those whose results changed.
	//Exposed for tests (and for an eventual synchronous flush on demand).
	flush() : void {
		this._dirty = false;
		for (const [subscriptionID, subscription] of this._subscriptions.entries()) {
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
				console.warn(`subscription ${subscription.description} failed: ${String(e)}`);
				continue;
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
	}
}
