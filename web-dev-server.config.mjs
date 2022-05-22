//If some future modules need commonjs, see
//https://modern-web.dev/guides/dev-server/using-plugins/#commonjs for how to
//accomplish that.

export default {
	//File to return for any path that would otherwise 404
	appIndex: 'index.html',
	//Flags for --node-resolve (options at https://www.npmjs.com/package/rollup-plugin-node-resolve-main-fields)
	nodeResolve: {
		/* reselect-map has an ESG export at jsnext */
		mainFields: ['jsnext:main', 'module', 'main']
	},
};