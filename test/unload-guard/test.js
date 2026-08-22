/*eslint-env node, es2022*/

//DOES THE BEFOREUNLOAD GUARD ACTUALLY FIRE? (#770)
//
//The guard existed, read correctly, and demonstrably did not fire: Ctrl-W
//closed a tab mid-edit with no prompt. The only executable assertion about it
//was a source-text regex (test/service-worker-update), which passes whether
//or not the listener ever registers at runtime — it green-lit the regression.
//
//These tests mount the REAL <card-web-app> element in jsdom and dispatch real
//beforeunload events, pinning the three halves of the #770 fix:
//  - the guard is registered by connectedCallback (before first render and
//    before firstUpdated's installer dispatches, any of which used to be able
//    to throw and silently skip the registration);
//  - a disconnect/reconnect re-arms it (registration used to live in
//    firstUpdated, which never runs twice, so any reconnect dropped the guard
//    permanently);
//  - ANY open editor arms it, not just a non-empty redux diff — the
//    contenteditable and redux can diverge by design (#347's normalize-back
//    skip), so "diff is non-empty" under-protected.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom, store} = app;

//stateChanged runs real selector chains (selectActiveCard reaches the card
//processing layer), so the fake state must be the REAL store state with
//targeted overrides, not a hand-built husk.
const stateWith = ({editing = false, data = {}} = {}) => {
	const base = store.getState();
	return {
		...base,
		editor: {...base.editor, editing},
		data: {...base.data, ...data},
	};
};

const fireBeforeUnload = () => {
	const event = new dom.window.Event('beforeunload', {cancelable: true});
	dom.window.dispatchEvent(event);
	return event;
};

describe('the beforeunload guard, mounted for real (#770)', () => {

	let element;

	before(async function() {
		this.timeout(20000);
		await import('../../lib/src/components/card-web-app.js');
		element = dom.window.document.createElement('card-web-app');
		dom.window.document.body.appendChild(element);
		//One microtask turn for lit's first update cycle.
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	after(() => {
		element.remove();
	});

	beforeEach(() => {
		//Reset to a quiescent state.
		element.stateChanged(stateWith());
	});

	it('does not block exit when nothing is at risk', () => {
		const event = fireBeforeUnload();
		assert.strictEqual(event.defaultPrevented, false);
	});

	it('blocks exit while an editor is open, even with a clean redux diff', () => {
		//The #770 arming decision: state.editor.editing alone is enough. A
		//keystroke that normalizes back to the stored value leaves redux
		//clean while the contenteditable visibly shows the user's text.
		element.stateChanged(stateWith({editing: true}));
		const event = fireBeforeUnload();
		assert.strictEqual(event.defaultPrevented, true,
			'an open editor must arm the guard');
	});

	it('blocks exit while modifications are pending', () => {
		element.stateChanged(stateWith({data: {pendingModificationCount: 3}}));
		const event = fireBeforeUnload();
		assert.strictEqual(event.defaultPrevented, true);
	});

	it('still guards after a disconnect/reconnect cycle', async () => {
		//Registration used to live in firstUpdated; removal in
		//disconnectedCallback. One reconnect therefore dropped the guard
		//forever. connectedCallback re-arms it now.
		element.remove();
		element.stateChanged(stateWith({editing: true}));
		const detachedEvent = fireBeforeUnload();
		assert.strictEqual(detachedEvent.defaultPrevented, false,
			'a disconnected element must not intercept unload');
		dom.window.document.body.appendChild(element);
		await new Promise(resolve => setTimeout(resolve, 0));
		element.stateChanged(stateWith({editing: true}));
		const event = fireBeforeUnload();
		assert.strictEqual(event.defaultPrevented, true,
			'the reconnected element must guard again');
	});

	it('the store subscription itself drives stateChanged (connect-mixin wiring)', () => {
		//The other tests call stateChanged directly, which would pass even if
		//super.connectedCallback() never subscribed. Prove the wiring: a real
		//store dispatch must reach this element.
		let calls = 0;
		const original = element.stateChanged.bind(element);
		element.stateChanged = (state) => { calls++; original(state); };
		try {
			store.dispatch({type: 'UPDATE_CORPUS_STATUS', status: 'live', message: ''});
			assert.ok(calls > 0, 'a store dispatch must reach the mounted element');
		} finally {
			delete element.stateChanged;
		}
	});

	it('the guard reads live state: closing the editor disarms it', () => {
		element.stateChanged(stateWith({editing: true}));
		assert.strictEqual(fireBeforeUnload().defaultPrevented, true);
		element.stateChanged(stateWith());
		assert.strictEqual(fireBeforeUnload().defaultPrevented, false,
			'a finished editing session must release the exit guard');
	});
});
