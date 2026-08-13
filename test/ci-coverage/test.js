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

	it('is wired to a workflow that actually runs test:ci', () => {
		const workflow = fs.readFileSync(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
		assert.ok(workflow.includes('npm run test:ci'), 'the workflow must run test:ci');
		assert.ok(workflow.includes('.nvmrc'), 'the workflow must take its node version from .nvmrc, not a second hardcoded one');
	});
});
