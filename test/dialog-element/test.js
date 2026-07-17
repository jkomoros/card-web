/*eslint-env node*/

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('<button id="invoker">Open</button>', {url: 'https://example.com'});
for (const name of [
	'window', 'document', 'Document', 'HTMLElement', 'Element', 'Node',
	'customElements', 'CSSStyleSheet', 'Event', 'CustomEvent', 'KeyboardEvent', 'ShadowRoot',
	'HTMLSlotElement',
]) globalThis[name] = name === 'window' ? dom.window : name === 'document' ? dom.window.document : dom.window[name];

describe('dialog-element', () => {
	let dialog;

	before(async () => {
		await import('../../lib/src/components/dialog-element.js');
	});

	beforeEach(async () => {
		dialog = document.createElement('dialog-element');
		dialog.title = 'Compose a collection';
		document.body.append(dialog);
		await dialog.updateComplete;
	});

	afterEach(() => dialog.remove());

	it('exposes a labelled modal and an accessible close control', async () => {
		dialog.open = true;
		await dialog.updateComplete;
		const modal = dialog.shadowRoot.querySelector('[role="dialog"]');
		assert.strictEqual(modal.getAttribute('aria-modal'), 'true');
		assert.strictEqual(modal.getAttribute('aria-labelledby'), 'dialog-title');
		assert.strictEqual(dialog.shadowRoot.querySelector('#dialog-title').textContent, 'Compose a collection');
		assert.strictEqual(dialog.shadowRoot.querySelector('#close').getAttribute('aria-label'), 'Close Compose a collection');
	});

	it('traps forward focus at the last control', async () => {
		dialog.open = true;
		await dialog.updateComplete;
		const close = dialog.shadowRoot.querySelector('#close');
		close.focus();
		const event = new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true});
		window.dispatchEvent(event);
		assert.strictEqual(event.defaultPrevented, true);
		assert.strictEqual(dialog.shadowRoot.activeElement, close);
	});

	it('includes focusable controls inside nested shadow roots', async () => {
		if (!customElements.get('nested-focus-control')) {
			customElements.define('nested-focus-control', class extends HTMLElement {
				constructor() {
					super();
					this.attachShadow({mode: 'open'}).innerHTML = '<button>Nested control</button>';
				}
			});
		}
		const nested = document.createElement('nested-focus-control');
		dialog.append(nested);
		dialog.open = true;
		await dialog.updateComplete;
		const nestedButton = nested.shadowRoot.querySelector('button');
		nestedButton.focus();
		const event = new KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true});
		window.dispatchEvent(event);
		assert.strictEqual(event.defaultPrevented, true);
		assert.strictEqual(dialog.shadowRoot.activeElement, dialog.shadowRoot.querySelector('#close'));
	});

	it('restores focus to the element that opened it', async () => {
		const invoker = document.querySelector('#invoker');
		invoker.focus();
		dialog.open = true;
		await dialog.updateComplete;
		dialog.open = false;
		await dialog.updateComplete;
		assert.strictEqual(document.activeElement, invoker);
	});

	it('ignores an Escape event already handled by a child', async () => {
		dialog.open = true;
		await dialog.updateComplete;
		let closeRequests = 0;
		dialog.addEventListener('dialog-should-close', () => closeRequests++);
		const event = new KeyboardEvent('keydown', {key: 'Escape', cancelable: true});
		event.preventDefault();
		window.dispatchEvent(event);
		assert.strictEqual(closeRequests, 0);
	});

	it('ignores Escape while an input method is composing', async () => {
		dialog.open = true;
		await dialog.updateComplete;
		let closeRequests = 0;
		dialog.addEventListener('dialog-should-close', () => closeRequests++);
		const event = new KeyboardEvent('keydown', {key: 'Escape', cancelable: true});
		Object.defineProperty(event, 'isComposing', {value: true});
		window.dispatchEvent(event);
		assert.strictEqual(closeRequests, 0);
	});
});
