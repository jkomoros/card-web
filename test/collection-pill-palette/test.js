/*eslint-env node, es2022*/

//THE CLAUSE PALETTE, PINNED AS A TABLE.
//
//The owner's call for this wave was "use colours for consistency and texture in
//a principled way — it should be MORE colourful than not, so at a glance, if
//you squint, you can tell what the collection has." Every assertion here is one
//half of that sentence made mechanical:
//
//  MORE COLOURFUL THAN NOT — the palette answers with a real hue for every
//  family of clause the app can spell, and only genuine plumbing falls back to
//  the grey that means "no opinion".
//
//  AT A GLANCE, IF YOU SQUINT — no two families may collapse into the same
//  colour. A squint resolves hue, not label, so the hues themselves have to be
//  far enough apart to survive it: 38° is the floor asserted below, and it is
//  the actual minimum, not a slack budget.
//
//  IN A PRINCIPLED WAY — the mapping is a pure function of the filter SPELLING,
//  so it is checkable here with no store, no corpus and no component. That is
//  the property that makes the rule reviewable at all; a palette that needed a
//  running app to explain itself would be a taste call with extra steps.
//
//And one structural pin that is not about colour: every value the palette can
//return must name a token card-web-app.ts's :host block actually defines. §4.1
//exists because chat-view.ts rendered blue in a purple app for its whole life
//through a var() fallback on a token nobody had ever defined. A palette is
//exactly the kind of file that failure hides in.

import { JSDOM } from 'jsdom';
import assert from 'assert';
import { readFileSync } from 'fs';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let collectionPillFamilyForFilter;
let collectionPillColorForFilter;
let COLLECTION_PILL_FAMILY_COLORS;
let COLLECTION_PILL_FAMILIES;

const APP_SOURCE = readFileSync(new URL('../../src/components/card-web-app.ts', import.meta.url), 'utf8');

//The same scrape test/design-tokens does, narrowed to the token names and their
//values: `--app-thing: <value>;` anywhere in the app's own stylesheet.
const DEFINED_TOKENS = (() => {
	const out = {};
	for (const match of APP_SOURCE.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
		out[match[1]] = match[2].trim();
	}
	return out;
})();

const TOKEN_REFERENCE = /^var\((--[a-z0-9-]+)\)$/;

const tokenNameOf = (value) => {
	const match = TOKEN_REFERENCE.exec(value);
	assert.ok(match, `a palette value must be a bare token reference with no fallback (§4.1), got ${value}`);
	return match[1];
};

//hsl(h, s%, l%) — the form every clause token is written in, so that the hue is
//a number this file can reason about rather than a hex triple it would have to
//convert. That is a deliberate constraint on the tokens, not an accident of
//this parser: a palette whose separations cannot be read off its own source is
//a palette nobody will check again.
const parseHSL = (value) => {
	const match = /^hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/.exec(value);
	return match ? { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) } : null;
};

//The short way round the wheel: 350° and 10° are 20° apart, not 340°.
const hueDistance = (a, b) => {
	const raw = Math.abs(a - b) % 360;
	return raw > 180 ? 360 - raw : raw;
};

const hsl2rgb = ({ h, s, l }) => {
	const sat = s / 100;
	const light = l / 100;
	const k = (n) => (n + h / 30) % 12;
	const a = sat * Math.min(light, 1 - light);
	const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [f(0), f(8), f(4)].map((v) => v * 255);
};

const hex2rgb = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));

