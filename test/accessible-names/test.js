/*eslint-env node, es2022*/

//EVERY CONTROL NEEDS A NAME (HS-2.5)
//
//An audit enumerated all 100 <button> elements in src/components and found 29
//that were icon-only with NEITHER a title nor an aria-label — nameless to
//sighted users on hover and to assistive tech entirely. Among them: the close
//button shared by every dialog in the app, the PRIMARY ACTION of five dialogs,
//and all seven of the app's top-level chrome controls, while the info drawer
//directly beneath them was fully tooltipped.
//
//This is a RATCHET, not a clean bill of health. The count is still above zero,
//and pinning the exact set would mean rewriting this file on every fix. Pinning
//the COUNT means the number can fall and cannot rise, which is the property
//that matters — and it is the same shape HOUSE-STYLE §6 uses for native modals.
//
//Comments are stripped before matching. Three separate source pins on this
//project matched prose in a comment rather than code, twice matching a comment
//that explained why the forbidden thing was absent.

import assert from 'assert';
import {readFileSync, readdirSync} from 'fs';

const COMPONENTS = new URL('../../src/components/', import.meta.url);

const stripComments = source => source
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/^\s*\/\/.*$/gm, '');

//Every <button ...> opening tag, with its attributes.
const buttonTags = source => [...stripComments(source).matchAll(/<button\b[^>]*>/g)].map(match => match[0]);

//A button is named if it carries its own title/aria-label, OR if it is wrapped
//in the span.reason idiom ButtonSharedStyles documents (Chrome and Safari
//suppress hover on a disabled control, so the explanation goes on the wrapper).
const named = (tag, source, index) => {
	if (/aria-label=/.test(tag) || /\btitle=/.test(tag)) return true;
	const before = source.slice(Math.max(0, index - 400), index);
	return /class='reason'[^>]*title=/.test(before) || /span class='reason'/.test(before.slice(-200));
};

const survey = () => {
	const result = {total: 0, nameless: [], files: 0};
	for (const name of readdirSync(COMPONENTS)) {
		if (!name.endsWith('.ts')) continue;
		result.files++;
		const raw = readFileSync(new URL(name, COMPONENTS), 'utf8');
		const source = stripComments(raw);
		for (const match of source.matchAll(/<button\b[^>]*>/g)) {
			result.total++;
			//Text buttons name themselves with their content.
			const after = source.slice(match.index + match[0].length, match.index + match[0].length + 60);
			const isIconOnly = /^\s*\$\{[A-Z_]+_ICON\}/.test(after);
			if (!isIconOnly) continue;
			if (named(match[0], source, match.index)) continue;
			result.nameless.push(`${name}: ${match[0].slice(0, 70)}`);
		}
	}
	return result;
};

//Lower this when you name more controls. It may fall; it may not rise.
const NAMELESS_BUDGET = 12;

describe('accessible names on icon-only controls (HS-2.5)', () => {

	it('has a shrinking number of nameless icon buttons', () => {
		const {nameless, total, files} = survey();
		assert.ok(total > 50, `sanity: expected to find plenty of buttons, found ${total} across ${files} files`);
		assert.ok(nameless.length <= NAMELESS_BUDGET,
			`nameless icon-only buttons rose to ${nameless.length} (budget ${NAMELESS_BUDGET}). Lower the budget when you fix some; never raise it.\n` + nameless.join('\n'));
	});

	//The specific ones already fixed, so they cannot silently regress. These are
	//the highest-stakes: one control shared by every dialog, and the primary
	//action of four more.
	it('names the close button every dialog shares', () => {
		const source = readFileSync(new URL('dialog-element.ts', COMPONENTS), 'utf8');
		const tag = buttonTags(source).find(candidate => /id='close'/.test(candidate));
		assert.ok(tag, 'the close button should exist');
		assert.match(tag, /aria-label='Close dialog'/);
		assert.match(tag, /title='Close dialog'/);
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
	//nor activates it — and for an icon-only button that label was its ONLY
	//accessible name. Two of these shipped.
	it('has no label pointing at an element that does not exist', () => {
		for (const name of readdirSync(COMPONENTS)) {
			if (!name.endsWith('.ts')) continue;
			const source = stripComments(readFileSync(new URL(name, COMPONENTS), 'utf8'));
			const ids = new Set([...source.matchAll(/id\s*=\s*'([^'$]+)'/g)].map(match => match[1]));
			for (const match of source.matchAll(/<label for='([^'$]+)'/g)) {
				assert.ok(ids.has(match[1]), `${name}: <label for='${match[1]}'> points at no element in this component`);
			}
		}
	});

});
