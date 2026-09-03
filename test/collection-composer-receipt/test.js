/*eslint-env node, es2022*/

//The receipt is asserted through the SNACKBAR QUEUE (app.snackbars) and the
//module that records where the receipt points, because that is the contract the
//app now has: showSnackbar(message, {kind, action: {label, actionID},
//dedupeKey}) pushes a SnackbarMessage, and a serializable actionID resolves to
//a registered thunk. The previous version of this file asserted
//state.snackbarMessage/snackbarAction/snackbarExpectedLocation, three fields
//that no longer exist.

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('', { url: 'https://example.com/c/everything/starred/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let appReducer;
let PUSH_SNACKBAR;
let DISMISS_SNACKBAR;
let receipt;

const message = (overrides = {}) => ({
	id: 'snackbar-1',
	message: 'Now showing Everything AND Starred · 4 cards',
	kind: 'info',
	durationMs: 10000,
	action: { label: 'Undo', actionID: 'undo-collection-navigation' },
	dedupeKey: 'collection-navigation-receipt',
	...overrides,
});

describe('Collection Composer navigation receipt', () => {
	before(async () => {
		appReducer = (await import('../../lib/src/reducers/app.js')).default;
		({ PUSH_SNACKBAR, DISMISS_SNACKBAR } = await import(
			'../../lib/src/actions.js'
		));
		receipt = await import('../../lib/src/collection-composer-receipt.js');
	});

	it('queues a semantic message carrying an Undo action', () => {
		const state = appReducer(undefined, {
			type: PUSH_SNACKBAR,
			message: message(),
		});
		assert.strictEqual(state.snackbars.length, 1);
		assert.strictEqual(
			state.snackbars[0].message,
			'Now showing Everything AND Starred · 4 cards'
		);
		//'info', not a write-outcome word: nothing reached a server.
		assert.strictEqual(state.snackbars[0].kind, 'info');
		assert.deepStrictEqual(state.snackbars[0].action, {
			label: 'Undo',
			actionID: 'undo-collection-navigation',
		});
	});

	it('replaces the previous receipt rather than stacking a second one', () => {
		const first = appReducer(undefined, {
			type: PUSH_SNACKBAR,
			message: message(),
		});
		const second = appReducer(first, {
			type: PUSH_SNACKBAR,
			message: message({ id: 'snackbar-2', message: 'Now showing Starred' }),
		});
		assert.strictEqual(second.snackbars.length, 1);
		assert.strictEqual(second.snackbars[0].id, 'snackbar-2');
	});

	it('drops the receipt from the queue when it is dismissed', () => {
		const open = appReducer(undefined, {
			type: PUSH_SNACKBAR,
			message: message(),
		});
		const closed = appReducer(open, {
			type: DISMISS_SNACKBAR,
			snackbarID: 'snackbar-1',
		});
		assert.deepStrictEqual(closed.snackbars, []);
	});

	it('records one pending return path, invalidated by the next one', () => {
		receipt.clearCollectionNavigationReceipt();
		assert.strictEqual(receipt.pendingCollectionNavigationReceipt(), '');
		receipt.recordCollectionNavigationReceipt('/c/everything/starred/');
		assert.strictEqual(
			receipt.pendingCollectionNavigationReceipt(),
			'/c/everything/starred/'
		);
		receipt.recordCollectionNavigationReceipt('/c/everything/reads/');
		assert.strictEqual(
			receipt.pendingCollectionNavigationReceipt(),
			'/c/everything/reads/'
		);
		receipt.clearCollectionNavigationReceipt();
		assert.strictEqual(receipt.pendingCollectionNavigationReceipt(), '');
	});

	it('reads the current location as path plus search plus hash', () => {
		assert.strictEqual(
			receipt.currentBrowserLocation(),
			'/c/everything/starred/'
		);
	});

	//UPDATED FOR THE UNDO REDESIGN, not weakened. The recorded slot used to be
	//the DESTINATION and Undo was history.back(), so the guard asked "is the user
	//still where the receipt sent them?". It now records where to RETURN and
	//navigates there, so the only question left is "is that return still
	//meaningful?" — the two tests below pin that inverted contract, and the third
	//pins the fact that retired the old alias machinery entirely.
	it('only undoes while the recorded collection is somewhere else', () => {
		assert.strictEqual(
			receipt.collectionReceiptCanUndo(
				'/c/main/',
				'/c/everything/starred/'
			),
			true
		);
		//Already back at the recorded collection: nothing left to undo.
		assert.strictEqual(
			receipt.collectionReceiptCanUndo('/c/main/', '/c/main/'),
			false
		);
		assert.strictEqual(receipt.collectionReceiptCanUndo('', ''), false);
		//A return path that names no collection this app can express is not a
		//promise it can keep.
		assert.strictEqual(receipt.collectionReceiptCanUndo('/maintenance', '/c/main/'), false);
	});

	it('compares collections, not URL spellings', () => {
		//`/c/` and `/c/main/sort/default/` are one collection said two ways. A
		//byte comparison would offer an Undo that navigates nowhere.
		assert.strictEqual(
			receipt.collectionReceiptCanUndo('/c/', '/c/main/sort/default/'),
			false
		);
		assert.strictEqual(
			receipt.collectionReceiptCanUndo('/c/main/', '/c/main/starred/'),
			true
		);
	});

	//THE DEFECT THIS REDESIGN EXISTS FOR. The commit auto-selects a card and the
	//route then canonicalizes its ID to the preferred slug, so the old guard —
	//which required the live URL's card to alias the recorded one — refused an
	//Undo pressed with no user action in between. A collection-level undo does
	//not care which card is showing, at either end.
	it('ignores the card entirely, at both ends', () => {
		assert.strictEqual(
			receipt.collectionReceiptCanUndo(
				'/c/main/card-id',
				'/c/everything/starred/preferred-slug'
			),
			true
		);
		assert.strictEqual(
			receipt.collectionReceiptCanUndo(
				'/c/main/card-id',
				'/c/main/a-completely-different-card'
			),
			false,
			'a different card in the recorded collection is still the recorded collection'
		);
		//A query string decorates the route; it does not name a second collection.
		assert.strictEqual(
			receipt.collectionReceiptCanUndo(
				'/c/main/card-id',
				'/c/main/preferred-slug?composer=1'
			),
			false
		);
	});
});
