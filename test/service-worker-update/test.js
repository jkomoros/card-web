/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';
import {createRequire} from 'module';

//workbox-config.cjs is CommonJS; this test file is ESM.
const require = createRequire(import.meta.url);

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('service-worker update safety', () => {
	it('never reloads directly from the registration bootstrap', () => {
		const template = read('index.TEMPLATE.html');
		const registrationBlock = template.slice(template.indexOf('/* SERVICE-WORKER-START*/'), template.indexOf('/* SERVICE-WORKER-END */'));
		assert.doesNotMatch(registrationBlock, /location\.reload\(\)/);
		assert.doesNotMatch(registrationBlock, /reg\.waiting\s*\|\|\s*!navigator\.serviceWorker\.controller/);
		assert.match(registrationBlock, /card-web-service-worker-update/);
	});

	it('waits for an explicit application activation message', () => {
		const config = read('workbox-config.cjs');
		assert.match(config, /skipWaiting:\s*false/);
		assert.match(config, /maximumFileSizeToCacheInBytes:\s*5\s*\*\s*1024\s*\*\s*1024/);
		const app = read('src/components/card-web-app.ts');
		assert.match(app, /selectEditingCardHasUnsavedChanges/);
		assert.match(app, /selectPendingModificationCount/);
		assert.match(app, /inFlightMutationCount/);
		assert.match(app, /BroadcastChannel/);
		assert.match(app, /controllerchange/);
		assert.match(app, /postMessage\(\{type: 'SKIP_WAITING'\}\)/);
		assert.match(app, /beforeunload/);
	});

	it('regenerates SEO shells before the build copies them into hosting output', () => {
		const cli = read('tools/cli.ts');
		for (const workflowName of ['devDeploy', 'deploy']) {
			const start = cli.indexOf(`const ${workflowName} =`);
			const end = cli.indexOf('\n};', start);
			const workflow = cli.slice(start, end);
			assert.ok(start >= 0 && end > start);
			assert.ok(workflow.indexOf('generateSeoPagesOptionally();') < workflow.indexOf('build();'));
		}
	});

	//#728: offline boot showed the browser's own error page, because the
	//service worker had NO route that could answer a navigation request —
	//index.html was never precached and there was no navigateFallback. Neither
	//had existed in this repo's history. It appeared to work in manual testing
	//only because index.html is served with max-age=3600, so within an hour of
	//a real load the HTTP cache answered instead of the service worker.
	//
	//These assert on the config OBJECT, not its source text. The first version
	//of this test used /globPatterns:[\s\S]*?'index\.html'/ and PASSED on the
	//exact config that reproduces #728 — the lazy match ran through the comment
	//prose above into the navigateFallback line. A source-text regex cannot
	//tell a config value from a word in a comment.
	describe('offline boot (#728)', () => {
		const config = require('../../workbox-config.cjs');

		it('precaches the app shell', () => {
			assert.ok(config.globPatterns.includes('index.html'),
				'without the shell in globPatterns there is nothing to serve offline, and workbox still builds clean');
		});

		it('routes navigations to the shell', () => {
			assert.strictEqual(config.navigateFallback, 'index.html',
				'Hosting rewrites every deep link to the shell, so navigation must resolve to it');
		});

		//request.mode === 'navigate' covers iframe loads, not just address-bar
		//navigation. Firebase Auth bootstraps via an iframe at /__/auth/iframe,
		//and authDomain is on an origin that also serves this app — so without
		///__/ the service worker answers Google sign-in with the app shell.
		it('excludes paths that are not app routes, including Firebase auth', () => {
			const denied = config.navigateFallbackDenylist || [];
			const matches = (path) => denied.some(re => re.test(path));

			assert.ok(matches('/__/auth/iframe'), 'Firebase auth must never be answered with the shell');
			assert.ok(matches('/__/auth/handler'));
			assert.ok(matches('/lib/src/components/card-web-app-entry.js'));
			assert.ok(matches('/seo/some-card.html'), 'prerendered SEO shells must not be shadowed');
			assert.ok(matches('/deploy-stamp.json'), 'the deploy stamp answers "which build is live" and must stay honest');
			assert.ok(matches('/service-worker.js'));

			//...while real app routes still fall back to the shell, which is the
			//whole point. No card slug contains a dot, so the extension rule is
			//safe for these.
			assert.ok(!matches('/'), 'the root must still resolve to the shell');
			assert.ok(!matches('/c/main/some-card-slug'), 'card routes must still boot offline');
			assert.ok(!matches('/c/everything/unpublished/working-notes'));
		});

		//Precaching the shell made the service worker the ONLY channel for new
		//code — before #728 a reload eventually pulled fresh markup from Hosting
		//regardless of the worker. So the worker script itself must not be
		//HTTP-cached: it shipped at max-age=3600, which meant a returning user
		//could reload for up to an hour after a deploy, get the old precached
		//shell, and never see "Update ready". Found on dev by an adversarial
		//sweep, measured: a default-cache-mode fetch of the script returned in
		//1ms (HTTP cache) vs 5ms with {cache:'no-cache'}.
		it('does not let the service worker script itself be HTTP-cached', () => {
			//Reads the TEMPLATE, which is tracked. firebase.json is GITIGNORED and
			//generated by tools/seo.ts (it carries 1,240 SEO rewrites, ~136KB), so
			//it may not exist in CI at all — an earlier version of this test read it
			//and would have failed there for the wrong reason.
			const hosting = require('../../firebase.TEMPLATE.json').hosting;
			const rule = (hosting.headers || []).find(h => h.source === '/service-worker.js');
			assert.ok(rule, '/service-worker.js needs an explicit Cache-Control rule');
			const cacheControl = (rule.headers || []).find(h => h.key === 'Cache-Control');
			assert.ok(cacheControl, 'the rule must set Cache-Control');
			assert.match(cacheControl.value, /no-cache|no-store|max-age=0/,
				`serving the worker script with "${cacheControl.value}" strands clients on the old precached shell`);
		});

		//The cost, accepted deliberately: a precached shell is cache-first, so a
		//deploy's new index.html waits for the new worker to activate. Pinned
		//together so neither half changes without confronting the other.
		it('is paired with the deliberate deferred-activation model', () => {
			assert.ok(config.globPatterns.includes('index.html') ? config.skipWaiting === false : true,
				'a precached shell plus skipWaiting:true would serve a new shell against old chunks');
		});
	});
});
