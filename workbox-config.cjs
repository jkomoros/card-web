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
	//  \.ext   Anything with a file extension is an asset, not a route. Safe
	//          because zero card slugs contain a dot.
	navigateFallbackDenylist: [/^\/lib\//, /^\/__\//, /^\/seo\//, /\/[^/?]+\.[^/]+$/],
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
			urlPattern: /\/@webcomponents\/webcomponentsjs\//,
			handler: 'StaleWhileRevalidate'
		},
		{
			urlPattern: /^https:\/\/fonts.gstatic.com\//,
			handler: 'StaleWhileRevalidate'
		}
	]
};
