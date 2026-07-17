//The navigation receipt's location bookkeeping, kept out of the component so it
//can be unit tested without a DOM or a store.
//
//A snackbar action is a SERIALIZABLE id with no payload (types.ts: "never a
//function"), so the location the receipt promises to return from cannot ride
//along in the message. It lives here instead.

export const currentBrowserLocation = () : string =>
	`${window.location.pathname}${window.location.search}${window.location.hash}`;

//The location of the destination the visible receipt describes.
//
//ONE slot, deliberately. showSnackbar's dedupeKey replaces the visible receipt
//in place rather than stacking a second one, so at most one receipt can be
//pressed — and a second navigation must invalidate the first one's promise as
//well as its message. Overwriting the slot is exactly that invalidation.
let pendingReceiptLocation = '';

export const recordCollectionNavigationReceipt = (expectedLocation : string) : void => {
	pendingReceiptLocation = expectedLocation;
};

export const pendingCollectionNavigationReceipt = () : string => pendingReceiptLocation;

export const clearCollectionNavigationReceipt = () : void => {
	pendingReceiptLocation = '';
};

//Undo only while the user is still where the receipt said they were. If they
//have navigated on since, walking history back would reverse something they
//never asked about.
export const collectionReceiptCanUndo = (
	expectedLocation: string,
	currentLocation: string
) : boolean => Boolean(expectedLocation) && expectedLocation === currentLocation;
