//The time-boxed auto-activation backstop for ignored update banners (#756).
//
//The update model is deliberately deferred: skipWaiting is false, and the
//new service worker activates only when the user clicks the banner (or
//every tab closes). A user who never clicks runs arbitrarily old app code
//against live Firestore data indefinitely — the "old shell mishandles new
//data" class, bounded only by their patience with the banner. The backstop:
//once a waiting worker has been waiting more than SEVEN DAYS, activate it
//automatically — but only when the same safety gates that guard the manual
//path pass (no dirty draft, no pending durable mutation). If a gate blocks,
//keep waiting and re-check rather than forcing it.
//
//Seven days rather than 24 hours, per the owner's decision on the issue:
//the bounded risk is real but not acute, and a tighter deadline means more
//surprise reloads for users with long-lived tabs. A week bounds staleness
//without ever interrupting a working session (the reload still only happens
//when the safety gates say the session has nothing to lose).
//
//"How long has it been waiting" is recorded in localStorage as the first
//time THIS CLIENT observed a waiting worker, cleared when an activation
//goes through (or when no worker is waiting). A newer deploy replacing the
//waiting worker does not reset the clock on purpose: the user has been
//ignoring an update since firstSeen, whichever build it currently is.

export const UPDATE_AUTO_ACTIVATE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

//How often a live tab re-evaluates the backstop while an update is waiting.
export const UPDATE_AUTO_ACTIVATE_RECHECK_MS = 60 * 60 * 1000;

const UPDATE_FIRST_SEEN_STORAGE_KEY = 'card-web-sw-update-first-seen-v1';

//The pure decision, separated so tests can pin the deadline and the gates
//without a service worker: activate only when a waiting worker was first
//seen more than the deadline ago AND nothing unsafe is in flight
//(unsafeReason is the same string the manual path's banner shows — empty
//means the gates pass).
export const shouldAutoActivateUpdate = (firstSeenMs : number | null, nowMs : number, unsafeReason : string) : boolean => {
	if (firstSeenMs === null) return false;
	if (unsafeReason) return false;
	return nowMs - firstSeenMs > UPDATE_AUTO_ACTIVATE_AFTER_MS;
};

export const readUpdateFirstSeen = (nowMs = Date.now()) : number | null => {
	try {
		if (typeof localStorage === 'undefined') return null;
		const raw = localStorage.getItem(UPDATE_FIRST_SEEN_STORAGE_KEY);
		if (!raw) return null;
		const value = Number(raw);
		//A garbage record fires immediately once gates pass (a surprise
		//reload), and a future-dated one (clock corrected backwards) leaves
		//the backstop inert until skew+7d; treat both as absent and let the
		//caller re-record from now.
		if (!Number.isFinite(value) || value <= 0 || value > nowMs) return null;
		return value;
	} catch {
		//Blocked storage: no durable clock, so the backstop simply never
		//fires. The manual banner still works.
		return null;
	}
};

//Records now as the first-seen time if nothing is recorded yet; returns the
//effective first-seen either way.
export const recordUpdateFirstSeen = (nowMs : number) : number => {
	const existing = readUpdateFirstSeen(nowMs);
	if (existing !== null) return existing;
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(UPDATE_FIRST_SEEN_STORAGE_KEY, String(nowMs));
	} catch {
		//Best-effort; see readUpdateFirstSeen.
	}
	return nowMs;
};

export const clearUpdateFirstSeen = () : void => {
	try {
		if (typeof localStorage !== 'undefined') localStorage.removeItem(UPDATE_FIRST_SEEN_STORAGE_KEY);
	} catch {
		//Best-effort; see readUpdateFirstSeen.
	}
};
