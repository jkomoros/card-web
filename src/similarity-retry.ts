//Small, dependency-free coordinator for similarity requests. Keeping this
//separate from the Firebase action makes the retry/cancellation policy easy to
//test without importing the browser Firebase runtime.

export type SimilarityRetryOutcome = 'done' | 'retry';

export type SimilarityRetryRun = (attempt : number, isCurrent : () => boolean) => Promise<SimilarityRetryOutcome>;

type Timer = ReturnType<typeof setTimeout>;

type PendingRequest = {
	version: number;
	run: SimilarityRetryRun;
	timer: Timer | null;
	cancelled: boolean;
	lastDemand: number;
	ready: boolean;
	inFlight: boolean;
	attempt: number;
};

export type SimilarityRetryOptions = {
	baseDelayMs?: number;
	maxDelayMs?: number;
	maxPending?: number;
	maxConcurrent?: number;
	now?: () => number;
	random?: () => number;
	schedule?: (callback : () => void, delayMs : number) => Timer;
	cancelTimer?: (timer : Timer) => void;
	onRetry?: (key : string, attempt : number, delayMs : number) => void;
	//Called when a pending request is DROPPED to stay under maxPending. The
	//caller has already told its consumers to expect values later, so without
	//a terminal state here a `similar/` view spanning more key cards than the
	//LRU bound leaves some of them loading forever. Not called when a request
	//is superseded by a newer version of the same key (that chain produces its
	//own terminal state) or cancelled explicitly by the caller.
	onDrop?: (key : string) => void;
};

//There can legitimately be more than one similarity key in a collection, but
//an unbounded set means navigation can leave a network retry chain behind for
//every card visited. Eight concurrent keys preserves multi-key filters while
//putting a hard ceiling on background work.
const DEFAULT_MAX_PENDING = 8;

export class SimilarityRetryCoordinator {
	private readonly _pending = new Map<string, PendingRequest>();
	private readonly _baseDelayMs : number;
	private readonly _maxDelayMs : number;
	private readonly _maxPending : number;
	private readonly _maxConcurrent : number;
	private readonly _now : () => number;
	private readonly _random : () => number;
	private readonly _schedule : (callback : () => void, delayMs : number) => Timer;
	private readonly _cancelTimer : (timer : Timer) => void;
	private readonly _onRetry? : (key : string, attempt : number, delayMs : number) => void;
	private readonly _onDrop? : (key : string) => void;
	private _activeRuns = 0;

	constructor(options : SimilarityRetryOptions = {}) {
		this._baseDelayMs = options.baseDelayMs ?? 2500;
		this._maxDelayMs = options.maxDelayMs ?? 30000;
		this._maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
		this._maxConcurrent = options.maxConcurrent ?? this._maxPending;
		this._now = options.now ?? Date.now;
		this._random = options.random ?? Math.random;
		this._schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
		this._cancelTimer = options.cancelTimer ?? clearTimeout;
		this._onRetry = options.onRetry;
		this._onDrop = options.onDrop;
	}

	//Returns false only when this exact card version already has a request in
	//flight. A newer version cancels the old chain before it starts.
	request(key : string, version : number, run : SimilarityRetryRun) : boolean {
		const existing = this._pending.get(key);
		if (existing && existing.version === version) {
			existing.lastDemand = this._now();
			return false;
		}
		if (existing) this._cancelEntry(key, existing);

		while (this._pending.size >= this._maxPending) {
			let oldestKey = '';
			let oldest : PendingRequest | null = null;
			for (const [candidateKey, candidate] of this._pending) {
				if (!oldest || candidate.lastDemand < oldest.lastDemand) {
					oldestKey = candidateKey;
					oldest = candidate;
				}
			}
			if (!oldest) break;
			this._cancelEntry(oldestKey, oldest);
			this._onDrop?.(oldestKey);
		}

		const entry : PendingRequest = {
			version,
			run,
			timer: null,
			cancelled: false,
			lastDemand: this._now(),
			ready: true,
			inFlight: false,
			attempt: 0
		};
		this._pending.set(key, entry);
		this._drain();
		return true;
	}

	cancel(key : string) : void {
		const entry = this._pending.get(key);
		if (entry) this._cancelEntry(key, entry);
	}

	cancelAll() : void {
		for (const [key, entry] of this._pending) this._cancelEntry(key, entry);
	}

	get pendingCount() : number {
		return this._pending.size;
	}

	get activeCount() : number {
		return this._activeRuns;
	}

	private _cancelEntry(key : string, entry : PendingRequest) : void {
		entry.cancelled = true;
		entry.ready = false;
		if (entry.timer !== null) this._cancelTimer(entry.timer);
		if (this._pending.get(key) === entry) this._pending.delete(key);
	}

	private _drain() : void {
		while (this._activeRuns < this._maxConcurrent) {
			let nextKey = '';
			let next : PendingRequest | null = null;
			//Prefer the most recently demanded ready request. This lets rapid
			//navigation converge on what the user is looking at now, while the
			//LRU bound above drops obsolete queued work before it can start.
			for (const [key, candidate] of this._pending) {
				if (!candidate.ready || candidate.inFlight || candidate.cancelled) continue;
				if (!next || candidate.lastDemand > next.lastDemand) {
					nextKey = key;
					next = candidate;
				}
			}
			if (!next) return;
			next.ready = false;
			next.inFlight = true;
			this._activeRuns++;
			void this._attempt(nextKey, next);
		}
	}

	private async _attempt(key : string, entry : PendingRequest) : Promise<void> {
		let outcome : SimilarityRetryOutcome = 'done';
		try {
			outcome = await entry.run(entry.attempt, () => !entry.cancelled && this._pending.get(key) === entry);
		} catch (error) {
			//The owner decides whether a transport error is retryable. An
			//unexpected exception must never create an unhandled rejection or a
			//permanent pending entry.
			console.warn(`[similarity] request for ${key} failed unexpectedly:`, error);
		}
		entry.inFlight = false;
		this._activeRuns--;

		if (entry.cancelled || this._pending.get(key) !== entry) {
			this._drain();
			return;
		}
		if (outcome === 'done') {
			this._pending.delete(key);
			this._drain();
			return;
		}

		const exponentialDelay = this._baseDelayMs * Math.pow(2, entry.attempt);
		//±20% jitter prevents the bounded requests from re-forming a lockstep
		//burst when connectivity returns after a shared outage.
		const delayMs = Math.min(this._maxDelayMs, Math.round(exponentialDelay * (0.8 + this._random() * 0.4)));
		this._onRetry?.(key, entry.attempt + 1, delayMs);
		entry.timer = this._schedule(() => {
			entry.timer = null;
			entry.attempt++;
			entry.ready = true;
			this._drain();
		}, delayMs);
		this._drain();
	}
}
