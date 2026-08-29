/*eslint-env node*/

//Pins the arrival-keyed new-card expectation: EXPECT_NEW_CARD records which
//card is coming without breaking the app's global loading state (whose dip
//force-showed the drawer and faded the stage for the whole creation round
//trip), and navigation keys on the pending card's OWN arrival — present in
//the cards map, and in its section's list when it has one — rather than on
//fetch-type loading flags that any unrelated delivery could clear first.

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

after(() => {
	dom.window.close();
	//Same reasoning as test.js: imports pull in Firebase's Node transport,
	//which parks a MessagePort this suite never uses.
	for (const handle of process._getActiveHandles()) {
		if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
	}
});

let dataReducer;
let EXPECT_NEW_CARD;
let EXPECTED_NEW_CARD_FAILED;
let selectPendingNewCardArrived;

const INITIAL = () => dataReducer(undefined, {type: '@@INIT'});

describe('new-card expectation is arrival-keyed', () => {
	before(async () => {
		dataReducer = (await import('../../lib/src/reducers/data.js')).default;
		({
			EXPECT_NEW_CARD,
			EXPECTED_NEW_CARD_FAILED,
		} = await import('../../lib/src/actions.js'));
		({
			selectPendingNewCardArrived,
		} = await import('../../lib/src/selectors.js'));
	});

	it('EXPECT_NEW_CARD records the expectation without touching global loading state', () => {
		const start = {
			...INITIAL(),
			sectionsLoaded: true,
			loadingCardFetchTypes: {'unpublished-author': true},
		};
		const next = dataReducer(start, {type: EXPECT_NEW_CARD, ID: 'new-card', cardType: 'working-notes', navigate: true});
		assert.strictEqual(next.pendingNewCardIDToNavigateTo, 'new-card');
		assert.strictEqual(next.pendingNewCardID, 'new-card');
		assert.strictEqual(next.pendingReorder, true);
		//The load-bearing part: creation must not make the app read as
		//"not fully loaded" — that dip force-showed the drawer for a fallback
		//collection and faded the card stage for the whole round trip.
		assert.strictEqual(next.sectionsLoaded, true);
		assert.deepStrictEqual(next.loadingCardFetchTypes, start.loadingCardFetchTypes);
	});

	it('EXPECTED_NEW_CARD_FAILED clears the expectation but not unrelated loading flags', () => {
		const start = {
			...INITIAL(),
			pendingReorder: true,
			pendingNewCardID: 'new-card',
			pendingNewCardIDToNavigateTo: 'new-card',
			loadingCardFetchTypes: {'unpublished': true},
		};
		const next = dataReducer(start, {type: EXPECTED_NEW_CARD_FAILED});
		assert.strictEqual(next.pendingNewCardIDToNavigateTo, '');
		assert.strictEqual(next.pendingNewCardID, '');
		assert.strictEqual(next.pendingReorder, false);
		//A failed creation must not cancel a genuine in-flight load that
		//happened to overlap it.
		assert.deepStrictEqual(next.loadingCardFetchTypes, start.loadingCardFetchTypes);
	});

	const stateWith = (data) => ({data: {...INITIAL(), sections: {}, ...data}});

	it('no pending card: not arrived', () => {
		assert.strictEqual(selectPendingNewCardArrived(stateWith({pendingNewCardIDToNavigateTo: ''})), false);
	});

	it('pending card absent from the cards map: not arrived', () => {
		assert.strictEqual(selectPendingNewCardArrived(stateWith({
			pendingNewCardIDToNavigateTo: 'new-card',
			cards: {},
		})), false);
	});

	it('an orphaned card arrives with the card itself', () => {
		assert.strictEqual(selectPendingNewCardArrived(stateWith({
			pendingNewCardIDToNavigateTo: 'new-card',
			cards: {'new-card': {id: 'new-card', section: ''}},
		})), true);
	});

	it('a sectioned card has not arrived until its section lists it', () => {
		const base = {
			pendingNewCardIDToNavigateTo: 'new-card',
			cards: {'new-card': {id: 'new-card', section: 'main'}},
		};
		assert.strictEqual(selectPendingNewCardArrived(stateWith({
			...base,
			sections: {main: {cards: ['other-card']}},
		})), false);
		assert.strictEqual(selectPendingNewCardArrived(stateWith({
			...base,
			sections: {main: {cards: ['other-card', 'new-card']}},
		})), true);
	});
});
