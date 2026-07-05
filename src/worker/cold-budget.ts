//Pure budget math for the cold-sweep path (docs/corpus-sync-design.md,
//Phase 2): a brand-new device must read the whole corpus once (~60k docs at
//the prod ceiling), which exceeds the free tier's 50k reads/day — so the
//sweep spends at most COLD_SWEEP_DAILY_BUDGET per Firestore quota day and
//pauses until the next reset, leaving headroom for routine use.

//Firestore's free-tier daily quota resets around midnight US-Pacific. A
//fixed UTC-8 approximation is fine for BUDGETING (during PDT we reset an
//hour late, which only means resuming an hour later than strictly needed).
const PACIFIC_OFFSET_MS = 8 * 60 * 60 * 1000;

export const COLD_SWEEP_DAILY_BUDGET = 42000;
export const COLD_SWEEP_PAGE_SIZE = 500;
export const COLD_SWEEP_PRIORITY_COUNT = 5000;

//The quota-day key for a given epoch-ms instant.
export const pacificDayKey = (nowMs : number) : string => new Date(nowMs - PACIFIC_OFFSET_MS).toISOString().slice(0, 10);

//Milliseconds until the next quota-day boundary (plus a small fixed slack
//so we never resume seconds before the reset).
export const msUntilNextPacificDay = (nowMs : number) : number => {
	const intoDay = (nowMs - PACIFIC_OFFSET_MS) % (24 * 60 * 60 * 1000);
	return (24 * 60 * 60 * 1000) - intoDay + 60 * 1000;
};

//Reads spent so far this quota day, rolling over when the day changes.
export const rolledOverReads = (readsToday : number, day : string, nowMs : number) : {readsToday : number, day : string} => {
	const today = pacificDayKey(nowMs);
	if (day === today) return {readsToday, day};
	return {readsToday: 0, day: today};
};

export const budgetExhausted = (readsToday : number) : boolean => readsToday >= COLD_SWEEP_DAILY_BUDGET;
