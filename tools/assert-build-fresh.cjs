/*eslint-env node*/

//Fails LOUDLY when compiled output is older than the TypeScript it was built
//from.
//
//Every test suite here imports compiled output, and nothing rebuilds it. So a
//green run proved only that the LAST BUILD passed — not the working tree. That
//is not theoretical: during mutation testing of the card-delete executor, two
//mutants appeared to survive because `tsc` had failed on a now-unused import,
//the output silently kept the previous build, and the suite ran against the
//correct code while reporting on the broken one. The same mechanism means a
//green `npm test` can validate stale code entirely, which matters more here
//because there is no CI.
//
//A staleness CHECK rather than a rebuild: rebuilding per suite would make one
//`npm test` run tsc 40+ times. This costs milliseconds and turns a silent wrong
//answer into an instruction.
//
//Wired through .mocharc.cjs, so every mocha suite gets it without touching 41
//script definitions, plus a pretest hook for the node --test suites.
//
//THE COMPARISON IS PER FILE. The first version compared the NEWEST source mtime
//against the NEWEST output mtime, which passes in three ways that were each
//measured:
//  - touching ANY file under the output directory masked EVERY stale source,
//    because one fresh output satisfied the whole comparison;
//  - a source with no output at all (newly added, or a build that failed after
//    emitting some files) looked fine, since it was compared only against some
//    other file's output;
//  - deleting a .ts left its .js behind, and the suite kept importing the
//    orphan — the deleted module still "worked".
//Each of those is a false PASS, which is worse than no check: a green result
//that certifies the wrong tree.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

//tsconfig emits src/ and tools/ (and the shared/ files reachable from them)
//into lib/, while shared/ ALSO builds separately into shared/dist. Tests import
//lib/src, lib/shared and shared/dist, so all four mappings matter.
//`functions/` has its own tsconfig and its own output, and no test imports it;
//it is deliberately out of scope rather than forgotten.
const MAPPINGS = [
	{source: 'src', output: 'lib/src'},
	{source: 'tools', output: 'lib/tools'},
	//tsc only pulls in the shared/ files that src/ and tools/ actually import,
	//so lib/shared is a SUBSET by design. Freshness still applies to what is
	//there; absence does not mean a failed build.
	{source: 'shared', output: 'lib/shared', skip: ['dist'], requireOutput: false},
	{source: 'shared', output: 'shared/dist', skip: ['dist']},
];

const SKIP_ALWAYS = ['node_modules'];

//GENERATED files are rewritten by the pipeline itself — `npm test` runs
//generate:config before the first suite — so their mtime jumps mid-run and
//would fail every subsequent suite. This guard exists to catch HAND-EDITED
//source that was never rebuilt, which they are not. Skipped on BOTH sides so a
//generated output is not reported as an orphan either.
const generated = (name) => name.includes('GENERATED');

const walk = (dir, extension, skip) => {
	const found = [];
	const recurse = (current, prefix) => {
		let entries;
		try {
			entries = fs.readdirSync(current, {withFileTypes: true});
		} catch {
			return;
		}
		for (const entry of entries) {
			if (SKIP_ALWAYS.includes(entry.name) || skip.includes(entry.name)) continue;
			const full = path.join(current, entry.name);
			const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				recurse(full, relative);
				continue;
			}
			if (!entry.name.endsWith(extension)) continue;
			if (generated(entry.name)) continue;
			//A .d.ts is a declaration, not a module compiled to a .js of its
			//own, so it has no output to compare against.
			if (extension === '.ts' && entry.name.endsWith('.d.ts')) continue;
			found.push({full, relative});
		}
	};
	recurse(dir, '');
	return found;
};

const fail = (lines) => {
	console.error('');
	for (const line of lines) console.error(line);
	console.error('');
	process.exit(1);
};

const lib = path.join(ROOT, 'lib');
if (!fs.existsSync(lib)) {
	fail(['[build-fresh] lib/ does not exist. Run `npm run build:typescript` before the tests.']);
}

const stale = [];
const missing = [];
const orphaned = [];

for (const mapping of MAPPINGS) {
	const sourceDir = path.join(ROOT, mapping.source);
	const outputDir = path.join(ROOT, mapping.output);
	if (!fs.existsSync(sourceDir) || !fs.existsSync(outputDir)) continue;
	const skip = mapping.skip || [];

	for (const source of walk(sourceDir, '.ts', skip)) {
		const outputPath = path.join(outputDir, source.relative.replace(/\.ts$/, '.js'));
		if (!fs.existsSync(outputPath)) {
			if (mapping.requireOutput !== false) {
				missing.push(`${path.relative(ROOT, source.full)}  ->  ${path.relative(ROOT, outputPath)}`);
			}
			continue;
		}
		if (fs.statSync(source.full).mtimeMs > fs.statSync(outputPath).mtimeMs) {
			stale.push(`${path.relative(ROOT, source.full)}  is newer than  ${path.relative(ROOT, outputPath)}`);
		}
	}

	for (const output of walk(outputDir, '.js', [])) {
		const sourcePath = path.join(sourceDir, output.relative.replace(/\.js$/, '.ts'));
		if (fs.existsSync(sourcePath)) continue;
		//A declaration-only module legitimately has no .ts sibling of that name.
		if (fs.existsSync(sourcePath.replace(/\.ts$/, '.d.ts'))) continue;
		orphaned.push(`${path.relative(ROOT, output.full)}  has no  ${path.relative(ROOT, sourcePath)}`);
	}
}

if (stale.length || missing.length || orphaned.length) {
	const lines = ['[build-fresh] BUILD DOES NOT MATCH THE SOURCE TREE.'];
	const report = (label, entries) => {
		if (!entries.length) return;
		lines.push(`  ${entries.length} ${label}`);
		for (const entry of entries.slice(0, 10)) lines.push(`    ${entry}`);
		if (entries.length > 10) lines.push(`    ...and ${entries.length - 10} more`);
	};
	report('file(s) newer than their compiled output:', stale);
	report('source file(s) with NO compiled output (a build that never ran, or failed partway):', missing);
	report('compiled file(s) whose source is GONE (deleting a .ts leaves the .js importable):', orphaned);
	lines.push('  These tests import the compiled output, so this run would report on a different tree.');
	lines.push('  Run `npm run build` (and check it succeeded) first.');
	fail(lines);
}
