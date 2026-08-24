/*eslint-env node, es2022*/

//EVERY CONTROL NEEDS A NAME (HS-2.5)
//
//An audit found icon-only buttons across src/components with no accessible name
//at all — nameless to assistive tech entirely. Among them: the primary action of
//several dialogs, and the app's top-level chrome controls, while the info drawer
//directly beneath them was fully tooltipped.
//
//THE FIRST VERSION OF THIS FILE WAS THEATRE, and it is worth saying how, because
//the shape recurs. It reported 8 nameless controls and pinned the budget at 12,
//so four could be added before CI complained. Adversarial review measured the
//real number at 18 and showed the survey finding 6 of them — 33% recall — with
//two of its own 8 hits being false positives. Three heuristic holes let ten
//nameless buttons be injected at a time without failing:
//
//  - the icon test only matched `${SOME_ICON}` in the 60 chars after the tag, so
//    a ternary between two icons, or an icon further away, read as "not an icon
//    button" and was skipped;
//  - the tag pattern `<button\b[^>]*>` terminates on the `>` of an inline arrow
//    handler `@click=${() => …}`, so those buttons were never seen at all;
//  - and it credited any `span class='reason'` within 400 characters as naming
//    the button, with no notion of whether that span was still open or which
//    button it wrapped.
//
//That last one was not just imprecise, it was WRONG. Chromium's accessibility
//tree says a title on an ancestor <span> gives the button no accessible name.
//HS-2.5's reason-wrapper idiom is about where a DISABLED EXPLANATION lives, not
//about naming — and the star / read / reading-list buttons in card-view show the
//correct pattern: a title on the wrapper AND an aria-label on the button.
//
//So there are two different questions, and they get two different assertions:
//  - NO ACCESSIBLE NAME: silent to a screen reader. A wrapper does not count.
//  - NO HOVER NAME: nothing on mouse-over. A wrapper does count.
//
//Both budgets are set to what this file MEASURES, not to a number from an
//audit. They may fall; they may not rise — with one carve-out: if the SURVEY
//itself gets stricter and starts seeing real cases it used to miss, the budget
//rises to match and the commit says so. That is the survey becoming honest, not
//the app regressing. Tell them apart by running the OLD survey against the NEW
//tree: if that number is unchanged, the rise is accuracy.

import assert from 'assert';
import {readFileSync, readdirSync} from 'fs';

const COMPONENTS = new URL('../../src/components/', import.meta.url);

const stripComments = source => source
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/^\s*\/\/.*$/gm, '');

//Scan a <button ...> tag to its real end. A plain regex cannot: `@click=${() =>
//…}` contains a `>` that ends the match early, which hid an entire class of
//button from the previous version.
const scanTag = (source, start) => {
	let depth = 0;
	let quote = '';
	for (let i = start; i < source.length; i++) {
		const ch = source[i];
		if (quote) {
			//INSIDE the quote branch. An earlier fix put this after it, where an
			//escaped quote can never reach it — and that was worse than nothing,
			//because it turned a DETECTABLE failure (scanTag returning -1, which
			//the assert below catches) into a silent one: a wrong `>` index that
			//quietly skips the rest of the file. Review injected two nameless
			//buttons and the ratchet still reported 18 against a real 20.
			if (ch === '\\') { i++; continue; }
			if (ch === quote) quote = '';
			continue;
		}
		if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
		if (ch === '$' && source[i + 1] === '{') { depth++; i++; continue; }
		if (ch === '{' && depth > 0) { depth++; continue; }
		if (ch === '}' && depth > 0) { depth--; continue; }
		if (ch === '>' && depth === 0) return i;
	}
	return -1;
};

//Everything between the tag and its </button>, so an icon referenced anywhere
//inside counts — including one arm of a ternary.
const contentOf = (source, tagEnd) => {
	const close = source.indexOf('</button>', tagEnd);
	return close < 0 ? '' : source.slice(tagEnd + 1, close);
};

