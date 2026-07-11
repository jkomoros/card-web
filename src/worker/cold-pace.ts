//Pure adaptive-pacing math for the cold sweep (docs/HANDOFF-BRIEF.md FAST
//COLD BOOT directive). This replaces the retired daily read budget
//(cold-budget.ts), which was designed for a free-tier quota cliff that does
//not exist: both projects are on Blaze with no caps anywhere (verified in
//console). The only real constraint is server-side backpressure against our
//burst shape — observed live as RESOURCE_EXHAUSTED with the SDK's 'maximum
//backoff to prevent overloading' message. So: full parallelism by default,
//halve concurrency and back off exponentially on throttle, restore after a
//run of clean pages. Never pause until midnight; never give up.

export const COLD_SWEEP_PAGE_SIZE = 500;
export const COLD_SWEEP_PRIORITY_COUNT = 5000;

//Concurrent in-flight pages: rung 0 is one page per partition; each
//throttle steps down one rung.
export const CONCURRENCY_LADDER = [10, 5, 2, 1];

//Consecutive clean (unthrottled) pages at a reduced rung before stepping
//back up one rung: long enough that a restore isn't attempted inside the
//same backpressure episode, short enough that a single transient throttle
//doesn't drag the rest of the sweep at half speed.
export const CLEAN_PAGES_TO_RESTORE = 8;

export type PaceState = {
	//Index into CONCURRENCY_LADDER.
	rung : number,
	//Clean pages since the last rung change.
	cleanPages : number,
	//Consecutive throttles without an intervening clean page — drives the
	//backoff exponent.
	consecutiveThrottles : number
};

export const initialPaceState = () : PaceState => ({rung: 0, cleanPages: 0, consecutiveThrottles: 0});

export const concurrencyForPace = (state : PaceState) : number => CONCURRENCY_LADDER[state.rung];

export const paceOnThrottle = (state : PaceState) : PaceState => ({
	rung: Math.min(state.rung + 1, CONCURRENCY_LADDER.length - 1),
	cleanPages: 0,
	consecutiveThrottles: state.consecutiveThrottles + 1
});

export const paceOnCleanPage = (state : PaceState) : PaceState => {
	const cleanPages = state.cleanPages + 1;
	if (state.rung > 0 && cleanPages >= CLEAN_PAGES_TO_RESTORE) {
		return {rung: state.rung - 1, cleanPages: 0, consecutiveThrottles: 0};
	}
	return {rung: state.rung, cleanPages, consecutiveThrottles: 0};
};

//Backoff before retrying a throttled page: 1s, 2s, 4s, ... capped.
export const THROTTLE_BACKOFF_BASE_MS = 1000;
export const THROTTLE_BACKOFF_MAX_MS = 60 * 1000;
export const throttleBackoffMs = (consecutiveThrottles : number) : number =>
	Math.min(THROTTLE_BACKOFF_BASE_MS * Math.pow(2, Math.max(consecutiveThrottles - 1, 0)), THROTTLE_BACKOFF_MAX_MS);

//Firestore surfaces backpressure as code 'resource-exhausted' (sometimes
//prefixed, e.g. 'firestore/resource-exhausted').
export const isResourceExhausted = (error : unknown) : boolean => {
	if (error && typeof error === 'object') {
		const code = (error as {code? : unknown}).code;
		if (typeof code === 'string' && code.includes('resource-exhausted')) return true;
	}
	return String(error).includes('resource-exhausted');
};
