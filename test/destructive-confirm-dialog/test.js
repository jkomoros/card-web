/*eslint-env node, es2022*/

//THE DESTRUCTIVE-CONFIRM DIALOG ANSWERS confirmDestructive (#708, #789).
//
//Until it is mounted, the seam falls back to the native confirm() — which the
//embedded browsers that block popups also suppress, answering "no" on the
//user's behalf. The real element is mounted in jsdom and driven the way a user
//would drive it: the question appears with its verb on the primary button,
//the verb resolves true, and Escape, the X and the backdrop each resolve
//false. Mounting installs the handler; unmounting uninstalls it.

import {JSDOM} from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('', {url: 'https://example.com/c/main/'});
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'MouseEvent',
	'KeyboardEvent', 'ShadowRoot', 'DocumentFragment', 'HTMLAnchorElement',
	'HTMLButtonElement', 'navigator', 'getComputedStyle', 'MutationObserver',
	'requestAnimationFrame',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];

const settle = async (element) => { for (let round = 0; round < 4; round++) await element.updateComplete; };

describe('destructive-confirm-dialog', () => {
	let store;
	let confirmDestructive;
	let selectModalRequests;
	let element;
	let nativeCalls = 0;

	before(async () => {
		globalThis.confirm = window.confirm = () => { nativeCalls++; return true; };
		({store} = await import('../../lib/src/store.js'));
		const {default: modal} = await import('../../lib/src/reducers/modal.js');
		const {default: app} = await import('../../lib/src/reducers/app.js');
		store.addReducers({modal, app});
		({confirmDestructive, selectModalRequests} = await import('../../lib/src/modal.js'));
		await import('../../lib/src/components/destructive-confirm-dialog.js');
		element = document.createElement('destructive-confirm-dialog');
		document.body.appendChild(element);
		await settle(element);
	});

	const ask = () => confirmDestructive({title: 'Switch Account', what: 'Switching leaves behind your 3 starred cards on this device.', verb: 'Switch account', detail: ['one', 'two'], survives: 'Cards you have read stay read.'});
	const shadow = () => element.shadowRoot;
	const buttons = () => [...shadow().querySelectorAll('.buttons button')];

	it('mounting installs the handler: the question is parked and rendered, not asked natively', async () => {
		const pending = ask();
		await Promise.resolve();
		assert.strictEqual(nativeCalls, 0, 'the native confirm is not reached');
		assert.strictEqual(selectModalRequests(store.getState()).length, 1);
		await settle(element);
		assert.strictEqual(element.open, true);
		assert.strictEqual(element.title, 'Switch Account');
		assert.strictEqual(shadow().querySelector('.content').getAttribute('role'), 'alertdialog');
		const text = shadow().querySelector('#inner').textContent.replace(/\s+/g, ' ').trim();
		assert.match(text, /Switching leaves behind your 3 starred cards on this device\./);
		assert.match(text, /one.*two/, 'the specifics are listed');
		assert.match(text, /Cards you have read stay read\./);
		assert.match(text, /This can’t be undone\./, 'the one approved irreversibility phrasing');
		const [cancel, primary] = buttons();
		assert.strictEqual(cancel.textContent.trim(), 'Cancel');
		assert.strictEqual(primary.textContent.trim(), 'Switch account', 'the action button repeats the verb');
		assert.ok(primary.classList.contains('primary'));
		primary.click();
		assert.strictEqual(await pending, true);
		await settle(element);
		assert.strictEqual(element.open, false);
		assert.strictEqual(selectModalRequests(store.getState()).length, 0);
	});

	it('Cancel, the X and the backdrop each answer no', async () => {
		for (const dismiss of [
			() => buttons()[0].click(),
			() => shadow().querySelector('#close').click(),
			() => { const background = shadow().querySelector('.background'); background.dispatchEvent(new window.MouseEvent('click', {bubbles: true, composed: true})); },
		]) {
			const pending = ask();
			await Promise.resolve();
			await settle(element);
			assert.strictEqual(element.open, true);
			dismiss();
			assert.strictEqual(await pending, false);
			await settle(element);
			assert.strictEqual(element.open, false);
		}
	});

	it('shows the last of several outstanding questions and answers them independently', async () => {
		const first = ask();
		await Promise.resolve();
		const second = confirmDestructive({title: 'Second', what: 'Second question.', verb: 'Do it'});
		await Promise.resolve();
		await settle(element);
		assert.strictEqual(element.title, 'Second', 'the newest request is the live one');
		buttons()[1].click();
		assert.strictEqual(await second, true);
		await settle(element);
		assert.strictEqual(element.title, 'Switch Account', 'the earlier request is live again');
		buttons()[0].click();
		assert.strictEqual(await first, false);
	});

	it('unmounting uninstalls the handler and settles what was parked', async () => {
		const pending = ask();
		await Promise.resolve();
		element.remove();
		assert.strictEqual(await pending, false, 'a parked question is answered no rather than stranded');
		const after = confirmDestructive({title: 'Native', what: 'Fallback.', verb: 'Go'});
		assert.strictEqual(await after, true);
		assert.strictEqual(nativeCalls, 1, 'with no dialog mounted the seam falls back to the native confirm');
		document.body.appendChild(element);
		await settle(element);
	});
});
