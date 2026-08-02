/*eslint-env node*/

//Fails LOUDLY when lib/ is older than the TypeScript it was built from.
//
//Every test suite here imports compiled output from lib/, and nothing rebuilt
//it. So a green run proved only that the LAST BUILD passed — not the working
//tree. That is not theoretical: during mutation testing of the card-delete
//executor, two mutants appeared to survive because `tsc` had failed on a
//now-unused import, lib/ silently kept the previous build, and the suite ran
//against the correct code while reporting on the broken one. The same
//mechanism means a green `npm test` can validate stale code entirely, which
//matters more here because there is no CI.
//
//A staleness CHECK rather than a rebuild: rebuilding per suite would make one
//`npm test` run tsc 40+ times. This costs milliseconds and turns a silent
//wrong answer into an instruction.
//
//Wired through .mocharc.cjs, so every mocha suite gets it without touching 41
//script definitions, plus a pretest hook for the node --test suites.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const newestMTime = (dir, extension, skip = []) => {
	let newest = 0;
	let newestFile = '';
	const walk = (current) => {
		let entries;
		try {
			entries = fs.readdirSync(current, {withFileTypes: true});
		} catch {
			return;
		}
		for (const entry of entries) {
			if (skip.includes(entry.name)) continue;
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (!entry.name.endsWith(extension)) continue;
			//GENERATED files are rewritten by the pipeline itself — `npm test`
			//runs generate:config before the first suite — so their mtime jumps
			//mid-run and would fail every subsequent suite. This guard exists to
			//catch HAND-EDITED source that was never rebuilt, which they are not.
			if (entry.name.includes('GENERATED')) continue;
			const {mtimeMs} = fs.statSync(full);
			if (mtimeMs > newest) {
				newest = mtimeMs;
				newestFile = path.relative(ROOT, full);
			}
		}
	};
	walk(dir);
	return {newest, newestFile};
};

const lib = path.join(ROOT, 'lib');
if (!fs.existsSync(lib)) {
	console.error('\n[build-fresh] lib/ does not exist. Run `npm run build:typescript` before the tests.\n');
	process.exit(1);
}

const built = newestMTime(lib, '.js');
//node_modules is not under src/ or shared/, but skip defensively in case of a
//local link, and skip generated files that the build itself writes.
const sources = [newestMTime(path.join(ROOT, 'src'), '.ts', ['node_modules']),
	newestMTime(path.join(ROOT, 'shared'), '.ts', ['node_modules', 'dist'])];

for (const source of sources) {
	if (source.newest <= built.newest) continue;
	console.error(`\n[build-fresh] STALE BUILD: ${source.newestFile} is newer than anything in lib/.`);
	console.error('             These tests import lib/, so this run would report on the PREVIOUS build.');
	console.error('             Run `npm run build:typescript` (and check it succeeded) first.\n');
	process.exit(1);
}
