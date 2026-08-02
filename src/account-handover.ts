//Zero-import decision core for the same-session account handover reload, kept
//separate from corpus-bridge.ts so it can be unit tested without a Worker, a
//DOM or a Firestore runtime — the same split shared/card-write-guard.ts and
//src/durable-overwrite-guard.ts use.
//
//The hazard (S4, the same-session half): Firestore's persistent cache in the
//worker is a second, larger copy of the privileged corpus, unpublished bodies
//included. It cannot be cleared while the SDK instance is live, so sign-out
//RECORDS a purge request and the next worker BOOT deletes the database before
//Firestore opens it. But `purgePersistence` rides only the FIRST connect
//message — the one that creates the worker — and signing out and then signing
//in as a different account never reloads the page. So the new account kept
//running against the previous account's cache, on disk, until something else
//happened to reload.
//
//Reloading is blunt, and it is chosen deliberately over restarting the worker
//in place: the worker lifecycle is what ownership, the readiness gate and the
//whole boot path are built on, and a bespoke mid-session teardown is far more
//likely to break those than one reload on a rare auth transition.

export type AccountHandoverInput = {
	//The account that just signed in. Empty means signed out.
	uid : string,
	//The outgoing uid recorded by a sign-out, or '' if no purge is pending.
	pendingPurgeUid : string,
	//Whether a worker has ALREADY been connected in this page session.
	connectSent : boolean,
	//Whether an editor is open with work in it.
	editing : boolean,
	//Whether this page session already reloaded for the current pending purge.
	alreadyReloaded : boolean,
};

export type AccountHandoverDecision = 'reload' | 'no-handover' | 'boot-will-purge' | 'defer-editing' | 'already-reloaded';

export const accountHandoverDecision = (input : AccountHandoverInput) : AccountHandoverDecision => {
	//Signed out, or nothing was handed over: the caller's own same-account
	//cancellation covers `uid === pendingPurgeUid`, which is the common
	//sign-out-and-back-in case and must NOT cost a reload or a cold prime.
	if (!input.uid || !input.pendingPurgeUid || input.uid === input.pendingPurgeUid) return 'no-handover';
	//No worker has been connected yet in this page session, so the connect
	//about to be sent still carries purgePersistence. Reloading here would be a
	//spurious reload on an ordinary fresh boot — previous account signed out in
	//an EARLIER session, new account signing in now.
	if (!input.connectSent) return 'boot-will-purge';
	//NEVER reload over dirty work. This is the same promise the service-worker
	//update path makes, and an account switch is not a good enough reason to
	//break it. The purge request survives in localStorage, so the next ordinary
	//boot still honors it.
	if (input.editing) return 'defer-editing';
	//One shot per pending purge. If the purge itself fails, the request
	//survives — and without this guard every subsequent auth resolution would
	//reload, forever.
	if (input.alreadyReloaded) return 'already-reloaded';
	return 'reload';
};
