/*eslint-env node*/

//Deterministic, worst-case synthetic card corpus generator for the perf
//harness (test/perf-harness/README.md). No app imports (so it runs standalone
//under Node/tsx and cannot pull in firebase's browser-only init), and no
//Math.random / Date.now (seeded PRNG + explicit epoch) so a given seed always
//produces byte-identical output — a corpus you can regenerate on any machine
//or in CI instead of restoring a prod backup.
//
//"Worst-case" for interaction perf means: a DENSE reference graph (so
//makeFilterFromCards has many non-trivial filter memberships to recompute),
//large card bodies (heap + render cost), many tags, a published/unpublished
//mix, and updated-timestamp spread (so watermark/sort have real work). The
//forward `references` are built first, then `references_inbound` is derived
//consistently in a second pass — the shape the inbound-reference filters and
//the corpus-sync inbound machinery actually read.
//
//CLI: node test/perf-harness/gen-corpus.mjs --count 40000 --seed 1 --out corpus.json [--stats]

import fs from 'fs';

//The one permitted app import: pure token/fingerprint helpers (no firebase,
//no DOM). Generated cards must pass the worker's token-currency predicate
//(nlp_version + source fingerprint) or search-recall narrowing degrades to
//always-scan and the harness stops exercising it.
import {
	CURRENT_NLP_VERSION,
	nlpSourceFingerprintForCard
} from '../../shared/dist/nlp.js';

