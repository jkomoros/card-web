import resolve from '@rollup/plugin-node-resolve';
import { terser } from 'rollup-plugin-terser';
import minifyHTML from 'rollup-plugin-minify-html-literals';
import copy from 'rollup-plugin-copy';
import commonjs from '@rollup/plugin-commonjs';
import summary from 'rollup-plugin-summary';

export default {
	input: 'src/components/card-web-app.js',
	output: {
		dir: 'build/src/components',
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
};