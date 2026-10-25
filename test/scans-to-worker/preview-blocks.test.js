/*eslint-env node, es2022*/

//THE HOVER PREVIEW'S BLOCKS DO NOT RE-RENDER MAIN-VIEW ON EVERY STORE CHANGE
//(#777 step 2). The first cut assigned a fresh [] per stateChanged while
//nothing was hovered; the property is reactive state compared by identity,
//so the whole view re-rendered on every dispatch (the review measured 100 of
//100). The real component is mounted and driven by stateChanged.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

describe('the hover preview blocks keep their identity while nothing is hovered', () => {
	let element;
	let state;
	before(async () => {
		const app = await bootstrapApp();
		await import('../../lib/src/components/main-view.js');
		element = app.dom.window.document.createElement('main-view');
		state = app.store.getState();
		element.stateChanged(state);
	});

	it('assigns the blocks only when they change', () => {
		const before = element._previewCardReferenceBlocks;
		assert.ok(Array.isArray(before) && before.length === 0, 'no preview card, no blocks');
		let changes = 0;
		for (let i = 0; i < 100; i++) {
			element.stateChanged({...state, app: {...state.app}});
			if (element._previewCardReferenceBlocks !== before) changes++;
		}
		assert.strictEqual(changes, 0, 'the empty blocks value is stable across unrelated state changes');
	});
});
