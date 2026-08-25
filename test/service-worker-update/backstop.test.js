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

	//The auto-only gates guard unsent user input the manual path never had
	//to (a human click was consent there): redux-only text that a
	//programmatic reload would silently discard, with beforeunload unable to
	//intervene (the guard arms on unsafeReason, which is empty on exactly
	//this path).
	describe('unsent-input gates (auto-only)', () => {
		const clear = {chatComposing: '', composeOpen: false, composeContent: '', findDialogOpen: false, findQuery: ''};

		it('all clear means no hold, so a past-deadline update fires', () => {
			assert.strictEqual(mod.unsentUserInputReason(clear), '');
			assert.strictEqual(mod.shouldAutoActivateUpdate(1_000_000, 1_000_000 + 30 * DAY_MS, mod.unsentUserInputReason(clear)), true);
		});

		it('a composing chat message holds', () => {
			const reason = mod.unsentUserInputReason({...clear, chatComposing: 'half a thought'});
			assert.notStrictEqual(reason, '');
			assert.strictEqual(mod.shouldAutoActivateUpdate(1_000_000, 1_000_000 + 30 * DAY_MS, reason), false);
		});

		it('an open compose dialog with unsent text holds', () => {
			const reason = mod.unsentUserInputReason({...clear, composeOpen: true, composeContent: 'dear diary'});
			assert.notStrictEqual(reason, '');
			assert.strictEqual(mod.shouldAutoActivateUpdate(1_000_000, 1_000_000 + 30 * DAY_MS, reason), false);
		});

		it('compose content only gates while the dialog is open', () => {
			//An open-but-empty dialog has nothing to lose; content behind a
			//closed dialog was abandoned by a cancel, not left unsent.
			assert.strictEqual(mod.unsentUserInputReason({...clear, composeOpen: true}), '');
			assert.strictEqual(mod.unsentUserInputReason({...clear, composeContent: 'cancelled text'}), '');
		});

		it('an open find dialog with a query holds; open-and-empty does not', () => {
			assert.notStrictEqual(mod.unsentUserInputReason({...clear, findDialogOpen: true, findQuery: 'blue'}), '');
			assert.strictEqual(mod.unsentUserInputReason({...clear, findDialogOpen: true}), '');
			assert.strictEqual(mod.unsentUserInputReason({...clear, findQuery: 'closed'}), '');
		});
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

	it('a record surviving an activation is cleared by the first no-waiting check, so the next update gets a fresh clock', () => {
		//The all-tabs-closed activation path clears nothing, so a record can
		//outlive the update it timed. Adopted as-is by the next deploy it
		//fires instantly...
		const stale = mod.recordUpdateFirstSeen(1_000_000);
		const laterBoot = 1_000_000 + 30 * DAY_MS;
		assert.strictEqual(mod.shouldAutoActivateUpdate(stale, laterBoot, ''), true,
			'this is the instant-fire hazard the no-waiting clear exists to prevent');
		//...which is why _checkUpdateBackstop's no-waiting branch clears it
		//the moment a visible registration has nothing waiting.
		mod.clearUpdateFirstSeen();
		//A new update detected afterwards records first-seen NOW and waits
		//the full seven days, instead of inheriting the stale stamp.
		const fresh = mod.recordUpdateFirstSeen(laterBoot);
		assert.strictEqual(fresh, laterBoot);
		assert.strictEqual(mod.shouldAutoActivateUpdate(fresh, laterBoot + DAY_MS, ''), false);
		assert.strictEqual(mod.shouldAutoActivateUpdate(fresh, laterBoot + 7 * DAY_MS + 1, ''), true);
	});

	it('a no-waiting registration is announced at boot, not left for the hourly re-check', () => {
		//The hazard above is only prevented if the no-waiting check actually
		//RUNS before a new deploy can be detected. At boot it cannot: the
		//element's connect-time check precedes the bootstrap exposing the
		//registration, and announceWaitingUpdate used to dispatch nothing
		//when no worker was waiting — so the stale record survived the whole
		//boot-to-first-recheck window, exactly where the bootstrap's explicit
		//reg.update() makes a new deploy likeliest to land. Pin that the
		//bootstrap's no-waiting branch dispatches a registration-ready event
		//and that card-web-app listens and re-runs the check on it.
		const template = fs.readFileSync(new URL('../../index.TEMPLATE.html', import.meta.url), 'utf8');
		const registrationBlock = template.slice(template.indexOf('/* SERVICE-WORKER-START*/'), template.indexOf('/* SERVICE-WORKER-END */'));
		const noWaitingStart = registrationBlock.indexOf('if (!reg.waiting)');
		assert.ok(noWaitingStart >= 0, 'the bootstrap must still branch on reg.waiting');
		const noWaitingBranch = registrationBlock.slice(noWaitingStart, registrationBlock.indexOf('return;', noWaitingStart));
		assert.match(noWaitingBranch, /card-web-service-worker-registration-ready/,
			'the "we looked, nothing waiting" state must be dispatched from the no-waiting branch itself');
		//The registration global is exposed BEFORE the event can fire, so the
		//listening check never acts on ignorance.
		assert.ok(registrationBlock.indexOf('window.CARD_WEB_SW_REGISTRATION = reg;') < registrationBlock.indexOf('card-web-service-worker-registration-ready'));
		const app = fs.readFileSync(new URL('../../src/components/card-web-app.ts', import.meta.url), 'utf8');
		assert.match(app, /window\.addEventListener\('card-web-service-worker-registration-ready', this\._registrationReadyHandler\)/);
		assert.match(app, /window\.removeEventListener\('card-web-service-worker-registration-ready', this\._registrationReadyHandler\)/);
		const handlerStart = app.indexOf('_registrationReadyHandler = ()');
		assert.ok(handlerStart >= 0, 'card-web-app must define the registration-ready handler');
		const handler = app.slice(handlerStart, app.indexOf('\n\t};', handlerStart));
		assert.match(handler, /_checkUpdateBackstop\(\)/,
			'the handler must re-run the backstop check, whose no-waiting branch clears the stale record');
	});

	it('card-web-app wires the backstop to the same gates as the manual path', () => {
		//Source-text pin, matching the sibling file's convention: the check
		//consults _currentUnsafeExitReason (the manual path's gate), records
		//first-seen only while a worker is actually waiting, and clears a
		//stale record when nothing is waiting.
		const app = fs.readFileSync(new URL('../../src/components/card-web-app.ts', import.meta.url), 'utf8');
		const check = app.slice(app.indexOf('_checkUpdateBackstop = ('), app.indexOf('_activateUpdate = ()'));
		assert.match(check, /shouldAutoActivateUpdate\(firstSeen, Date\.now\(\), this\._currentUnsafeExitReason\(\) \|\| unsentInput\)/,
			'the backstop must consult the manual path\'s gate, plus the auto-only unsent-input gates');
		//The auto-only gates must be fed from live state, one selector per
		//guarded surface: chat composing, compose dialog open+content, find
		//dialog open+query. The decision itself is the pure helper above.
		assert.match(check, /unsentUserInputReason\(\{/);
		for (const selector of ['selectChatComposingMessage', 'selectComposeOpen', 'selectPromptContent', 'selectFindDialogOpen', 'selectQuery']) {
			assert.match(check, new RegExp(`${selector}\\(state\\)`), `the ${selector} gate input must come from live state`);
		}
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
