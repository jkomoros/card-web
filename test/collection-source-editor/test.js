/*eslint-env node, es2022*/

import { JSDOM } from 'jsdom';
import assert from 'assert';
import { LEGACY_COLLECTION_SOURCE_FIXTURES } from '../collection-source/fixtures.js';

const dom = new JSDOM('', { url: 'https://thecompendium.cards/c/everything/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let parseCollectionSource;
let CARD_FILTER_DESCRIPTIONS;

describe('lossless collection source editor', () => {
	before(async () => {
		({ parseCollectionSource } = await import('../../lib/src/collection-source.js'));
		({ CARD_FILTER_DESCRIPTIONS } = await import('../../lib/src/filters.js'));
	});

	const parse = (raw, extras = []) => parseCollectionSource(raw, {
		ordinaryFilters: new Set([...Object.keys(CARD_FILTER_DESCRIPTIONS), ...extras]),
		preservedSelectedCard: 'active-card',
		allowedOrigins: new Set(['https://thecompendium.cards', 'https://example.com']),
	});

	for (const fixture of LEGACY_COLLECTION_SOURCE_FIXTURES) {
		it(`classifies ${fixture.name}`, () => {
			const result = parse(fixture.source, ['inductively-knowable']);
			const expected = fixture.desired.classification === 'executable' ? 'valid' : fixture.desired.classification;
			assert.strictEqual(result.status, expected);
			assert.strictEqual(result.raw, fixture.source);
			assert.strictEqual(Boolean(result.description), expected === 'valid');
			assert.strictEqual(Boolean(result.canonicalPath), expected === 'valid');
		});
	}

	it('distinguishes fragment filters from route selected-card suffixes', () => {
		const fragment = parse('starred');
		assert.deepStrictEqual(fragment.description.filters, ['starred']);
		assert.strictEqual(fragment.selectedCardRaw, 'active-card');
		assert.strictEqual(fragment.canonicalPath, '/c/starred/active-card');

		const route = parse('/c/everything/working-notes/_');
		assert.deepStrictEqual(route.description.filters, ['working-notes']);
		assert.strictEqual(route.selectedCardRaw, '_');
		assert.strictEqual(route.canonicalPath, '/c/everything/working-notes/_');
	});

	it('retains URL decorations but imports only the local collection path', () => {
		const result = parse('https://thecompendium.cards/c/everything/starred/card-7?force-collection#context');
		assert.strictEqual(result.status, 'valid');
		assert.strictEqual(result.query, '?force-collection');
		assert.strictEqual(result.hash, '#context');
		assert.strictEqual(result.selectedCardRaw, 'card-7');
		assert.strictEqual(result.canonicalPath, '/c/everything/starred/card-7');
		assert.ok(result.notices.length);
	});

	it('rejects foreign URL origins and accepts encoded reserved arguments', () => {
		assert.strictEqual(parse('https://evil.example/c/everything/starred/card-7').status, 'invalid');
		assert.strictEqual(parse('query/%73ort/').status, 'valid');
	});

	//Which origins are trusted is deployment configuration, so the refusal
	//cannot promise "the production site" — a deployment that configures no
	//public domain has exactly one trusted origin, its own.
	it('phrases the foreign-origin refusal from the origins it was actually given', () => {
		const refusal = (allowedOrigins) => parseCollectionSource(
			'https://evil.example/c/everything/starred/card-7',
			{ ordinaryFilters: new Set(Object.keys(CARD_FILTER_DESCRIPTIONS)), allowedOrigins }
		).diagnostics.find(item => item.code === 'foreign-origin').message;
		assert.strictEqual(refusal(new Set(['https://example.com'])), 'Use a URL from this app.');
		const both = refusal(new Set(['https://example.com', 'https://thecompendium.cards']));
		assert.strictEqual(both, 'Use a URL from this app or its public address.');
		//No deployment's name appears in either sentence.
		assert.ok(!/compendium/i.test(both));
	});

	it('teaches legal starting tokens and configurable arguments', () => {
		const empty = parse('');
		assert.strictEqual(empty.status, 'incomplete');
		assert.ok(empty.diagnostics[0].expected.includes('starred'));
		assert.ok(empty.diagnostics[0].expected.includes('sort'));
		const query = parse('query/');
		assert.strictEqual(query.status, 'incomplete');
		assert.deepStrictEqual(query.diagnostics[0].expected, ['foo']);
		assert.match(query.diagnostics[0].expectedDetails.foo, /Query text/);
	});

	it('keeps valid collections discoverable and searches the live filter vocabulary', () => {
		const valid = parse('starred/');
		assert.strictEqual(valid.status, 'valid');
		assert.ok(valid.nextExpected.includes('sort'));
		assert.ok(valid.nextExpected.includes('query'));

		const searched = parseCollectionSource('induct/', {
			ordinaryFilters: new Set([...Object.keys(CARD_FILTER_DESCRIPTIONS), 'inductively-knowable']),
			filterDescriptions: { 'inductively-knowable': 'Cards tagged Inductively Knowable' },
			suggestedFilters: ['inductively-knowable'],
			filterSearchValues: { 'inductively-knowable': ['Inductively Knowable', 'tag'] },
			preservedSelectedCard: 'active-card',
		});
		//"induct" is the start of a filter this app knows, so it is a token the
		//user has not finished typing — not a token the app refuses. Calling it
		//unsupported reported a hard failure on every keystroke of a word that was
		//going fine, while the completion list underneath already offered the
		//match.
		assert.strictEqual(searched.status, 'incomplete');
		assert.strictEqual(searched.diagnostics[0].code, 'unfinished-filter');
		assert.ok(searched.diagnostics[0].expected.includes('inductively-knowable'));
		assert.match(searched.diagnostics[0].expectedDetails['inductively-knowable'], /tagged/);

		//A token that is the start of nothing is still genuinely unsupported.
		const unknown = parseCollectionSource('zzznotafilter/', {
			ordinaryFilters: new Set(Object.keys(CARD_FILTER_DESCRIPTIONS)),
			preservedSelectedCard: 'active-card',
		});
		assert.strictEqual(unknown.status, 'unsupported');
		assert.strictEqual(unknown.diagnostics[0].code, 'unknown-filter');
	});

	//Half a word is not a wrong word. "sta" is a filter the user has not finished
	//typing; the status line calling that "Not supported here" on every keystroke
	//reported a hard failure about a state that was going fine — while the
	//completion list underneath was already offering Starred.
	it('classifies an unfinished filter as incomplete, not unsupported', () => {
		const cases = [
			['sta/', 'unfinished-filter', 'starred'],
			['everything/unre/', 'unfinished-filter', 'unread'],
			['exclude/working-n/', 'unfinished-nested-filter', 'working-notes'],
		];
		for (const [raw, code, completion] of cases) {
			const result = parse(raw);
			assert.strictEqual(result.status, 'incomplete', raw);
			assert.strictEqual(result.diagnostics[0].code, code, raw);
			assert.ok(result.diagnostics[0].expected.includes(completion), raw);
			assert.match(result.diagnostics[0].message, /start of a filter name/, raw);
		}
		//A token that is the start of nothing is genuinely unsupported, and stays
		//that way.
		for (const raw of ['zzznotafilter/', 'exclude/zzznotafilter/']) {
			assert.strictEqual(parse(raw).status, 'unsupported', raw);
		}
		//An exact filter name is not "unfinished" merely because longer names start
		//with it.
		assert.strictEqual(parse('starred/').status, 'valid');
	});

	it('does not reinterpret percent-encoded structural keywords', () => {
		for (const raw of ['%73ort/recent/', 'sort/%72everse/recent/']) {
			const result = parse(raw);
			assert.notStrictEqual(result.status, 'valid', raw);
			assert.strictEqual(result.description, undefined, raw);
		}
	});

	it('validates nested filters and typed configurable arguments', () => {
		for (const raw of [
			'exclude/future-filter/',
			'combine/starred/future-filter/',
			'similar-cutoff/_/not-a-number/',
			'descendants/_/not-an-integer/',
		]) assert.notStrictEqual(parse(raw).status, 'valid', raw);
		assert.strictEqual(parse('exclude/starred/').status, 'valid');
		assert.strictEqual(parse('exclude/query/encoded%20text/').status, 'valid');
	});

	it('searches the full filter vocabulary inside nested expressions', () => {
		const result = parse('exclude/working-n/');
		//Same rule one level down: a prefix of a known nested filter is unfinished,
		//not unsupported.
		assert.strictEqual(result.status, 'incomplete');
		assert.strictEqual(result.diagnostics[0].code, 'unfinished-nested-filter');
		assert.ok(result.diagnostics[0].expected.includes('working-notes'));
		assert.strictEqual(parse('exclude/zzznotafilter/').status, 'unsupported');
	});

	it('requires /c for app-relative routes and canonicalizes only the destination', () => {
		assert.strictEqual(parse('/everything/starred/').status, 'invalid');
		const result = parse('everything/unread/starred/');
		assert.strictEqual(result.status, 'valid');
		assert.strictEqual(result.raw, 'everything/unread/starred/');
		assert.strictEqual(result.canonicalPath, '/c/everything/starred/unread/active-card');
	});

	it('never silently lowers partial, malformed, or unknown source', () => {
		for (const raw of ['updated/', 'updated/before/', 'before/2026-7-17/', 'future-filter/', 'view/grid/', 'query/bad%2/']) {
			const result = parse(raw);
			assert.notStrictEqual(result.status, 'valid', raw);
			assert.strictEqual(result.description, undefined, raw);
			assert.strictEqual(result.canonicalPath, undefined, raw);
			assert.strictEqual(result.raw, raw);
		}
	});

	it('accepts runtime section and tag filters without weakening unknown-filter checks', () => {
		assert.strictEqual(parse('systems/', ['systems']).status, 'valid');
		assert.strictEqual(parse('systems/').status, 'unsupported');
	});

	//A QUOTED TOKEN IS THE USER'S OWN TEXT, OR IT IS A LIE.
	//
	//`new URL()` collapses `..` before this module sees the path, so
	//`/c/../zzzfoo/` arrived as `/zzzfoo/` and the fixed-length slice that used
	//to strip `/c/` ate a character off whatever was actually there. The
	//diagnostics then quoted “zzfoo” and “tc” — tokens nobody typed, sending the
	//reader hunting for a typo that was ours. The prefix is a SEGMENT now, so a
	//climb out of the route is reported as a climb rather than silently parsed.
	it('quotes the token the user typed, even when the URL normalizer moved the path', () => {
		const climbed = parse('/c/../zzzfoo/');
		assert.notStrictEqual(climbed.status, 'valid');
		const quoted = climbed.diagnostics.map(diagnostic => diagnostic.message).join(' ');
		assert.ok(!/zzfoo/.test(quoted.replace(/zzzfoo/g, '')), `a diagnostic quoted a mangled token: ${quoted}`);
		assert.ok(climbed.diagnostics.some(diagnostic => diagnostic.code === 'wrong-route'),
			'climbing out of /c/ is itself the thing to report');

		const escaped = parse('/c/../../etc/passwd');
		assert.notStrictEqual(escaped.status, 'valid');
		const escapedQuoted = escaped.diagnostics.map(diagnostic => diagnostic.message).join(' ');
		assert.ok(!/“tc”/.test(escapedQuoted), `a diagnostic quoted a mangled token: ${escapedQuoted}`);

		//An ordinary route is unaffected: the segment split has to be a pure
		//refactor for every path that never left /c/.
		const plain = parse('/c/everything/starred/card-7');
		assert.strictEqual(plain.status, 'valid');
		assert.strictEqual(plain.canonicalPath, '/c/everything/starred/card-7');
		assert.strictEqual(parse('/c/').status, 'valid');
	});

	//A COMPLETION SAYS WHAT KIND OF THING IT IS.
	//
	//`sort/` offered every sort name in the app with no expectedKind and no
	//details, so the one row treatment that renders completions fell through to
	//its last case and labeled each of them a filter, described as "A legal
	//collection filter". And `sort/sta` reported a hard "this app does not know
	//the sort" while `sta` in a filter position had said "keep typing" since the
	//last wave — the same production answered two different ways.
	it('tags sort and view completions with their real kind, and keeps a half-typed one open', () => {
		const needsSort = parse('starred/sort/');
		assert.strictEqual(needsSort.status, 'incomplete');
		const sortDiagnostic = needsSort.diagnostics.find(diagnostic => diagnostic.expected?.length);
		assert.strictEqual(sortDiagnostic.expectedKind, 'sort');
		assert.ok(sortDiagnostic.expected.includes('recent'));
		assert.ok(sortDiagnostic.expectedDetails.recent, 'every offered sort carries its own description');

		const halfSort = parse('starred/sort/sta');
		assert.strictEqual(halfSort.status, 'incomplete', 'half a sort name is not a wrong one');
		const halfDiagnostic = halfSort.diagnostics.find(diagnostic => diagnostic.expected?.length);
		assert.strictEqual(halfDiagnostic.expectedKind, 'sort');
		assert.ok(halfDiagnostic.expected.length, 'the keep-typing state offers something to choose');
		assert.ok(halfDiagnostic.expected.every(name => name.startsWith('sta')), 'completions narrow to what was typed');

		//A sort name that is not the start of anything is still unsupported —
		//the keep-typing path must not swallow a real mistake.
		assert.strictEqual(parse('starred/sort/zzz').status, 'unsupported');

		const needsView = parse('starred/view/');
		assert.strictEqual(needsView.diagnostics.find(diagnostic => diagnostic.expected?.length).expectedKind, 'view');
		assert.strictEqual(parse('starred/view/we').status, 'incomplete');
	});

	//The parser reports the origin it READ; only the UI knows which origin is
	//the one this client runs on, and therefore whether one was translated.
	it('reports the origin a full URL was written against', () => {
		assert.strictEqual(parse('https://thecompendium.cards/c/everything/starred/').origin, 'https://thecompendium.cards');
		assert.strictEqual(parse('/c/everything/starred/').origin, '');
		assert.strictEqual(parse('everything/starred/').origin, '');
	});
});
