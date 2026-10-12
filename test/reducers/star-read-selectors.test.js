/* eslint-env node, mocha, es2022 */

//getCardHasStar / getCardIsRead are what the star and mark-read actions
//consult before dispatching. Reading `stars[id]` on a plain map answered
//true for a card whose id is an Object.prototype property name, so such a
//card could never be starred or marked read ("already starred!").

import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

const {getCardHasStar, getCardIsRead} = await import('../../lib/src/selectors.js');
const userReducer = (await import('../../lib/src/reducers/user.js')).default;

describe('star and read selectors use own keys', () => {
	it('a card named like an Object.prototype property is not starred or read until it is', () => {
		const user = userReducer(undefined, {type: '@@INIT'});
		const state = {user: {...user, stars: {real: true}, reads: {real: true}}};
		for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
			assert.equal(getCardHasStar(state, id), false, `${id} starred`);
			assert.equal(getCardIsRead(state, id), false, `${id} read`);
		}
		assert.equal(getCardHasStar(state, 'real'), true);
		assert.equal(getCardIsRead(state, 'real'), true);
		assert.equal(getCardHasStar(state, 'missing'), false);
	});
});
