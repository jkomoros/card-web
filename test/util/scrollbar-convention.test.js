/*eslint-env node*/

//The #759 scrollbar convention, enforced as source text (the repo has no
//component-mounting harness): scrolling is the container's job, `auto` is
//the only spelling, and the two footgun values are banned outside the one
//shared module —
//- `overflow: scroll` reserves a permanent gutter on always-show-scrollbar
//  systems (Windows, Linux, macOS with a mouse) whether or not anything
//  overflows, which is invisible to whoever develops on a Mac laptop. Use
//  `auto`, and `scrollbar-gutter: stable` where layout shift matters.
//- `overflow: overlay` was removed from Chromium as a distinct behavior: it
//  still parses (CSS.supports lies) but computes to `auto`, so it is a
//  no-op that reads like a feature.

import assert from 'assert';
import fs from 'fs';
import path from 'path';

const COMPONENTS_DIR = new URL('../../src/components/', import.meta.url).pathname;

//The shared module documents the history of `overlay` and owns the one
//sanctioned .scroller treatment; its comment mentions the banned values.
const EXEMPT = new Set(['scrolling-shared-styles.ts']);

describe('scrollbar convention (#759)', () => {
	it('no component declares overflow: scroll or overlay outside the shared module', () => {
		const offenders = [];
		for (const file of fs.readdirSync(COMPONENTS_DIR)) {
			if (!file.endsWith('.ts') || EXEMPT.has(file)) continue;
			const source = fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8');
			//Strip comments so prose ABOUT the banned values doesn't trip it.
			const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
			if (/overflow(-[xy])?\s*:\s*(scroll|overlay)/.test(code)) offenders.push(file);
		}
		assert.deepStrictEqual(offenders, [],
			'use overflow: auto (plus scrollbar-gutter: stable if layout shift matters); see scrolling-shared-styles.ts');
	});

	it('every dialog scrolls through DialogElement, not its own scroller', () => {
		//The dialog's #inner is THE scroll container. A dialog subclass
		//introducing its own overflow scroller re-creates the
		//scrollbar-inside-scrollbar problem bulk import had (one textarea
		//per pasted body). Nested panes that genuinely need their own
		//scroller should use the shared .scroller class, which this does
		//not ban — it bans raw overflow declarations in dialog subclasses.
		const dialogFiles = fs.readdirSync(COMPONENTS_DIR).filter(file => file.endsWith('-dialog.ts'));
		assert.ok(dialogFiles.length >= 5, `expected the dialog family, got ${dialogFiles.length}`);
		const offenders = [];
		for (const file of dialogFiles) {
			const source = fs.readFileSync(path.join(COMPONENTS_DIR, file), 'utf8');
			const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
			if (/overflow(-[xy])?\s*:\s*(scroll|overlay|auto)/.test(code)) offenders.push(file);
		}
		assert.deepStrictEqual(offenders, [], 'dialog content scrolls via DialogElement #inner');
	});

	it('the dialog scroller is auto with a stable gutter and contained overscroll', () => {
		const source = fs.readFileSync(path.join(COMPONENTS_DIR, 'dialog-element.ts'), 'utf8');
		const inner = source.slice(source.indexOf('#inner {'), source.indexOf('}', source.indexOf('#inner {')));
		assert.match(inner, /overflow: auto;/);
		assert.match(inner, /scrollbar-gutter: stable;/);
		assert.match(inner, /overscroll-behavior: contain;/);
	});
});
