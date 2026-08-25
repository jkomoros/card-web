/*eslint-env node, es2022*/

//USER-FACING COPY IS PRODUCT, SO IT GETS CHECKED LIKE PRODUCT (HS-2)
//
//This file exists because of a specific, humiliating failure. While rewrapping
//a comment above a message, the word "can" was dropped from the string itself:
//
//    'This view is still showing placeholder content, so it’t be changed yet.'
//
//That shipped to every user who taps star, mark-read or reading-list on an
//orphaned card. TWO tests written specifically to pin that copy passed on it:
//one matched /placeholder content/, and the other — advertised at the time as
//replacing a vacuous sentence check with "a real sentence test" — asserted the
//string starts with a capital, ends with a full stop, has four or more words,
//and leaks no internal concept. The mangled sentence satisfies all four.
//
//The lesson is that SHAPE checks cannot tell a sentence from a wreck. So this
//file does two things shape checks cannot:
//
//  1. It pins the exact text of the messages that are stable copy. An exact pin
//     is the only thing that catches a word going missing, and copy that is
//     meant to be stable loses nothing by being pinned — if you change it on
//     purpose, you update the pin on purpose, which is the point.
//
//  2. It checks CONTRACTIONS across all user-facing strings. "it’t" is not a
//     word; neither is "does’t" or "was’t". That single rule catches the whole
//     family of damage this kind of edit does, everywhere, not just here.

import assert from 'assert';
import {readFileSync, readdirSync} from 'fs';

const ACTIONS = new URL('../../src/actions/', import.meta.url);
const COMPONENTS = new URL('../../src/components/', import.meta.url);

