/* eslint-env node, mocha, es2022 */

//The three selectors that call the diff directly (default set, reading
//list, reading-list snapshot) bypassed the shared delta: after a one-card
//echo each walked both 40k-card maps itself. Routing them through
//sharedDiffCards lets them hit the exact delta the reducer published, so
//no map is enumerated at all. The branch this came from only had a browser
//probe for this; reverting the direct callers to diffCards passed every
//Node suite. This test counts enumerations of the two maps.

import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

const dataReducer = (await import('../../lib/src/reducers/data.js')).default;
const {UPDATE_CARDS, UPDATE_SECTIONS} = await import('../../lib/src/actions.js');
const {selectDefaultSet} = await import('../../lib/src/selectors.js');

const card = (id, extra = {}) => ({id, card_type: 'content', slugs: [], section: 'main', sort_order: 1, ...extra});

//Count how many times Object.entries is asked to walk either of the given
//maps; diffCards walks both, a known delta walks neither.
const countWalks = (maps, fn) => {
	const original = Object.entries;
	let walks = 0;
	Object.entries = function(target) {
		if (maps.includes(target)) walks++;
		return original.call(this, target);
	};
	try {
		return [fn(), walks];
	} finally {
		Object.entries = original;
	}
};

describe('direct diff callers use the shared delta', () => {
	it('selectDefaultSet does not walk either card map after a reducer-published single-card echo', () => {
		let data = dataReducer(undefined, {type: '@@INIT'});
		data = dataReducer(data, {type: UPDATE_SECTIONS, sections: {main: {id: 'main', cards: [], title: 'Main'}}, complete: true});
		const cards = Object.fromEntries(Array.from({length: 1000}, (_, i) => ['c' + i, card('c' + i, {sort_order: i})]));
		data = dataReducer(data, {type: UPDATE_CARDS, cards, fetchType: 'published'});
		const before = {data};
		const original = selectDefaultSet(before);
		assert.equal(original.length, 1000);
		//A metadata-only echo: the default set must be the same object and
		//must be decided without enumerating either map.
		const after = {data: dataReducer(data, {type: UPDATE_CARDS, cards: {c3: card('c3', {sort_order: 3, notes: 'echo'})}, fetchType: 'published'})};
		const [result, walks] = countWalks([before.data.cards, after.data.cards], () => selectDefaultSet(after));
		assert.strictEqual(result, original, 'the default set is unchanged');
		assert.equal(walks, 0, 'neither card map was enumerated');
		//And a real change is still seen.
		const moved = {data: dataReducer(after.data, {type: UPDATE_CARDS, cards: {c3: card('c3', {sort_order: 5000})}, fetchType: 'published'})};
		assert.notStrictEqual(selectDefaultSet(moved), original, 'a sort_order change recomputes');
	});
});
