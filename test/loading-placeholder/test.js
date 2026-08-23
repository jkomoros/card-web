/*eslint-env node, es2022*/

//THE LOADING STATE GETS ONE TREATMENT
//
//HOUSE-STYLE §3.6 names four temporal states and loading was the only one with
//no shared primitive. An audit found EIGHT competing idioms for it. Four of them
//already agreed on a vocabulary; this element codifies that rather than adding a
//ninth.
//
//The assertions below are aimed at the things that have actually gone wrong on
//this branch — a claim asserted without checking, a count invented, a token that
//fails contrast, a component that could never render — rather than at restating
//the implementation.

import assert from 'assert';
import {bootstrapApp} from '../harness-support/app-harness.js';

const app = await bootstrapApp();
const {dom} = app;

const {loadingLabel} = await import('../../lib/src/components/loading-placeholder.js');

const make = async (props = {}) => {
	const element = dom.window.document.createElement('loading-placeholder');
	Object.assign(element, props);
	dom.window.document.body.appendChild(element);
	await element.updateComplete;
	return element;
};

//jsdom has no adoptedStyleSheets, so lit falls back to a <style> element inside
//the shadow root and shadowRoot.textContent would include the whole stylesheet.
const textOf = element => [...element.shadowRoot.children]
	.filter(node => node.tagName !== 'STYLE')
	.map(node => node.textContent)
	.join(' ')
	.replace(/\s+/g, ' ')
	.trim();