const survey = () => {
	const noName = [];
	const noHover = [];
	const unclassifiable = [];
	const emptyBodied = [];
	let buttons = 0;
	let iconOnly = 0;

	for (const file of readdirSync(COMPONENTS)) {
		if (!file.endsWith('.ts')) continue;
		const source = stripComments(readFileSync(new URL(file, COMPONENTS), 'utf8'));
		//Ids present in this component, for <label for> resolution. Each
		//component is its own shadow root, so a label can only name a sibling.
		const ids = new Set([...source.matchAll(/id\s*=\s*'([^'$]+)'/g)].map(match => match[1]));
		const labelled = new Set([...source.matchAll(/<label for='([^'$]+)'/g)]
			.map(match => match[1]).filter(id => ids.has(id)));

		let index = source.indexOf('<button');
		while (index >= 0) {
			buttons++;
			const tagEnd = scanTag(source, index);
			//NEVER silently stop. A survey that gives up mid-file reports a
			//smaller number and looks like progress, which is the exact failure
			//this file exists to prevent.
			assert.ok(tagEnd >= 0, `${file}: could not find the end of a <button> tag — the scanner would silently skip the rest of this file`);
			const tag = source.slice(index, tagEnd + 1);
			const content = contentOf(source, tagEnd);

			//Icon-only: references an icon and carries no literal text of its own.
			//Inline <svg> counts as an icon too. It appears zero times in the
			//tree today; it is here so the first one cannot arrive unnamed.
			const hasIcon = /[A-Z][A-Z0-9_]*_ICON/.test(content) || /<svg[\s>]/.test(content);
			const hasText = /[A-Za-z]{2,}/.test(content.replace(/\$\{[\s\S]*?\}/g, '').replace(/<[^>]*>/g, ''));
			if (hasIcon && !hasText) {
				iconOnly++;
				const ownID = (tag.match(/id\s*=\s*'([^'$]+)'/) || [])[1];
				const namedByLabel = ownID ? labelled.has(ownID) : false;
				//A wrapper title does NOT name a button. Verified in Chromium.
				//An empty or whitespace-only value names nothing; Chromium agrees.
				const hasAria = /aria-label=(['"])\s*\S[\s\S]*?\1/.test(tag) || /aria-label=\$\{/.test(tag);
				//A title on the BUTTON is the last fallback in the accessible
				//name computation, so it does name it — unlike a title on an
				//ancestor span, which names nothing.
				const hasTitle = /\btitle=(['"])\s*\S[\s\S]*?\1/.test(tag) || /\btitle=\$\{/.test(tag);
				const where = `${file}: ${tag.replace(/\s+/g, ' ').slice(0, 66)}`;
				if (!hasAria && !hasTitle && !namedByLabel) noName.push(where);
				//For hover, the reason-wrapper idiom legitimately counts.
				const before = source.slice(Math.max(0, index - 240), index);
				const wrapped = /<span class='reason'[^>]*title=/.test(before);
				if (!hasTitle && !wrapped && !namedByLabel) noHover.push(where);
			}
			//THE SURVEY'S REMAINING BLIND SPOT, pinned rather than papered over.
			//A button whose whole body is one interpolation — `${this._icon()}`,
			//`${entry.action.label}` — cannot be classified from source text:
			//it may resolve to an icon (needs a name) or to text (names itself).
			//All four in the tree today are the harmless kind, so widening the
			//icon test to include them would manufacture four false positives.
			//Instead the COUNT is pinned. If it rises, a human looks at the new
			//one and decides which kind it is. Silence about a known hole is how
			//the first version of this file came to report 6 of 18.
			if (!hasIcon && !hasText && /\$\{/.test(content)) unclassifiable.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 66)}`);
			//An entirely empty body is nameless unless the tag names it, and no
			//interpolation can rescue it. Zero today; pinned at zero.
			if (!content.trim() && !/aria-label|title=/.test(tag)) emptyBodied.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 66)}`);
			index = source.indexOf('<button', tagEnd);
		}
	}
	return {noName, noHover, buttons, iconOnly, unclassifiable, emptyBodied};
};

//Measured, not inherited from an audit. Lower them; never raise them.
const NO_ACCESSIBLE_NAME_BUDGET = 0;
const NO_HOVER_NAME_BUDGET = 0;
//Measured: 4 today, all of them text buttons whose label is interpolated.
const UNCLASSIFIABLE_BUDGET = 4;

describe('accessible names on icon-only controls (HS-2.5)', () => {

	it('finds the buttons it claims to be surveying', () => {
		const {buttons, iconOnly} = survey();
		//A survey that silently stops finding things reports a shrinking number
		//and looks like progress. Pin the denominator too.
		assert.ok(buttons > 95, `expected ~100 buttons, found ${buttons} — the scanner has stopped seeing some`);
		assert.ok(iconOnly > 75, `expected most buttons to be icon-only, found ${iconOnly}`);
	});

	it('has a shrinking number of controls with NO accessible name', () => {
		const {noName} = survey();
		assert.ok(noName.length <= NO_ACCESSIBLE_NAME_BUDGET,
			`controls silent to assistive tech rose to ${noName.length} (budget ${NO_ACCESSIBLE_NAME_BUDGET}).\n` + noName.join('\n'));
	});

	//These two pin the survey's KNOWN HOLES, not the app's defects. A number
	//here rising is not "the app got worse", it is "the survey can no longer
	//tell you". Both are the same instruction: go look at the new one.
	it('gains no new button the survey cannot classify', () => {
		const {unclassifiable} = survey();
		assert.ok(unclassifiable.length <= UNCLASSIFIABLE_BUDGET,
			`buttons whose body is a bare interpolation rose to ${unclassifiable.length} (budget ${UNCLASSIFIABLE_BUDGET}).\n` +
			'Look at the new one: if it renders an icon it needs an aria-label; if it renders text it is fine and the budget moves.\n' +
			unclassifiable.join('\n'));
	});

	it('gains no empty-bodied button', () => {
		const {emptyBodied} = survey();
		assert.strictEqual(emptyBodied.length, 0,
			`a button with an empty body and nothing naming it in the tag:\n${emptyBodied.join('\n')}`);
	});

	it('has a shrinking number of controls with no hover name', () => {
		const {noHover} = survey();
		assert.ok(noHover.length <= NO_HOVER_NAME_BUDGET,
			`controls with nothing on hover rose to ${noHover.length} (budget ${NO_HOVER_NAME_BUDGET}).\n` + noHover.join('\n'));
	});

	//The highest-stakes ones already fixed, pinned so they cannot regress: one
	//control shared by every dialog, and each dialog's primary action.
	it('names the close button every dialog shares', () => {
		const source = readFileSync(new URL('dialog-element.ts', COMPONENTS), 'utf8');
		assert.match(source, /id='close'[^>]*aria-label='Close dialog'/);
	});

	it('names the primary action of every dialog that has one', () => {
		for (const file of ['ai-dialog.ts', 'compose-dialog.ts', 'image-browser-dialog.ts', 'image-properties-dialog.ts']) {
			const source = stripComments(readFileSync(new URL(file, COMPONENTS), 'utf8'));
			const index = source.indexOf('_handleDoneClicked}');
			assert.ok(index > 0, `${file} should have a done handler`);
			const tag = source.slice(source.lastIndexOf('<button', index), index);
			assert.match(tag, /aria-label=/, `${file}'s primary action is unnamed`);
		}
	});

	//A misspelled `for` points at nothing, so the label neither names the button
	//nor activates it. Two of these shipped.
	it('has no label pointing at an element that does not exist', () => {
		for (const file of readdirSync(COMPONENTS)) {
			if (!file.endsWith('.ts')) continue;
			const source = stripComments(readFileSync(new URL(file, COMPONENTS), 'utf8'));
			const ids = new Set([...source.matchAll(/id\s*=\s*'([^'$]+)'/g)].map(match => match[1]));
			//Components whose ids are built from template expressions cannot be
			//checked statically; skip the file rather than report a false alarm.
			if (/id\s*=\s*['"]?\$\{/.test(source)) continue;
			for (const match of source.matchAll(/<label for='([^'$]+)'/g)) {
				assert.ok(ids.has(match[1]), `${file}: <label for='${match[1]}'> points at no element in this component`);
			}
		}
	});

});
