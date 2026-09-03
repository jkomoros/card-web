/*eslint-env node*/

//CI runs `test:ci`, not `test`, because test:security needs config.SECRET.json
//— gitignored, and correctly absent from CI. That is a reasonable exception and
//a dangerous one: the moment someone adds a suite to `test` and forgets
//`test:ci`, CI silently covers less than it appears to, and nothing says so.
//A green badge that means less than it looks like is worse than no badge.
//
//So the relationship is asserted rather than maintained by hand: test:ci must
//be EXACTLY test minus the suites that legitimately cannot run without secrets.

import assert from 'assert';
import fs from 'fs';

const SUITES_REQUIRING_SECRETS = ['test:security'];

describe('CI covers everything the local suite does', () => {

	const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url)));
	const suites = (script) => (pkg.scripts[script] || '')
		.split('&&')
		.map(part => (part.match(/npm run (test:[a-z0-9:-]+)/) || [])[1])
		.filter(Boolean);

	it('has both scripts', () => {
		assert.ok(pkg.scripts.test, 'npm test must exist');
		assert.ok(pkg.scripts['test:ci'], 'npm run test:ci must exist — the CI workflow runs it');
	});

	it('runs every local suite except the ones needing secrets', () => {
		const local = suites('test');
		const ci = suites('test:ci');
		const expected = local.filter(suite => !SUITES_REQUIRING_SECRETS.includes(suite));
		const missing = expected.filter(suite => !ci.includes(suite));
		assert.deepStrictEqual(missing, [],
			`these suites run locally but NOT in CI, so CI is quietly covering less than npm test: ${missing.join(', ')}`);
	});

	it('does not run a suite that CI cannot satisfy', () => {
		const ci = suites('test:ci');
		const impossible = ci.filter(suite => SUITES_REQUIRING_SECRETS.includes(suite));
		assert.deepStrictEqual(impossible, [],
			`these need config.SECRET.json, which CI does not have: ${impossible.join(', ')}`);
	});

	it('names a real reason for each exclusion', () => {
		//An exclusion list is where coverage goes to die quietly. Every entry
		//must still be a suite that exists, so a renamed suite cannot leave a
		//stale exemption behind that silently excuses something else.
		for (const suite of SUITES_REQUIRING_SECRETS) {
			assert.ok(pkg.scripts[suite], `${suite} is exempted from CI but no longer exists`);
			assert.ok(/config|SECRET|generate:config/.test(pkg.scripts[suite]),
				`${suite} is exempted as needing secrets, but its script does not reference config generation`);
		}
	});

	//AND THE OTHER END OF THE SAME HOLE. Everything above compares two SCRIPTS
	//to each other, which cannot see a suite that is in neither: a directory of
	//tests nobody runs is invisible to `npm test`, to CI and to the badge, and it
	//looks exactly like a directory of tests that pass.
	//
	//So the directories are compared to the scripts too. Every test/* directory
	//holding a spec must be named by some suite `npm test` runs.
	//
	//harness-support is the one exemption and it is a real one: it holds no spec,
	//only the app harness other suites mount and a memory probe they import. The
	//test below keeps that true.
	it('runs every directory of tests that exists', () => {
		const HARNESS_ONLY = ['harness-support'];
		const root = new URL('../', import.meta.url);
		//TRANSITIVELY, because one suite delegates: test:security wraps
		//test:security-impl in a firebase emulator, and only the inner script
		//names the directory. Following `npm run` one hop at a time is what makes
		//the sweep read the command that actually runs mocha.
		const seen = new Set();
		const expand = (script) => {
			if (!script || seen.has(script)) return [];
			seen.add(script);
			const command = pkg.scripts[script] || '';
			const nested = Array.from(command.matchAll(/npm run ([a-z0-9:-]+)/g)).map(match => match[1]);
			return [command, ...nested.flatMap(expand)];
		};
		const commands = expand('test').join('\n');
		const directories = fs.readdirSync(root, { withFileTypes: true })
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name);
		assert.ok(directories.length > 50, 'the sweep must be reading the real test directory');
		const unrun = [];
		for (const directory of directories) {
			if (HARNESS_ONLY.includes(directory)) continue;
			const files = fs.readdirSync(new URL('./' + directory + '/', root));
			//A SPEC, not merely a file: a fixture or a helper is not a suite.
			const specs = files.filter(name => /\.(js|mjs|cjs)$/.test(name) &&
				/\bdescribe\s*\(/.test(fs.readFileSync(new URL('./' + directory + '/' + name, root), 'utf8')));
			if (!specs.length) continue;
			//The path as a script would spell it, with a boundary after it so
			//`test/collection` is not satisfied by `test/collection-source`.
			const spelled = new RegExp(`test/${directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-zA-Z0-9_-])`);
			if (spelled.test(commands)) continue;
			unrun.push(directory);
		}
		assert.deepStrictEqual(unrun, [],
			`these directories hold tests that no npm script runs, so nothing they assert is ever checked: ${unrun.join(', ')}`);
	});

	it('keeps its one directory exemption honest', () => {
		//The exemption says "no spec of its own". The day that stops being true,
		//the exemption is hiding a suite — which is the defect the sweep exists
		//for, wearing the sweep's own permission slip.
		const directory = new URL('../harness-support/', import.meta.url);
		const files = fs.readdirSync(directory);
		assert.ok(files.length, 'the exempted directory must still exist and hold something');
		for (const name of files) {
			if (!/\.(js|mjs|cjs)$/.test(name)) continue;
			assert.ok(!/\bdescribe\s*\(/.test(fs.readFileSync(new URL('./' + name, directory), 'utf8')),
				`harness-support/${name} declares a suite, but harness-support is exempted from being run`);
		}
	});

	it('is wired to a workflow that actually runs test:ci', () => {
		const workflow = fs.readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
		assert.ok(workflow.includes('npm run test:ci'), 'the workflow must run test:ci');
		assert.ok(workflow.includes('.nvmrc'), 'the workflow must take its node version from .nvmrc, not a second hardcoded one');
	});
});
