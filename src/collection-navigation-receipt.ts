//THE RECEIPT A COLLECTION NAVIGATION LEAVES BEHIND, and the Undo that presses
//it back.
//
//This used to live inside configure-collection-dialog, which was correct while
//the composer was the only thing that could change the collection you are
//looking at. It no longer is: the drawer sentence's pills remove a clause and
//navigate on the spot (proposal D's down-payment), and a navigation reported
//two different ways by two surfaces is exactly the drift the receipt exists to
//prevent. So the message and the Undo move here, TOGETHER — the registry maps a
//serializable id to a thunk, and keeping the registration in the same module
//that shows the message is what makes the mapping true by construction rather
//than by boot ordering.
//
//The bookkeeping half — which path the receipt promises to return to — stays in
//collection-composer-receipt.ts, which is deliberately free of the store and the
//DOM so it can be unit tested without either.

import {
	navigatePathToResult,
	registerSnackbarAction,
	showSnackbar,
} from './actions/app.js';

import {
	clearCollectionNavigationReceipt,
	collectionReceiptCanUndo,
	currentBrowserLocation,
	pendingCollectionNavigationReceipt,
	recordCollectionNavigationReceipt,
} from './collection-composer-receipt.js';

import {
	formatCollectionCardCount,
} from './collection-composer-preview.js';

import {
	store,
} from './store.js';

export const UNDO_COLLECTION_NAVIGATION_ACTION_ID = 'undo-collection-navigation';

export const COLLECTION_NAVIGATION_RECEIPT_DEDUPE_KEY = 'collection-navigation-receipt';

//A refusal is never silent (HOUSE-STYLE §3.5). Sentence case, second person,
//contractions used consistently (§2.3), U+2019 apostrophes (§2.2), and it
//reports rather than scolds — being back already is not a mistake.
const UNDO_ALREADY_BACK_MESSAGE = 'You’re already back at that collection, so there’s nothing to undo.';

export const UNDO_BLOCKED_BY_EDIT_MESSAGE = 'Finish or cancel the current card edit before undoing this.';

registerSnackbarAction(UNDO_COLLECTION_NAVIGATION_ACTION_ID, (dispatch) => {
	const returnPath = pendingCollectionNavigationReceipt();
	clearCollectionNavigationReceipt();
	//EVERY press produces an outcome. The old shape had two ways to do nothing
	//visible: a guard that refused an untouched receipt, and a history.back()
	//with nothing behind it. Undo now NAVIGATES to the collection the receipt
	//interrupted, so the only refusal left is the one that is actually true.
	//'refused' is the kind for something that did not happen with no data at
	//stake; 'committed'/'queued'/'discarded' are write outcomes and none apply.
	if (!collectionReceiptCanUndo(returnPath, currentBrowserLocation())) {
		dispatch(showSnackbar(UNDO_ALREADY_BACK_MESSAGE, {kind: 'refused'}));
		return;
	}
	const result = dispatch(navigatePathToResult(returnPath));
	if (result.status === 'committed') return;
	//'unchanged' cannot reach here (the guard just proved the collections
	//differ) but a blocked edit can, and it is the same refusal the composer's
	//own commit paths speak.
	dispatch(showSnackbar(result.status === 'blocked-editing' ?
		UNDO_BLOCKED_BY_EDIT_MESSAGE :
		UNDO_ALREADY_BACK_MESSAGE, {kind: 'refused'}));
});

//EVERY way of opening a collection reports it the same way. The composer's two
//commit paths were already two copies of this call, disagreeing about how to
//spell the card count, which is how a receipt and its Undo drift apart; the
//drawer's remove-and-go is now a third caller of the one copy.
export const showCollectionNavigationReceipt = (returnPath : string, expression : string, count : number | undefined) : void => {
	//Recorded BEFORE the message: the guard reads this slot, and the dedupeKey
	//replacing the visible receipt is what invalidates the previous one.
	//returnPath is where the user was BEFORE this navigation — captured by the
	//caller, because by the time this runs the URL is already the destination.
	recordCollectionNavigationReceipt(returnPath);
	//Hoisted rather than inlined: the copy-quality scanner reads the message
	//literal, and a nested template ends its parse early.
	//An em dash, not an interpunct: the interpunct is what joins the CLAUSES
	//inside `expression` now, and "Now showing Main · Tagged tag-1 · 158 cards"
	//offers the count as a fourth clause of the collection.
	const countSuffix = count === undefined ? '' : ` — ${formatCollectionCardCount(count)}`;
	store.dispatch(showSnackbar(
		`Now showing ${expression}${countSuffix}.`,
		{
			//'info', not 'committed'/'queued': nothing was written to a server.
			//Those are write-outcome words (snackbar-copy.ts).
			kind: 'info',
			action: {label: 'Undo', actionID: UNDO_COLLECTION_NAVIGATION_ACTION_ID},
			//One receipt at a time.
			dedupeKey: COLLECTION_NAVIGATION_RECEIPT_DEDUPE_KEY,
		}
	));
};
