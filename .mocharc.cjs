/*eslint-env node*/

//Applies to every mocha invocation in this repo, so the staleness guard cannot
//be forgotten in one of 41 script definitions. `esm` was previously passed as
//`-r esm` per script; keeping it here is harmless where it is also passed.
module.exports = {
	require: ['esm', './tools/assert-build-fresh.cjs']
};
