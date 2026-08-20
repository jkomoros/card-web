import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import minifyHTML from 'rollup-plugin-minify-html-literals';
import copy from 'rollup-plugin-copy';
import commonjs from '@rollup/plugin-commonjs';
import summary from 'rollup-plugin-summary';

export default [
	{
		//The stub whose name IS the published entry name. It must stay distinct
		//from card-web-app.js: master's service worker precached the app entry
		//at the stable, unhashed URL `lib/src/components/card-web-app.js`, and
		//answers it CACHE-FIRST. So on the first load after the rename deploys,
		//the browser would fetch HEAD's index.html and then run MASTER's bundle
		//— while HEAD's service worker installs and waits (skipWaiting is false
		//by design, and master's bundle has no update listener or SKIP_WAITING
		//sender to release it). The upgrade could not complete until every tab
		//in scope closed; reloading did not help. Serving the entry under a
		//name master never precached forces a network fetch, so HEAD's bundle
		//runs on the very first load.
		//
		//The rename lives in a real source module (src/components/
		//card-web-app-entry.ts) rather than in entryFileNames, so tsc emits the
		//SAME name for source serve (`npm start`) as rollup does for the build
		//— when it lived only here, `npm start` 404ed the app shell.
		//test/dev-serve pins the agreement.
		//
		//Durable follow-up: '[name]-[hash].js' plus an injection step in
		//tools/config.ts, which would make the cache-first hazard immune by
		//construction rather than by choosing a new name each cutover.
		input: 'lib/src/components/card-web-app-entry.js',
		output: {
			dir: 'build/lib/src/components',
			format: 'es',
			entryFileNames: '[name].js',
		},
		plugins: [
			minifyHTML(),
			copy({
				targets: [
					{ src: 'node_modules/@webcomponents', dest: 'build/node_modules' },
					{ src: 'images', dest: 'build' },
					{ src: 'fonts', dest: 'build' },
					{ src: 'seo', dest: 'build'},
					{ src: 'manifest.json', dest: 'build' },
					{ src: 'index.html', dest: 'build' },
					//Without a real file, Hosting's ** catch-all answered
					///robots.txt with the app shell at HTTP 200 (#753) — and
					//crawlers ask for it before touching the 1,240 prerendered
					//SEO pages.
					{ src: 'robots.txt', dest: 'build' },
				],
			}),
			resolve(),
			terser({
				format: {
					comments: false,
				}
			}),
			commonjs(),
			summary(),
		],
		preserveEntrySignatures: 'strict',
	},
	//The corpus worker gets its own self-contained bundle: it's loaded via
	//`new Worker('/lib/src/worker/corpus-worker.js', {type: 'module'})`, so it
	//must exist at that path in the built output and can't share chunks with
	//the app bundle.
	{
		input: 'lib/src/worker/corpus-worker.js',
		output: {
			dir: 'build/lib/src/worker',
			format: 'es',
			//Self-contained: no code-splitting for the worker graph.
			inlineDynamicImports: true,
		},
		plugins: [
			resolve(),
			terser({
				format: {
					comments: false,
				}
			}),
			commonjs(),
			summary(),
		],
		preserveEntrySignatures: 'strict',
	},
];
