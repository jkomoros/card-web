//The navigation receipt's location bookkeeping, kept out of the component so it
//can be unit tested without a DOM or a store.
//
//A snackbar action is a SERIALIZABLE id with no payload (types.ts: "never a
//function"), so the location the receipt promises to return to cannot ride
//along in the message. It lives here instead.

import { CollectionDescription } from './collection_description.js';

export const currentBrowserLocation = () : string =>
	`${window.location.pathname}${window.location.search}${window.location.hash}`;

//Where the visible receipt promises to put the user BACK.
//
//This used to be the DESTINATION, and Undo was window.history.back() behind a
//guard that the destination still matched the live URL. Both halves were wrong,
//and the live review caught them together: the commit itself auto-selects a card
//and the route then canonicalizes, so the URL has already moved by the time a
//human can reach the button — the guard refused an Undo pressed with zero user
//actions in between. And history.back() with nothing behind it does nothing at
//all, silently, which §3.5 does not allow.
//
//Recording where to RETURN and navigating there needs neither: the destination's
//own churn is irrelevant, and a navigation either commits or reports why not.
//
//ONE slot, deliberately. showSnackbar's dedupeKey replaces the visible receipt
//in place rather than stacking a second one, so at most one receipt can be
//pressed — and a second navigation must invalidate the first one's promise as
//well as its message. Overwriting the slot is exactly that invalidation.
let pendingReceiptReturnPath = '';

export const recordCollectionNavigationReceipt = (returnPath : string) : void => {
	pendingReceiptReturnPath = returnPath;
};

export const pendingCollectionNavigationReceipt = () : string => pendingReceiptReturnPath;

export const clearCollectionNavigationReceipt = () : void => {
	pendingReceiptReturnPath = '';
};

//The collection a `/c/` route names, or null for a route that names none.
const collectionAt = (location : string) : CollectionDescription | null => {
	try {
		const url = new URL(location, 'https://collection-receipt.invalid');
		if (!url.pathname.startsWith('/c/')) return null;
		return CollectionDescription.deserializeWithExtra(url.pathname.slice(3))[0];
	} catch {
		return null;
	}
};

//Undo re-opens the collection the receipt interrupted, so it is a COLLECTION
//-level undo. The only thing that makes it meaningless is already standing in
//that collection; which cards the user has looked at since — including the one
//the commit selected for them — does not.
export const collectionReceiptCanUndo = (
	returnPath : string,
	currentLocation : string
) : boolean => {
	if (!returnPath) return false;
	const target = collectionAt(returnPath);
	//Nothing to return to that this app can express as a collection.
	if (!target) return false;
	const current = collectionAt(currentLocation);
	if (!current) return true;
	return !target.equivalent(current);
};
