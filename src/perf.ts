//Debug-only performance instrumentation. Off by default; enable from the
//console with `DEBUG_PERF.enable()` (persists via localStorage) then interact
//with the app and call `DEBUG_PERF.dump()` to see per-action dispatch timing
//(including synchronous subscriber/render work) and hot-path counters.

import {
	Middleware
} from 'redux';

type PerfStats = {
	count : number,
	totalMs : number,
	maxMs : number
};

const LOCAL_STORAGE_KEY = 'debug-perf';

//Dispatches longer than this get logged as they happen.
const SLOW_DISPATCH_THRESHOLD_MS = 16;

const actionStats : Record<string, PerfStats> = {};
const counters : Record<string, number> = {};

const readEnabled = () : boolean => {
	try {
		return window.localStorage.getItem(LOCAL_STORAGE_KEY) === '1';
	} catch {
		return false;
	}
};

let enabled = typeof window !== 'undefined' && readEnabled();

export const perfEnabled = () : boolean => enabled;

//Increment a named counter (only when instrumentation is on). Cheap enough to
//leave on hot paths permanently.
export const perfCount = (name : string, delta = 1) : void => {
	if (!enabled) return;
	counters[name] = (counters[name] || 0) + delta;
};

//Record an externally-measured duration under a named bucket.
export const perfRecord = (name : string, durationMs : number) : void => {
	if (!enabled) return;
	const stats = actionStats[name] || (actionStats[name] = {count: 0, totalMs: 0, maxMs: 0});
	stats.count++;
	stats.totalMs += durationMs;
	if (durationMs > stats.maxMs) stats.maxMs = durationMs;
};

export const perfMiddleware : Middleware = () => next => action => {
	if (!enabled) return next(action);
	const type = (action && typeof action === 'object' && 'type' in action) ? String((action as {type: unknown}).type) : '<thunk>';
	const start = performance.now();
	const result = next(action);
	const duration = performance.now() - start;
	perfRecord('dispatch:' + type, duration);
	if (duration > SLOW_DISPATCH_THRESHOLD_MS) {
		console.log(`[PERF] dispatch ${type}: ${duration.toFixed(1)}ms`);
	}
	return result;
};

const dump = () : void => {
	const rows = Object.entries(actionStats).map(([name, stats]) => ({
		name,
		count: stats.count,
		total_ms: Math.round(stats.totalMs * 10) / 10,
		avg_ms: Math.round((stats.totalMs / stats.count) * 100) / 100,
		max_ms: Math.round(stats.maxMs * 10) / 10
	})).sort((a, b) => b.total_ms - a.total_ms);
	console.table(rows);
	console.table(Object.entries(counters).map(([name, count]) => ({name, count})).sort((a, b) => b.count - a.count));
};

const reset = () : void => {
	for (const key of Object.keys(actionStats)) delete actionStats[key];
	for (const key of Object.keys(counters)) delete counters[key];
};

//Machine-readable snapshot of the collected stats, for programmatic consumers
//like the perf harness (test/perf-harness/). dump() is for humans
//(console.table); data() returns a JSON-serializable deep copy so a harness
//can assert against the Appendix-A budgets and the counter invariants.
const data = () : {actionStats : Record<string, PerfStats>, counters : Record<string, number>} => ({
	actionStats: Object.fromEntries(Object.entries(actionStats).map(([name, stats]) => [name, {...stats}])),
	counters: {...counters},
});

declare global {
	interface Window {
		DEBUG_PERF: {
			enable: () => void,
			disable: () => void,
			dump: () => void,
			reset: () => void,
			data: () => {actionStats : Record<string, PerfStats>, counters : Record<string, number>},
		};
	}
}

if (typeof window !== 'undefined') {
	window.DEBUG_PERF = {
		enable: () => {
			enabled = true;
			try {
				window.localStorage.setItem(LOCAL_STORAGE_KEY, '1');
			} catch {
				//Best effort
			}
			console.log('Perf instrumentation enabled. Interact with the app, then DEBUG_PERF.dump().');
		},
		disable: () => {
			enabled = false;
			try {
				window.localStorage.removeItem(LOCAL_STORAGE_KEY);
			} catch {
				//Best effort
			}
		},
		dump,
		reset,
		data,
	};
}
