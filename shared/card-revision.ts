//The card revision clock, and the admission rule every holder of a card
//image applies (zero imports so it can be unit-tested in Node and used by
//the worker, the main thread and the editor alike).
//
//Nothing on master ordered card images: the worker corpus, the main-thread
//store and the editor base all applied whichever image arrived last, and the
//only ordering token was `updated`, a server timestamp the client cannot
//know until the round trip completes. So a late, older listener image (for a
//just-created card, its blank create image) could overwrite a newer echo —
//the card briefly rendered empty — and the previous attempt at ordering by
//`updated` was reverted for client clock skew. `revision` is an integer the
//Rules advance by exactly one on every content write, so it is
//server-issued, skew-free and comparable before any timestamp resolves.

type Revisioned = {revision?: unknown} | null | undefined;

//Missing (legacy cards, pre-cutover snapshots) and junk both read as 0.
export const cardRevision = (card : Revisioned) : number => {
	const value = card?.revision;
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

//Accept iff the incoming image is at least as new as the held one. EQUAL is
//admitted on purpose: the counter paths (stars, threads) and the
//inbound-reference mirror do not bump, and the listener's refresh of a local
//echo carries the echo's own revision with the server's timestamps.
export const cardImageMayAdvance = (held : Revisioned, incoming : Revisioned) : boolean =>
	!held || cardRevision(incoming) >= cardRevision(held);

//Splits a batch of incoming images into the ones to apply and the ids
//refused as older than what `held` returns. Returns the SAME `incoming`
//object when nothing is refused, so callers can keep identity-based fast
//paths. Removals are not images and are never judged here.
export const admitCardImages = <C extends Revisioned>(incoming : {[id : string] : C}, held : (id : string) => Revisioned) : {admitted : {[id : string] : C}, refusedIDs : string[]} => {
	let admitted : {[id : string] : C} | null = null;
	const refusedIDs : string[] = [];
	for (const [id, image] of Object.entries(incoming)) {
		if (cardImageMayAdvance(held(id), image)) {
			if (admitted) admitted[id] = image;
			continue;
		}
		refusedIDs.push(id);
		if (!admitted) {
			admitted = {};
			for (const [priorID, priorImage] of Object.entries(incoming)) {
				if (priorID === id) break;
				admitted[priorID] = priorImage;
			}
		}
	}
	return {admitted: admitted || incoming, refusedIDs};
};