describe('the loading placeholder', () => {

	describe('what it says', () => {

		it('names WHICH thing has not arrived', async () => {
			const element = await make({noun: 'cards'});
			assert.strictEqual(textOf(element), 'Loading cards…', 'a bare "Loading..." tells the user nothing they did not know');
			element.remove();
		});

		//§2.2 MUST. Six of the eight idioms it replaces shipped ASCII dots.
		it('uses the Unicode ellipsis', async () => {
			const element = await make({noun: 'cards'});
			assert.ok(textOf(element).includes('…'), 'the ellipsis must be U+2026');
			assert.ok(!textOf(element).includes('...'), 'and never three ASCII periods');
			element.remove();
		});

		it('renders nothing rather than "Loading undefined…"', async () => {
			const element = await make({});
			assert.strictEqual(textOf(element), '');
			element.remove();
		});

		it('adds a subordinate second line when the app knows why the wait is long', async () => {
			const element = await make({noun: 'the response', detail: 'This can take up to a minute.'});
			assert.ok(textOf(element).includes('This can take up to a minute.'));
			element.remove();
		});

	});

	describe('counts are honest or absent', () => {

		it('shows a real fraction when the total is known', async () => {
			const element = await make({noun: 'the search index', value: 12400, total: 40225});
			const text = textOf(element);
			assert.ok(text.includes('12,400'), 'the count should be grouped for readability');
			assert.ok(text.includes('40,225'));
			element.remove();
		});

		//§3.6.3 MUST: never invent a denominator.
		it('never invents a denominator when the total is unknown', async () => {
			const element = await make({noun: 'cards', value: 812, total: 0});
			const text = textOf(element);
			assert.ok(text.includes('812 so far'), 'an unknown total reads as "so far"');
			assert.ok(!text.includes(' of '), 'a fabricated total is worse than no total');
			assert.ok(!text.includes('/'));
			element.remove();
		});

		it('says nothing about counts when it has none', async () => {
			const element = await make({noun: 'cards'});
			assert.strictEqual(textOf(element), 'Loading cards…');
			element.remove();
		});

	});

	describe('the partial case, where stale content is still on screen', () => {

		//card-drawer's comments explain why: dimming an EMPTY scroller
		//communicates nothing, and "0 cards" on a stale list is a lie.
		it('switches to a non-blocking pin instead of a full line', async () => {
			const element = await make({noun: 'cards', partial: true});
			assert.strictEqual(textOf(element), 'updating…', 'once content is showing, the message becomes a pin');
			element.remove();
		});

		//The dim belongs to the HOST's scroller, which owns the scroll position.
		//Wrapping the content here would take ownership of something this
		//element has no business owning — card-drawer HIDES rather than
		//destroys precisely to keep that scroll position.
		it('exports the dim as a stylesheet for the host rather than wrapping content', async () => {
			const module = await import('../../lib/src/components/loading-placeholder.js');
			assert.ok(module.LoadingSharedStyles, 'the host needs the dim, not this element');
			assert.ok(String(module.LoadingSharedStyles.cssText).includes('loading-dim'));
		});

	});

	describe('accessibility and motion', () => {

		it('announces politely, and never as an alert', async () => {
			const element = await make({noun: 'cards'});
			const live = element.shadowRoot.querySelector('[role=status]');
			assert.ok(live, 'arrival should be announced');
			assert.strictEqual(live.getAttribute('aria-live'), 'polite');
			assert.strictEqual(element.shadowRoot.querySelector('[role=alert]'), null, 'loading is not an emergency');
			assert.strictEqual(element.shadowRoot.querySelector('[aria-live=assertive]'), null);
			element.remove();
		});

		//chat-view animated a loading state with no reduced-motion guard. That
		//is the thing not to copy.
		it('does not animate', async () => {
			const {readFileSync} = await import('fs');
			const source = readFileSync(new URL('../../src/components/loading-placeholder.ts', import.meta.url), 'utf8');
			assert.ok(!/@keyframes/.test(source), 'a pulsing loading state needs a reduced-motion guard; simpler not to pulse');
			assert.ok(/prefers-reduced-motion/.test(source), 'the dim transition still needs the guard');
		});

		//--app-dark-text-color-light is 2.32:1 on white and fails WCAG AA.
		//corpus-status-indicator and progress-panel both carry comments
		//rejecting it, and this branch already shipped that mistake once.
		it('does not de-emphasize with the token that fails contrast', async () => {
			const {readFileSync} = await import('fs');
			const source = readFileSync(new URL('../../src/components/loading-placeholder.ts', import.meta.url), 'utf8');
			assert.ok(!/color:\s*var\(--app-dark-text-color-light/.test(source), 'de-emphasize by SIZE, not by a grey that fails AA');
		});

	});

	describe('the delay, so a fast arrival does not flash', () => {

		it('renders nothing before the deadline, and the message after it', async () => {
			const element = await make({noun: 'cards', delayMs: 30});
			assert.strictEqual(textOf(element), '', 'a fast arrival should show nothing at all');

			await new Promise(resolve => setTimeout(resolve, 50));
			await element.updateComplete;
			assert.strictEqual(textOf(element), 'Loading cards…');
			element.remove();
		});

		//The snack bar's module-level timer is the bug this avoids repeating.
		it('leaves no timer behind when it is removed before the deadline', async () => {
			const element = await make({noun: 'cards', delayMs: 10000});
			assert.notStrictEqual(element._delayHandle, null, 'precondition: a timer should be pending');

			element.remove();
			element.disconnectedCallback();

			assert.strictEqual(element._delayHandle, null, 'a removed element must not fire later');
		});

	});

	describe('the shared label', () => {

		it('is what the two sites that cannot host an element use', () => {
			assert.strictEqual(loadingLabel('cards'), 'Loading cards…');
		});

	});

	describe('the idioms it replaced are actually gone', () => {

		//A primitive nobody adopts is the failure this whole effort exists to
		//stop: progress-panel was written to end progress divergence and got
		//used twice.
		it('has real consumers, not just a definition', async () => {
			const {readFileSync} = await import('fs');
			const consumers = ['ai-dialog', 'chat-view', 'card-info-panel', 'main-view', 'permissions-view', 'find-dialog'];
			for (const name of consumers) {
				const source = readFileSync(new URL(`../../src/components/${name}.ts`, import.meta.url), 'utf8');
				assert.ok(/<loading-placeholder/.test(source), `${name} should use the primitive`);
				assert.ok(!/Loading\.\.\./.test(source), `${name} still has a bare ASCII "Loading..."`);
			}
		});

	});

});