//mulberry32: tiny deterministic PRNG. Seeded; no global randomness.
const mulberry32 = (seed) => {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

//Weighted toward the real corpus (working-notes dominate the ~39k
//unpublished cards; content next; everything else is a thin tail).
const CARD_TYPE_WEIGHTS = [
	['working-notes', 0.55],
	['content', 0.32],
	['concept', 0.06],
	['work', 0.03],
	['person', 0.02],
	['quote', 0.01],
	['section-head', 0.01],
];
const SECTIONS = ['main', 'stubs', 'random-thoughts', '', '', '']; //blanks = orphaned (worst case for section filters)
const REFERENCE_TYPES = ['link', 'dupe-of', 'ack', 'see-also', 'concept', 'example-of', 'mined-from'];
const TAG_POOL = Array.from({length: 40}, (_, i) => 'tag-' + i);

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const intBetween = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

const pickWeighted = (rnd, weighted) => {
	let roll = rnd();
	for (const [value, weight] of weighted) {
		roll -= weight;
		if (roll <= 0) return value;
	}
	return weighted[weighted.length - 1][0];
};

//A deterministic pseudo-word vocabulary (~800 words from syllables). The
//previous single repeated sentence gave the whole corpus ~15 unique words:
//every fingerprint was near-identical, IDF was degenerate, and the worker's
//search index (which indexes stored nlp_search_tokens) had nothing
//realistic to index — the review found the harness structurally unable to
//reproduce any NLP/fingerprint/search-dependent perf conclusion.
const SYLLABLES = ['ka', 'ren', 'to', 'mi', 'lor', 've', 'shan', 'dre', 'pol', 'qua', 'zen', 'bri', 'sto', 'gal', 'nu', 'fen'];
const WORD_POOL = Array.from({length: 800}, (_, i) => {
	const a = SYLLABLES[i % SYLLABLES.length];
	const b = SYLLABLES[Math.floor(i / SYLLABLES.length) % SYLLABLES.length];
	const c = SYLLABLES[Math.floor(i / (SYLLABLES.length * SYLLABLES.length)) % SYLLABLES.length];
	return a + b + (i >= SYLLABLES.length * SYLLABLES.length ? c : '');
});

//Zipf-ish word sampling: squaring the roll skews toward low indices, giving
//a realistic frequent-head/long-tail IDF distribution.
const sampleWord = (rnd) => WORD_POOL[Math.floor(rnd() * rnd() * WORD_POOL.length)];

//Build a body of roughly `targetBytes` from sampled words in <p> sentences.
const makeBody = (rnd, targetBytes) => {
	let out = '';
	while (out.length < targetBytes) {
		const wordCount = intBetween(rnd, 8, 16);
		const words = [];
		for (let w = 0; w < wordCount; w++) words.push(sampleWord(rnd));
		out += '<p>' + words.join(' ') + '.</p>';
	}
	return out;
};

//Approximation of the app's stored search tokens (stemmed unigrams +
//bigrams over body+title words). The worker's inverted index consumes these
//verbatim (searchTokensForCard), so their presence/cardinality — not their
//linguistic fidelity — is what exercises the index path instead of the
//100%-full-scan fallback the review demonstrated.
const makeSearchTokens = (title, body) => {
	const words = (title + ' ' + body).toLowerCase().replace(/<[^>]+>/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
	const tokens = new Set();
	for (let i = 0; i < words.length; i++) {
		tokens.add(words[i]);
		if (i + 1 < words.length) tokens.add(words[i] + ' ' + words[i + 1]);
	}
	return [...tokens];
};

//ts spreads updated timestamps across ~2 years ending at `epochSeconds`, so
//sorts and the watermark have real ordering work.
const spreadTs = (rnd, epochSeconds) => {
	const twoYears = 2 * 365 * 24 * 3600;
	const seconds = epochSeconds - Math.floor(rnd() * twoYears);
	return {seconds, nanoseconds: Math.floor(rnd() * 1e9)};
};

//Options:
//  count       number of cards (default 40000)
//  seed        PRNG seed (default 1)
//  maxRefs     max forward references per card (default 12 — dense graph)
//  publishedP  probability a card is published (default 0.05 — the real
//              corpus is ~3% published; also keeps the published listener
//              under the emulator's pushed-message cap)
//  bodyBytes   approx body size in bytes (default 1500; some cards 8x for the tail)
//  epochSeconds fixed "now" for timestamp spread (default 1_700_000_000)
export const generateCorpus = (opts = {}) => {
	const count = opts.count ?? 40000;
	const seed = opts.seed ?? 1;
	const maxRefs = opts.maxRefs ?? 12;
	const publishedP = opts.publishedP ?? 0.05;
	const bodyBytes = opts.bodyBytes ?? 1500;
	const epochSeconds = opts.epochSeconds ?? 1_700_000_000;
	const rnd = mulberry32(seed);

	const ids = Array.from({length: count}, (_, i) => 'perf-card-' + i);
	const cards = {};

	for (let i = 0; i < count; i++) {
		const id = ids[i];
		//Fat tail: ~5% of cards get 8x the body (worst-case editor-open/render).
		const thisBodyBytes = rnd() < 0.05 ? bodyBytes * 8 : bodyBytes;
		//Forward references point only at EARLIER cards (acyclic, deterministic).
		const references = {};
		const referencesInfo = {};
		const refCount = i === 0 ? 0 : intBetween(rnd, 0, Math.min(maxRefs, i));
		const seen = new Set();
		for (let r = 0; r < refCount; r++) {
			const target = ids[Math.floor(rnd() * i)];
			if (seen.has(target)) continue;
			seen.add(target);
			references[target] = true;
			const refType = pick(rnd, REFERENCE_TYPES);
			referencesInfo[target] = {[refType]: ''};
		}
		const tagCount = intBetween(rnd, 0, 8);
		const tags = [];
		const tagSeen = new Set();
		for (let t = 0; t < tagCount; t++) {
			const tag = pick(rnd, TAG_POOL);
			if (!tagSeen.has(tag)) { tagSeen.add(tag); tags.push(tag); }
		}
		const ts = spreadTs(rnd, epochSeconds);
		const title = 'Perf card ' + i + ' ' + sampleWord(rnd) + ' ' + sampleWord(rnd);
		const body = makeBody(rnd, thisBodyBytes);
		cards[id] = {
			id,
			card_type: pickWeighted(rnd, CARD_TYPE_WEIGHTS),
			section: pick(rnd, SECTIONS),
			title,
			body,
			published: rnd() < publishedP,
			tags,
			references,
			references_info: referencesInfo,
			references_inbound: {},
			references_info_inbound: {},
			notes: rnd() < 0.3 ? 'a note' : '',
			todo: rnd() < 0.2 ? 'a todo' : '',
			star_count: intBetween(rnd, 0, 20),
			star_count_manual: 0,
			thread_count: intBetween(rnd, 0, 5),
			thread_resolved_count: 0,
			updated_message: ts,
			tweet_count: 0,
			last_tweeted: {seconds: 0, nanoseconds: 0},
			font_size_boost: {},
			auto_todo_overrides: {},
			created: ts,
			updated: ts,
			updated_substantive: ts,
			author: 'perf-author',
			//Rules inspect membership in permissions.editCard even on the admin
			//path; preserve the production card shape so write tests exercise the
			//intended allow branch rather than a missing-map evaluation error.
			permissions: {editCard: []},
			collaborators: [],
			slugs: [],
			name: id,
			images: [],
			//REQUIRED on Card: its absence made the default-set comparator
			//compute NaN for every pair (the review's C1) — the sort the
			//harness exercised was garbage ordering.
			sort_order: (count - i) * 1000 + rnd(),
			//Stored search tokens: what the worker's inverted index indexes.
			nlp_search_tokens: makeSearchTokens(title, body),
		};
		//Stamp currency so the worker's recall predicate trusts the tokens.
		cards[id].nlp_version = CURRENT_NLP_VERSION;
		cards[id].nlp_source_fingerprint = nlpSourceFingerprintForCard(cards[id]);
	}

	//Second pass: derive references_inbound / references_info_inbound so the
	//inbound-reference filters and corpus-sync inbound machinery see a
	//consistent graph.
	for (const id of ids) {
		const card = cards[id];
		for (const target of Object.keys(card.references)) {
			cards[target].references_inbound[id] = true;
			cards[target].references_info_inbound[id] = card.references_info[target];
		}
	}

	return cards;
};

//Rough stats for a generated corpus, so a run can log what it produced.
export const corpusStats = (cards) => {
	const ids = Object.keys(cards);
	let refs = 0, inbound = 0, tags = 0, published = 0, bodyBytes = 0;
	for (const id of ids) {
		const c = cards[id];
		refs += Object.keys(c.references).length;
		inbound += Object.keys(c.references_inbound).length;
		tags += c.tags.length;
		if (c.published) published++;
		bodyBytes += c.body.length;
	}
	const n = ids.length || 1;
	return {
		count: ids.length,
		published,
		avgRefs: +(refs / n).toFixed(2),
		avgInbound: +(inbound / n).toFixed(2),
		avgTags: +(tags / n).toFixed(2),
		avgBodyBytes: Math.round(bodyBytes / n),
		approxTotalMB: +((bodyBytes) / 1e6).toFixed(1),
	};
};

//CLI (guarded so importing this module for tests does not run it).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('gen-corpus.js');
if (invokedDirectly) {
	const args = process.argv.slice(2);
	const getArg = (name, dflt) => {
		const idx = args.indexOf('--' + name);
		return idx >= 0 && args[idx + 1] ? args[idx + 1] : dflt;
	};
	const count = parseInt(getArg('count', '40000'), 10);
	const seed = parseInt(getArg('seed', '1'), 10);
	const out = getArg('out', '');
	const cards = generateCorpus({count, seed});
	const stats = corpusStats(cards);
	//eslint-disable-next-line no-console
	console.error('[gen-corpus] ' + JSON.stringify(stats));
	if (args.includes('--stats')) process.exit(0);
	if (out) {
		fs.writeFileSync(out, JSON.stringify(cards));
		//eslint-disable-next-line no-console
		console.error('[gen-corpus] wrote ' + out);
	} else {
		process.stdout.write(JSON.stringify(cards));
	}
}
