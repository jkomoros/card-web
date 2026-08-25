/*eslint-env node, es2022*/

//EVERY DESIGN TOKEN A COMPONENT NAMES MUST EXIST (HS-4.1)
//
//This file exists because of D10, and D10 is worth describing exactly, because
//the bug and the rule that was supposed to prevent it are the same thing.
//
//chat-view.ts referred to three tokens that are defined nowhere in the app:
//--app-primary-rgb, --app-background-color and --app-light-accent-color. Every
//one of those references also carried a var() FALLBACK. So nothing broke, no
//error appeared, and the file simply rendered its accent colour as the fallback
//value — rgba(0, 120, 212), which is BLUE, in an app whose primary colour is
//purple. It had done so since the file was written.
//
//That is the whole argument for §4.1's "no var() fallbacks": a fallback does
//not protect against a missing token, it CONCEALS one. The failure it produces
//is not a crash but a quietly wrong colour, which is the kind of thing nobody
//files a bug about and everybody assumes is intentional.
//
//So the assertion here is not "no fallbacks" — some are legitimate, for local
//variables a component sets on itself (--card-link-cursor, --corpus-progress).
//It is the stronger and more useful one: every APP-LEVEL token referenced
//anywhere must actually be defined. A fallback cannot satisfy it.

import assert from 'assert';
import {readFileSync, readdirSync} from 'fs';

const COMPONENTS = new URL('../../src/components/', import.meta.url);

const stripComments = source => source
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/^\s*\/\/.*$/gm, '');

//card-web-app.ts's :host block is the single source of truth (HS-4.1).
const definedTokens = () => {
	const source = readFileSync(new URL('card-web-app.ts', COMPONENTS), 'utf8');
	return new Set([...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map(match => match[1]));
};

//Tokens a component legitimately defines on ITSELF and reads with a default.
//These are parameters, not app tokens: the component sets them inline or a
//parent overrides them, and the fallback is the documented default value.
const LOCAL_PARAMETERS = new Set([
	'--card-link-cursor',
	'--corpus-ring-color',
	'--corpus-progress',
]);

const referencesByFile = () => {
	const out = [];
	for (const file of readdirSync(COMPONENTS)) {
		if (!file.endsWith('.ts')) continue;
		const source = stripComments(readFileSync(new URL(file, COMPONENTS), 'utf8'));
		for (const match of source.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,)?/g)) {
			out.push({file, token: match[1], hasFallback: Boolean(match[2])});
		}
	}
	return out;
};

//A token defined by the component itself, anywhere in its own stylesheet.
const selfDefined = (file, token) => {
	const source = stripComments(readFileSync(new URL(file, COMPONENTS), 'utf8'));
	return new RegExp(`${token}\\s*:`).test(source);
};

describe('design tokens (HS-4.1)', () => {

	it('finds the token table it claims to be checking', () => {
		const defined = definedTokens();
		assert.ok(defined.size > 30, `expected the app's token block, found ${defined.size} definitions`);
		assert.ok(defined.has('--app-primary-color'), 'the primary colour should be in the table');
	});

	it('sees a representative number of token references', () => {
		const refs = referencesByFile();
		assert.ok(refs.length > 200, `expected hundreds of token references, found ${refs.length} — this test has stopped seeing them`);
	});

	it('never references an app token that is defined nowhere', () => {
		const defined = definedTokens();
		const missing = referencesByFile()
			.filter(ref => !defined.has(ref.token))
			.filter(ref => !LOCAL_PARAMETERS.has(ref.token))
			.filter(ref => !selfDefined(ref.file, ref.token))
			.map(ref => `${ref.file}: ${ref.token}${ref.hasFallback ? ' (masked by a fallback)' : ''}`);
		const unique = [...new Set(missing)];
		assert.deepStrictEqual(unique, [],
			'these tokens are named but defined nowhere. With a fallback this renders a quietly wrong value ' +
			'rather than failing — which is how chat-view rendered blue in a purple app for its whole life:\n' + unique.join('\n'));
	});

	//The fallbacks that remain all name tokens that DO exist, so they are dead
	//weight rather than a hazard. Ratcheted so the number cannot climb back:
	//every one of them is a place where a future rename would fail silently
	//instead of loudly.
	it('has a shrinking number of var() fallbacks', () => {
		const withFallback = referencesByFile()
			.filter(ref => ref.hasFallback)
			.filter(ref => !LOCAL_PARAMETERS.has(ref.token));
		assert.ok(withFallback.length <= FALLBACK_BUDGET,
			`var() fallbacks rose to ${withFallback.length} (budget ${FALLBACK_BUDGET}). §4.1 forbids them because a ` +
			`fallback conceals a missing token instead of protecting against one:\n` +
			withFallback.map(ref => `${ref.file}: ${ref.token}`).join('\n'));
	});
});

//Measured, not chosen. Lower it; never raise it.
const FALLBACK_BUDGET = 12;