const relativeLuminance = (rgb) => {
	const channels = rgb.map((value) => {
		const v = value / 255;
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

//tag-chip paints --app-light-text-color (white) on the fill, so white is the
//only foreground any of these values ever carries.
const contrastWithWhite = (rgb) => 1.05 / (relativeLuminance(rgb) + 0.05);

const rgbOfTokenValue = (value) => {
	const hsl = parseHSL(value);
	if (hsl) return hsl2rgb(hsl);
	assert.match(value, /^#[0-9a-f]{6}$/i, `unrecognised colour value ${value}`);
	return hex2rgb(value);
};

//§4.5's four reserved meanings. A clause hue that lands on one of them would be
//saying "something went wrong" or "this is a link" about a perfectly ordinary
//question the user asked.
const RESERVED_HUES = {
	'brand purple': 268,
	'live teal': 174,
	'warning red': 0,
	'pending amber': 33,
};

//The grey that means "this app has no opinion about what kind of clause this
//is". It is REUSED rather than invented, and it must stay that way: a second
//grey would be a second way of saying nothing.
const NEUTRAL = 'var(--app-dark-text-color-darker)';

//set-or-sort is the one family that deliberately declines a hue — a starting
//set is scaffolding, not a subject — so it is excluded from the hue-separation
//sweep and held to its own, stricter rule instead.
const QUIET_FAMILY = 'set-or-sort';

describe('the collection pill palette', () => {

	before(async () => {
		({
			collectionPillFamilyForFilter,
			collectionPillColorForFilter,
			COLLECTION_PILL_FAMILY_COLORS,
			COLLECTION_PILL_FAMILIES,
		} = await import('../../lib/src/collection-pill-palette.js'));
	});

	describe('every colour it can return is a real token', () => {

		it('finds the app token block it is checking against', () => {
			assert.ok(Object.keys(DEFINED_TOKENS).length > 30,
				`expected the app's token table, found ${Object.keys(DEFINED_TOKENS).length} definitions`);
			assert.ok(DEFINED_TOKENS['--app-primary-color'], 'the primary colour should be in the table');
		});

		it('names only tokens card-web-app.ts defines, and never a var() fallback', () => {
			for (const family of COLLECTION_PILL_FAMILIES) {
				const token = tokenNameOf(COLLECTION_PILL_FAMILY_COLORS[family]);
				assert.ok(DEFINED_TOKENS[token],
					`${family} names ${token}, which card-web-app.ts's :host block does not define — ` +
					'with a fallback this would render a quietly wrong colour rather than failing (§4.1)');
			}
		});

		it('gives every family a colour, including the ones nothing has asked for yet', () => {
			//A family with no entry would come out `undefined`, which tag-chip
			//would silently render as its own indian-red default — the same
			//shape of failure as a missing token.
			for (const family of COLLECTION_PILL_FAMILIES) {
				assert.ok(COLLECTION_PILL_FAMILY_COLORS[family], `${family} has no colour`);
			}
			assert.deepStrictEqual([...COLLECTION_PILL_FAMILIES].sort(), [
				'card-property', 'card-type', 'date', 'person', 'relationship',
				'set-or-sort', 'similarity', 'text', 'unknown',
			].sort(), 'the family list is the taxonomy; changing it is a design decision');
		});
	});

	describe('the squint test, mechanized', () => {

		const huedFamilies = () => COLLECTION_PILL_FAMILIES
			.filter(family => family !== 'unknown' && family !== QUIET_FAMILY);

		const hueOf = (family) => {
			const value = DEFINED_TOKENS[tokenNameOf(COLLECTION_PILL_FAMILY_COLORS[family])];
			const hsl = parseHSL(value);
			assert.ok(hsl, `${family}'s token is ${value}; clause colours are written in hsl() so their separation is readable`);
			return hsl;
		};

		it('gives no two categories the same colour', () => {
			const seen = new Map();
			for (const family of COLLECTION_PILL_FAMILIES) {
				if (family === 'unknown') continue;
				const value = DEFINED_TOKENS[tokenNameOf(COLLECTION_PILL_FAMILY_COLORS[family])];
				const previous = seen.get(value);
				assert.strictEqual(previous, undefined,
					`${family} and ${previous} paint the same colour ${value}, so a squint cannot tell them apart`);
				seen.set(value, family);
			}
		});

		//38° IS THE ACTUAL MINIMUM, NOT A SLACK BUDGET. The tightest pair is rose
		//(340°) against terracotta (18°), going the short way round the wheel.
		//If a future hue is added or moved, this fails rather than letting two
		//families quietly converge.
		it('keeps every pair of hued families at least 38° apart', () => {
			const families = huedFamilies();
			const hues = Object.fromEntries(families.map(family => [family, hueOf(family).h]));
			//All distinct as raw angles, before distance is even considered.
			assert.strictEqual(new Set(Object.values(hues)).size, families.length,
				`two hued families share an angle: ${JSON.stringify(hues)}`);
			let worst = { distance: Infinity, pair: null };
			for (const a of families) {
				for (const b of families) {
					if (a >= b) continue;
					const distance = hueDistance(hues[a], hues[b]);
					if (distance < worst.distance) worst = { distance, pair: `${a} (${hues[a]}°) / ${b} (${hues[b]}°)` };
				}
			}
			assert.ok(worst.distance >= 38,
				`${worst.pair} are only ${worst.distance}° apart; the squint test needs at least 38°`);
		});

		//THE ONE FAMILY THAT IS DELIBERATELY NOT A HUE. A set or a sort is
		//scaffolding rather than something the collection is ABOUT, so it takes
		//the quiet treatment instead of an eighth colour competing with the seven
		//that carry meaning. It is allowed to reuse an angle precisely because at
		//this saturation it is not read as that angle — which is why it is
		//excluded from the sweep above rather than exempted inside it.
		it('holds the set-or-sort family to a desaturated slate rather than a hue', () => {
			const quiet = hueOf(QUIET_FAMILY);
			assert.ok(quiet.s <= 15, `${QUIET_FAMILY} is at ${quiet.s}% saturation; scaffolding must not read as a colour`);
			for (const family of huedFamilies()) {
				assert.ok(hueOf(family).s > quiet.s + 20,
					`${family} must be visibly more saturated than the quiet family, or the distinction is lost`);
			}
		});

		//ONE RAMP, NOT CONFETTI. A palette assembled one colour at a time reads
		//as a set of unrelated stickers; holding every value inside a narrow
		//lightness band is what makes eight hues look like one decision.
		it('keeps every value inside one lightness band', () => {
			for (const family of COLLECTION_PILL_FAMILIES) {
				if (family === 'unknown') continue;
				const { l } = hueOf(family);
				assert.ok(l >= 26 && l <= 42, `${family} is at ${l}% lightness, outside the 26–42% ramp`);
			}
		});

		//§4.5's reserved semantics. Nearest today: terracotta 18° against pending
		//amber 33°, and indigo 252° against brand purple 268°.
		it('keeps every clause hue clear of the four reserved status colours', () => {
			for (const family of huedFamilies()) {
				const { h } = hueOf(family);
				for (const [name, reserved] of Object.entries(RESERVED_HUES)) {
					const distance = hueDistance(h, reserved);
					assert.ok(distance >= 15,
						`${family} (${h}°) is ${distance}° from ${name} (${reserved}°); a clause must never read as a status`);
				}
			}
		});

		//tag-chip puts white text on the fill, so a pretty hue that cannot carry
		//it is not a usable hue. §4.1 has no exception for pills.
		it('carries white text at AA on every fill', () => {
			for (const family of COLLECTION_PILL_FAMILIES) {
				const value = DEFINED_TOKENS[tokenNameOf(COLLECTION_PILL_FAMILY_COLORS[family])];
				const ratio = contrastWithWhite(rgbOfTokenValue(value));
				assert.ok(ratio >= 4.5,
					`${family} (${value}) is ${ratio.toFixed(2)}:1 against white, below the 4.5:1 floor`);
			}
		});
	});

	describe('the mapping from a spelling', () => {

		//ONE REPRESENTATIVE PER FAMILY. These are the spellings the URL grammar
		//actually produces, arguments and all, because the family has to be
		//readable off the spelling ALONE — no candidate, no store, no corpus.
		const CASES = {
			'updated/after/2020-01-01': 'date',
			'created/before/2021-01-01': 'date',
			'last-tweeted/after/2020-01-01': 'date',
			'content': 'card-type',
			'working-notes': 'card-type',
			'section-head': 'card-type',
			'author/me': 'person',
			'direct-connections/+abc': 'relationship',
			'children/+abc': 'relationship',
			'references/+abc/link/2': 'relationship',
			'similar/+abc': 'similarity',
			'different-type/+abc': 'similarity',
			'query/foo': 'text',
			'about-concept/foo': 'text',
			'starred': 'card-property',
			'has-todo': 'card-property',
			'unpublished': 'card-property',
			'in-everything-set': 'set-or-sort',
			'in-reading-list': 'set-or-sort',
			'combine/a/b': 'unknown',
		};

		it('files a representative filter from each family under that family', () => {
			for (const [filter, family] of Object.entries(CASES)) {
				assert.strictEqual(collectionPillFamilyForFilter(filter), family, `${filter} should be ${family}`);
			}
		});

		it('covers every family with at least one representative', () => {
			const covered = new Set(Object.values(CASES));
			for (const family of COLLECTION_PILL_FAMILIES) {
				assert.ok(covered.has(family), `no representative spelling is pinned for ${family}`);
			}
		});

		//THE `person` CARD TYPE AND THE `author` CLAUSE ARE DIFFERENT QUESTIONS
		//that happen to share a word. A card ABOUT a human is a card type; a card
		//WRITTEN BY one is an authorship clause. Filing them together would put
		//the commonest personal filter under the type palette.
		it('separates the person card type from an authorship clause', () => {
			assert.strictEqual(collectionPillFamilyForFilter('person'), 'card-type');
			assert.strictEqual(collectionPillFamilyForFilter('author/me'), 'person');
			assert.notStrictEqual(collectionPillColorForFilter('person'), collectionPillColorForFilter('author/me'));
		});

		//A SUB-FILTER ARGUMENT IS NOT A RELATIONSHIP. exclude/combine/expand take
		//the same argument type the connection filters take, so an argument-only
		//test would paint the boolean plumbing of an expression indigo and claim
		//it was a claim about linked cards.
		it('refuses to mistake expression plumbing for a relationship', () => {
			for (const filter of ['combine/a/b', 'exclude/starred', 'expand/similar', 'limit/10', 'offset/5']) {
				assert.strictEqual(collectionPillFamilyForFilter(filter), 'unknown', `${filter} is scaffolding, not a subject`);
				assert.strictEqual(collectionPillColorForFilter(filter), NEUTRAL);
			}
		});

		//AND A KEY-CARD ARGUMENT IS NOT ALWAYS ONE EITHER. "Cards like this one"
		//and "cards this one links to" are different questions, and every
		//similarity filter takes a key card, so it has to be answered by name.
		it('separates similarity from relationship even though both take a key card', () => {
			assert.notStrictEqual(
				collectionPillColorForFilter('similar/+abc'),
				collectionPillColorForFilter('direct-connections/+abc'),
				'a squint must tell "like this card" from "linked to this card"');
		});

		it('leaves a manual clause and anything it cannot recognise on the reused neutral', () => {
			//The exact spelling collection-sentence's own suite hands a manual
			//node, plus the shapes an unrecognised clause actually arrives in.
			for (const filter of ['expand/similar', 'zzz-not-a-filter', 'some/thing/nobody/defined', '']) {
				assert.strictEqual(collectionPillFamilyForFilter(filter), 'unknown', `${filter} should be unknown`);
				assert.strictEqual(collectionPillColorForFilter(filter), NEUTRAL,
					'"no opinion" already has a colour in this app and must not acquire a second one');
			}
			assert.strictEqual(COLLECTION_PILL_FAMILY_COLORS['unknown'], NEUTRAL);
		});

		//THE TWO SHAPES THAT ARE NOT A BARE NAME. A union is one clause meaning
		//"any of these" and takes its first member's family; a configurable
		//filter carries its arguments in the same string and takes its first
		//segment's. Both resolve to a real colour rather than falling through to
		//the neutral, which is what "more colourful than not" costs in practice.
		it('resolves a union spelling and a configurable-with-arguments spelling', () => {
			assert.strictEqual(collectionPillFamilyForFilter('content+working-notes'), 'card-type');
			assert.strictEqual(collectionPillColorForFilter('content+working-notes'),
				collectionPillColorForFilter('content'));
			assert.strictEqual(collectionPillFamilyForFilter('references/+abc/link/2'), 'relationship');
			assert.strictEqual(collectionPillFamilyForFilter('cards/+card-1+card-2'), 'text');
			assert.strictEqual(collectionPillFamilyForFilter('similar-cutoff/+abc/0.5'), 'similarity');
			for (const filter of ['content+working-notes', 'references/+abc/link/2', 'cards/+card-1+card-2']) {
				assert.notStrictEqual(collectionPillColorForFilter(filter), NEUTRAL,
					`${filter} is a clause the app understands and must not read as one it does not`);
			}
		});

		//BOTH HALVES OF A NAMED PAIR ARE THE SAME KIND OF CLAIM. `unread` is not
		//a different subject from `read`, and `not-in-reading-list` is scaffolding
		//for exactly the reason `in-reading-list` is — the polarity is the
		//label's business, and tag-chip's own outline inversion is where it shows.
		it('gives a filter and its named inverse the same family', () => {
			for (const [a, b] of [['starred', 'unstarred'], ['read', 'unread'], ['in-reading-list', 'not-in-reading-list']]) {
				assert.strictEqual(collectionPillFamilyForFilter(a), collectionPillFamilyForFilter(b),
					`${a} and ${b} are one claim with two polarities`);
			}
		});
	});
});
