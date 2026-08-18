/*eslint-env node, mocha*/

//The app shell's entry module name appears in three places that have to agree,
//and nothing type-checks the agreement:
//
// - index.TEMPLATE.html asks for a script by URL;
// - tsc must emit a file under that URL, or source serve (`npm start`) boots
//   to a blank page with a single 404 — which is exactly what happened when
//   the entry was renamed inside rollup's entryFileNames only;
// - rollup must emit its bundle entry under the same URL, or the BUILT tree
//   (perf harness, deploys) 404s instead.
//
//The name is deliberately NOT card-web-app.js — master's service worker
//precached that stable name cache-first, so the rename is what lets a new
//deploy actually run (see the entry comment in rollup.config.js). These
//assertions read the three files as text, the same way test/ownership-lease
//pins structural properties, so drift fails a suite instead of a developer's
//evening.

import assert from 'assert';
import fs from 'fs';
import path from 'path';

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const templateEntryURL = () => {
	const template = read('index.TEMPLATE.html');
	const match = template.match(/<script type="module" src="(lib\/src\/components\/[^"]+)"><\/script>/);
	assert(match, 'index.TEMPLATE.html has no module script pointing into lib/src/components');
	return match[1];
};

describe('app entry module naming', () => {
	it('tsc emits the entry index.TEMPLATE.html asks for (source serve)', () => {
		const entryURL = templateEntryURL();
		const source = path.join('src/components', path.basename(entryURL, '.js') + '.ts');
		assert(fs.existsSync(path.join(process.cwd(), source)),
			`${source} does not exist, so tsc emits nothing at ${entryURL} and npm start will 404 the app shell`);
	});

	it('rollup emits its bundle entry under the same name (built serve)', () => {
		const entryURL = templateEntryURL();
		const rollup = read('rollup.config.js');
		const entryName = path.basename(entryURL);
		//Either the input IS the published name and passes through [name].js,
		//or entryFileNames names it explicitly. Both agree; anything else 404s
		//the built tree.
		const viaInput = rollup.includes(`input: '${entryURL}'`) && rollup.includes('entryFileNames: \'[name].js\'');
		const viaRename = rollup.includes(`entryFileNames: '${entryName}'`);
		assert(viaInput || viaRename,
			`rollup.config.js does not emit ${entryName}: neither its input nor entryFileNames produces the name index.TEMPLATE.html asks for`);
	});

	it('the entry is a stub that only loads the app shell', () => {
		//The stub exists to carry a NAME. If real logic accretes here it will
		//run in dev but be bundle-split differently in prod; keep it inert.
		const entryURL = templateEntryURL();
		const source = path.join('src/components', path.basename(entryURL, '.js') + '.ts');
		const body = read(source).replace(/\/\/[^\n]*\n/g, '').trim();
		assert.strictEqual(body, 'import \'./card-web-app.js\';',
			`${source} should contain exactly one side-effect import of card-web-app.js and nothing else`);
	});
});
