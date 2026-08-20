/*eslint-env node*/

//Pins both halves of the #756 auto-activation backstop: the 7-day deadline
//itself, and that the safety gates still block auto-activation when a draft
//is dirty or a mutation is pending. Plus the #753 caching decisions, which
//are config-object assertions in the style of the sibling test file.

import assert from 'assert';
import fs from 'fs';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);

const DAY_MS = 24 * 60 * 60 * 1000;

describe('service-worker auto-activation backstop (#756)', () => {
	let mod;
	let backing;

	before(async () => {
		backing = new Map();
		globalThis.localStorage = {
			getItem: (key) => backing.has(key) ? backing.get(key) : null,
			setItem: (key, value) => backing.set(key, String(value)),
			removeItem: (key) => backing.delete(key),
		};
		mod = await import('../../lib/src/service-worker-update.js');
	});

	beforeEach(() => backing.clear());

	it('the deadline is seven days', () => {
		assert.strictEqual(mod.UPDATE_AUTO_ACTIVATE_AFTER_MS, 7 * DAY_MS);
	});

	it('does not fire before the deadline, fires after it', () => {
		const firstSeen = 1_000_000;
		assert.strictEqual(mod.shouldAutoActivateUpdate(firstSeen, firstSeen + 7 * DAY_MS, ''), false,
			'exactly at the deadline is still waiting');
		assert.strictEqual(mod.shouldAutoActivateUpdate(firstSeen, firstSeen + 7 * DAY_MS + 1, ''), true);
		assert.strictEqual(mod.shouldAutoActivateUpdate(firstSeen, firstSeen + 6 * DAY_MS, ''), false);
	});

	it('the safety gates still block auto-activation', () => {
		const firstSeen = 1_000_000;
		const wayPast = firstSeen + 30 * DAY_MS;
		//The unsafeReason string is exactly what the manual path's banner
		//shows: a dirty draft or a pending durable mutation.
		assert.strictEqual(mod.shouldAutoActivateUpdate(firstSeen, wayPast, 'finish editing the open card first'), false);
		assert.strictEqual(mod.shouldAutoActivateUpdate(firstSeen, wayPast, 'wait for the current change to finish'), false);
		//Once the gate clears, it fires.
		assert.strictEqual(mod.shouldAutoActivateUpdate(firstSeen, wayPast, ''), true);
	});

	it('no recorded first-seen means no auto-activation', () => {
		assert.strictEqual(mod.shouldAutoActivateUpdate(null, Number.MAX_SAFE_INTEGER, ''), false);
	});

	it('recordUpdateFirstSeen is first-write-wins and round-trips', () => {
		assert.strictEqual(mod.readUpdateFirstSeen(), null);
		assert.strictEqual(mod.recordUpdateFirstSeen(500), 500);
		//A newer deploy replacing the waiting worker must NOT reset the
		//clock: the user has been ignoring an update since firstSeen.
		assert.strictEqual(mod.recordUpdateFirstSeen(900), 500);
		assert.strictEqual(mod.readUpdateFirstSeen(), 500);
		mod.clearUpdateFirstSeen();
		assert.strictEqual(mod.readUpdateFirstSeen(), null);
	});

	it('a garbage or non-positive record reads as absent', () => {
		backing.set('card-web-sw-update-first-seen-v1', 'not-a-number');
		assert.strictEqual(mod.readUpdateFirstSeen(), null);
		backing.set('card-web-sw-update-first-seen-v1', '-5');
		assert.strictEqual(mod.readUpdateFirstSeen(), null);
	});

	it('card-web-app wires the backstop to the same gates as the manual path', () => {
		//Source-text pin, matching the sibling file's convention: the check
		//consults _currentUnsafeExitReason (the manual path's gate), records
		//first-seen only while a worker is actually waiting, and clears a
		//stale record when nothing is waiting.
		const app = fs.readFileSync(new URL('../../src/components/card-web-app.ts', import.meta.url), 'utf8');
		const check = app.slice(app.indexOf('_checkUpdateBackstop = ('), app.indexOf('_activateUpdate = ()'));
		assert.match(check, /shouldAutoActivateUpdate\(firstSeen, Date\.now\(\), this\._currentUnsafeExitReason\(\) \|\| composing\)/,
			'the backstop must consult the manual path\'s gate, plus the auto-only composing gate');
		//Never act — or clear — before the registration is known: clearing on
		//ignorance wiped the aging clock on every reload, making the backstop
		//unable to fire for exactly its target cohort.
		assert.match(check, /if \(!registration\) return;/);
		assert.match(check, /CARD_WEB_SW_REGISTRATION/);
		assert.match(check, /clearUpdateFirstSeen/);
		assert.match(app, /UPDATE_AUTO_ACTIVATE_RECHECK_MS/);
		//The bootstrap must expose the registration unconditionally, or the
		//"no update pending" state is indistinguishable from "not looked yet".
		const template = fs.readFileSync(new URL('../../index.TEMPLATE.html', import.meta.url), 'utf8');
		assert.match(template, /window\.CARD_WEB_SW_REGISTRATION = reg;/);
		//And the activation-time clear must be synchronous — a dynamic import
		//would lose the race against the reload that follows it.
		const handlerStart = app.indexOf('_controllerChangeHandler = ()');
		const controllerHandler = app.slice(handlerStart, app.indexOf('\n\t};', handlerStart));
		assert.match(controllerHandler, /clearUpdateFirstSeen\(\);/);
		assert.doesNotMatch(controllerHandler, /import\(/);
	});
});

describe('service-worker caching decisions (#753)', () => {
	const config = require('../../workbox-config.cjs');

	it('does not precache the corpus worker, honoring its no-cache hosting header', () => {
		//The path is read from corpus-bridge's own WORKER_URL so the three
		//copies of it (the loader, this exclusion, and the hosting header)
		//cannot silently drift apart: if the emitted path ever changes, this
		//test fails instead of the glob quietly precaching the worker again.
		const bridge = fs.readFileSync(new URL('../../src/corpus-bridge.ts', import.meta.url), 'utf8');
		const workerURL = bridge.match(/const WORKER_URL = '([^']+)';/)[1];
		const ignores = config.globIgnores || [];
		assert.ok(ignores.includes(workerURL.replace(/^\//, '')),
			'precaching the stable-URL worker chunk CacheFirst makes the explicit no-cache header inert and removes the only refetch path');
		const hosting = require('../../firebase.TEMPLATE.json').hosting;
		assert.ok((hosting.headers || []).some(h => h.source === workerURL),
			'the no-cache hosting header must cover the same path the loader fetches');
	});

	it('precaches images and fonts so an installed PWA has an icon offline', () => {
		assert.ok(config.globPatterns.includes('images/**/*'));
		//woff2-only: precaching the eot/svg/ttf/woff legacy formats would
		//quintuple install cost for files no capable browser requests.
		assert.ok(config.globPatterns.includes('fonts/**/*.woff2'));
		assert.ok(config.globPatterns.includes('fonts/fonts.css'));
		assert.ok(!config.globPatterns.includes('fonts/**/*'));
	});

	it('the un-precached corpus worker has its NetworkFirst offline companion', () => {
		//Without this route, offline boot in default worker mode fails
		//closed into a permanent "Cards could not load" panel: the precache
		//entry was the only guaranteed offline copy of the worker script.
		//The pair must move together.
		const routes = config.runtimeCaching || [];
		const workerRoute = routes.find(route => route.urlPattern.test('/lib/src/worker/corpus-worker.js'));
		assert.ok(workerRoute, 'corpus-worker.js needs a runtime caching route since it is not precached');
		assert.strictEqual(workerRoute.handler, 'NetworkFirst',
			'online must always try the network first (the no-cache header\'s intent); offline serves the last-fetched copy');
		assert.ok(workerRoute.options && workerRoute.options.networkTimeoutSeconds > 0,
			'a hung network at cold start must fall back to the cached copy, not hang boot');
	});

	it('the denylist matches assets by prefix, not by any dot in the path', () => {
		const denied = config.navigateFallbackDenylist || [];
		const matches = (path) => denied.some(re => re.test(path));
		//Query text may legitimately contain dots (encodeURIComponent
		//preserves '.'); such routes must still get the shell offline.
		assert.ok(!matches('/c/query/node.js'), 'a dotted query argument is an app route, not an asset');
		assert.ok(!matches('/c/query/v1.2.3'));
		//Real assets stay excluded.
		assert.ok(matches('/images/apple-touch-icon.png'));
		assert.ok(matches('/fonts/Raleway_400_normal.woff2'));
		assert.ok(matches('/node_modules/@webcomponents/webcomponentsjs/webcomponents-loader.js'));
		assert.ok(matches('/manifest.json'));
		assert.ok(matches('/robots.txt'));
	});

	it('a real robots.txt is copied into hosting output', () => {
		assert.ok(fs.existsSync(new URL('../../robots.txt', import.meta.url)), 'robots.txt must exist at the repo root');
		const rollup = fs.readFileSync(new URL('../../rollup.config.js', import.meta.url), 'utf8');
		assert.match(rollup, /src: 'robots\.txt', dest: 'build'/,
			'without the copy, Hosting\'s ** catch-all answers /robots.txt with the app shell');
	});
});
