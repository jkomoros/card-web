import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import minifyHTML from 'rollup-plugin-minify-html-literals';
import copy from 'rollup-plugin-copy';
import commonjs from '@rollup/plugin-commonjs';
import summary from 'rollup-plugin-summary';

export default [
	{
		input: 'lib/src/components/card-web-app.js',
		output: {
			dir: 'build/lib/src/components',
			format: 'es',
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