const stripComments = source => source
	.replace(/\/\*[\s\S]*?\*\//g, '')
	.replace(/^\s*\/\/.*$/gm, '');

const sourceFiles = () => {
	const out = [];
	for (const [dir, label] of [[ACTIONS, 'actions'], [COMPONENTS, 'components']]) {
		for (const file of readdirSync(dir)) {
			if (!file.endsWith('.ts')) continue;
			out.push({name: `${label}/${file}`, text: stripComments(readFileSync(new URL(file, dir), 'utf8'))});
		}
	}
	return out;
};

//Strings handed to a surface the user reads.
//
//`what:` and `reassurance:` are matched in PROPERTY form only — no space before
//the colon. A spaced ` : ` is a TYPE annotation in this repo's style, and the
//first version of this pattern duly flagged `what : 'post' | 'edit' = 'post'`
//as a sentence that does not start with a capital. That is the same
//type-position trap the banner-actionID pin fell into; matching it twice in one
//branch is why it is written down here.
//EVERY function that puts words on a surface, not just showSnackbar. The first
//version listed only showSnackbar and the banner properties, which left the
//refusal helpers — refuseTag and refuseCardCreation, i.e. most of the copy
//written this session — entirely unchecked. Mutation-testing caught it: a
//mangled contraction and a whitespace-only message both sailed through.
const USER_FACING = /(?:showSnackbar\(|refuseTag\(|refuseCardCreation\(|NotInteractableError\(|\bwhat:|\breassurance:)\s*(?:dispatch\s*,\s*)?(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

const userFacingStrings = () => {
	const out = [];
	for (const {name, text} of sourceFiles()) {
		for (const match of text.matchAll(USER_FACING)) {
			//Decode the \u escapes the source uses for curly quotes.
			const decoded = match[2].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
			out.push({file: name, text: decoded});
		}
	}
	return out;
};

//Every stem that can legitimately precede ’t in English.
const endsWithInterpolation = text => /\$\{[^}]*\}\s*$/.test(text.trim());

//Measured, not chosen.
const TRAILING_INTERPOLATION_BUDGET = 2;

const CONTRACTION_STEMS = ['can', 'don', 'won', 'isn', 'aren', 'wasn', 'weren', 'doesn', 'didn',
	'couldn', 'wouldn', 'shouldn', 'hasn', 'haven', 'hadn', 'mustn', 'mightn', 'needn', 'ain', 'shan'];

describe('user-facing copy (HS-2)', () => {

	it('finds the strings it claims to be checking', () => {
		const strings = userFacingStrings();
		assert.ok(strings.length > 40, `expected many user-facing strings, found ${strings.length} — this test has stopped seeing them`);
	});

	//THE CHECK THAT WOULD HAVE CAUGHT IT.
	it('contains no mangled contraction', () => {
		const broken = [];
		for (const {file, text} of userFacingStrings()) {
			//Any ’t must be preceded by a real stem. Interpolations are skipped:
			//their contents are not literal copy.
			const literal = text.replace(/\$\{[\s\S]*?\}/g, ' ');
			for (const match of literal.matchAll(/([A-Za-z]*)[’'](t)\b/g)) {
				const stem = match[1].toLowerCase();
				if (!CONTRACTION_STEMS.includes(stem)) {
					broken.push(`${file}: "${text}" — "${match[0]}" is not a contraction`);
				}
			}
		}
		assert.deepStrictEqual(broken, [],
			'a word went missing from a sentence. Shape checks pass on these; only this one does not:\n' + broken.join('\n'));
	});

	it('never opens a sentence in lower case or ends without punctuation', () => {
		const bad = [];
		for (const {file, text} of userFacingStrings()) {
			if (!text.trim()) continue;
			//Strings that BEGIN with an interpolation take their capital from the
			//value, and ones that END with one take their full stop from it.
			if (!/^\$\{/.test(text) && !/^[A-Z“"]/.test(text)) bad.push(`${file}: "${text}" does not start as a sentence`);
			if (endsWithInterpolation(text)) continue;
			if (!/[.!?]["”]?$/.test(text.trim())) bad.push(`${file}: "${text}" does not end as a sentence`);
		}
		assert.deepStrictEqual(bad, [], bad.join('\n'));
	});

	//THE EXEMPTION ABOVE, RATCHETED, because an exemption nobody counts is just
	//a hole. A message ending in ${...} hands its final punctuation to a value
	//this test cannot see — for the two that exist today that value is a cloud
	//function's `reason` and a caught error's `message`, neither of which is
	//guaranteed to be a sentence at all. They are HS-2.4's problem more than
	//HS-2's, and they are counted here so the number cannot quietly grow.
	it('has a shrinking number of messages that end in an interpolation', () => {
		const trailing = userFacingStrings().filter(entry => endsWithInterpolation(entry.text));
		assert.ok(trailing.length <= TRAILING_INTERPOLATION_BUDGET,
			`messages ending in an interpolation rose to ${trailing.length} (budget ${TRAILING_INTERPOLATION_BUDGET}). ` +
			'Each one ends its sentence with a value nothing here can vouch for:\n' +
			trailing.map(entry => `${entry.file}: "${entry.text}"`).join('\n'));
	});

	it('never renders an empty or whitespace-only message', () => {
		const blank = userFacingStrings().filter(entry => !entry.text.trim()).map(entry => entry.file);
		assert.deepStrictEqual(blank, [],
			`a blank toast is worse than silence — it flashes and says nothing:\n${blank.join('\n')}`);
	});

	//EXACT PINS for copy that is meant to be stable. Change them on purpose.
	it('pins the two refusals the collection guard shows verbatim', () => {
		const source = readFileSync(new URL('fallback-guard.ts', ACTIONS), 'utf8')
			.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
		assert.ok(source.includes('This view is still showing placeholder content, so it can’t be changed yet.'),
			'the fallback refusal has changed. If that was deliberate, update this pin; if it was not, a word has gone missing again.');
		assert.ok(source.includes('The view is still loading; try again in a moment.'),
			'the still-loading refusal has changed. If that was deliberate, update this pin.');
	});
});
