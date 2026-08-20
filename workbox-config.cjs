/**
 * @license
 * Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
 */

/*eslint-env node*/

module.exports = {
	globDirectory: 'build',
	swDest: 'build/service-worker.js',
	globPatterns: [
		'manifest.json',
		'index.html',
		'lib/src/**/*',
		//manifest.json is precached and points at icons; without these an
		//installed PWA offline showed no icon and fell back to system fonts
		//(#753). Boot never depended on them, which is why the gap survived.
		//Fonts precache only the woff2 + stylesheet: every browser capable of
		//running this service worker supports woff2, and eagerly downloading
		//the eot/svg/ttf/woff legacy formats at install would quintuple the
		//cost for files no client will ever request.
		'images/**/*',
		'fonts/**/*.woff2',
		'fonts/fonts.css',
	],
	globIgnores: [
		//firebase.json serves this file with an explicit Cache-Control:
		//no-cache — it is the one unhashed, stable-URL chunk, and a stale
		//copy is exactly the scenario corpus-ownership-gate's _resetAndReload
		//exists to rescue. Precaching it CacheFirst made that header inert
		//for every controlled client and removed the only way to refetch
		//(#753). The cost is a network fetch for the worker on cold start;
		//unlike card-web-app-entry.js (an acknowledged trade in the comment
		//below), this one directly contradicted a deliberate hosting header.
		//
		//NOT a bare exclusion: the NetworkFirst runtimeCaching route below is
		//this entry's load-bearing companion. Without it, offline boot in the
		//default worker mode fails closed into a permanent "Cards could not
		//load" panel — the precache entry was the only guaranteed offline
		//copy of the worker script, and 'on' mode has no main-thread
		//fallback. Do not remove one without the other.
		'lib/src/worker/corpus-worker.js',
	],
	//Offline boot needs BOTH of these, and neither has ever been here (#728):
	//index.html precached so the shell exists offline, and navigateFallback so
	//a navigation request resolves to it. Without them the service worker had
	//no route that could answer a navigation at all — every deep link is
	//rewritten to the shell by Hosting — so going offline and reloading showed
	//the browser's own error page. It looked like it worked in manual testing
	//because index.html is served with max-age=3600, so within an hour of a
	//real load the HTTP cache answered instead.
	//
	//THE TRADE, chosen deliberately by the owner: offline capability over
	//upgrade immediacy. Measured rather than assumed, by replaying deploys
	//against a controlled tab:
	//
	//  - The in-app "Update ready / Reload" affordance (card-web-app.ts, which
	//    posts SKIP_WAITING) serves the new shell in ONE click with no tab
	//    closed. Close-and-reopen is the FALLBACK, not the requirement — an
	//    earlier version of this comment had that backwards.
	//  - What is genuinely lost: renaming the entry file no longer forces new
	//    code. That lever is what defused the stale-service-worker problem
	//    during the 2026-08-16 cutover, and it is now spent.
	//  - What is gained beyond offline: a deploy that KEEPS the entry filename
	//    used to deliver new shell + old JS. Verified pre-change; coherent now.
	//
	//NetworkFirst for the shell was built and tested as the alternative, and
	//rejected on evidence, not preference: its cache is URL-KEYED, so it only
	//answers offline for URLs already visited. With Hosting rewriting 1,236+
	//card URLs to the shell, `/` and any unvisited deep link still hit the
	//browser error page — it is per-URL memoization, not offline boot, and it
	//does not fix #728.
	navigateFallback: 'index.html',
	//A navigation request for anything that is NOT an app route must not be
	//answered with the shell. This list is longer than it looks like it needs
	//to be because `request.mode === 'navigate'` covers more than address-bar
	//navigation — IFRAME loads carry it too.
	//
	//  /__/    Firebase reserved. THIS ONE IS LOAD-BEARING: authDomain is
	//          complexity-compendium.firebaseapp.com, the app is ALSO served on
	//          that origin, and Google sign-in bootstraps through an iframe at
	//          /__/auth/iframe. Without this entry the service worker answers
	//          that iframe with the app shell. (thecompendium.cards is
	//          unaffected — auth is cross-origin there — but the firebaseapp.com
	//          and dev origins are not.)
	//  /seo/   Prerendered per-card shells; serving the generic one defeats them.
	//
	//Assets are matched by KNOWN PREFIX plus root-level dotted files — NOT by
	//"any path segment containing a dot" (#753). That regex over-matched
	//filter ARGUMENTS: card slugs contain no dots, but query text does
	//(queryFilter uses encodeURIComponent, which preserves '.'), so
	///c/query/node.js was refused the shell and failed offline. Every real
	//asset lives under one of these prefixes or at the root (manifest.json,
	//robots.txt, service-worker.js, deploy-stamp.json), and no top-level app
	//route contains a dot.
	navigateFallbackDenylist: [
		/^\/lib\//,
		/^\/__\//,
		/^\/seo\//,
		/^\/images\//,
		/^\/fonts\//,
		/^\/node_modules\//,
		/^\/[^/?]+\.[^/]+$/,
	],
	//The production Firebase chunk is currently ~2.3 MB. Workbox's 2 MB
	//default silently omitted it, defeating warm/offline boots despite a
	//successfully installed service worker.
	maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
	//Updates wait until the app confirms there is no dirty draft or pending
	//mutation, then receive the standard SKIP_WAITING message.
	skipWaiting: false,
	clientsClaim: true,
	runtimeCaching: [
		{
			//The offline companion to the corpus-worker globIgnores entry
			//above. NetworkFirst honors the no-cache hosting header's intent
			//online (every fetch goes to the network first, so a deploy's new
			//worker is picked up immediately) while keeping the last-fetched
			//copy servable offline — where the precached CacheFirst copy used
			//to be the only thing standing between an offline boot and 'on'
			//mode's fail-closed "Cards could not load" panel. The timeout
			//bounds a hung network (captive portal) at cold start; the
			//page/worker protocol handshake already covers a vintage
			//mismatch if the cached copy is ever served stale.
			urlPattern: /\/lib\/src\/worker\/corpus-worker\.js$/,
			handler: 'NetworkFirst',
			options: {
				networkTimeoutSeconds: 5,
			}
		},
		{
			urlPattern: /\/@webcomponents\/webcomponentsjs\//,
			handler: 'StaleWhileRevalidate'
		},
		{
			urlPattern: /^https:\/\/fonts.gstatic.com\//,
			handler: 'StaleWhileRevalidate'
		}
	]
};
