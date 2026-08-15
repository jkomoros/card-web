/*eslint-env node*/

//Tests for the worker's incrementally-maintained visible-corpus IDF index
//(src/worker/idf-index.ts; docs/visible-corpus-idf-design.md): incremental
//equivalence against the calcIDFMapForCards ground truth, O(one card)
//deletes, reference-field vocabulary, the frozen-epoch publication policy,
//the df==1 trim, and the privacy property that a published-tier index never
//contains unpublished-only vocabulary. Plus the structural sweep pinning the
//DELETION of the old server-IDF subsystem.

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../lib/shared/document.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

import {
	IDFIndex,
	IDF_REPUBLISH_DRIFT_FRACTION
} from '../../lib/src/worker/idf-index.js';

import {
	calcIDFMapForCards,
	PENDING_IDF_MAP
} from '../../lib/src/nlp.js';

import {
	processCards
} from '../../lib/src/card-processing.js';

import {
	QueryEngine
} from '../../lib/src/worker/query-engine.js';

import {
	MAX_N_GRAM_FOR_FINGERPRINT
} from '../../lib/shared/nlp.js';

const card = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	tags: [],
	sort_order: 1.0,
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	star_count: 0,
	thread_count: 0,
	notes: '',
	todo: '',
	auto_todo_overrides: {},
	published: true,
	full_bleed: false,
	images: [],
	...extras,
});

//Builds an index the way the worker's sliced initial build does: one
//updateCard per corpus entry.
const buildIndex = (cards) => {
	const index = new IDFIndex();
	for (const [id, cardObj] of Object.entries(cards)) index.updateCard(id, cardObj, cards);
	return index;
};

//The main-thread ground truth: the exact function the off-mode path uses.
const groundTruth = (cards) => calcIDFMapForCards(processCards(cards), MAX_N_GRAM_FOR_FINGERPRINT);

describe('IDFIndex incremental equivalence', () => {

	const baseCorpus = () => ({
		a: card('a', {title: 'Seed crystals crystalize gradients', body: '<p>Complexity is a key concept to understand gradients.</p>'}),
		b: card('b', {title: 'Hill climbing strategies', body: '<p>Climbing hills is hard and full of gradients.</p>'}),
		c: card('c', {title: 'Municipal budget planning', body: '<p>Budgets are compounding schelling points.</p>'}),
		d: card('d', {title: 'Zebra migration patterns', body: '<p>Zebras migrate to find complexity.</p>'}),
	});

	it('matches calcIDFMapForCards ground truth after a scripted add/edit/delete sequence', () => {
		const corpus = baseCorpus();
		const index = buildIndex(corpus);
		assert.deepStrictEqual(index.materializedMap(false), groundTruth(corpus));
		assert.strictEqual(index.bodyCardCount, 4);

		//ADD a card.
		corpus.e = card('e', {title: 'Xylophone repair techniques', body: '<p>Repairing xylophones takes patience.</p>'});
		index.updateCard('e', corpus.e, corpus);
		assert.deepStrictEqual(index.materializedMap(false), groundTruth(corpus));

		//EDIT a card (fresh object, like every real corpus mutation).
		corpus.b = card('b', {title: 'Valley descending strategies', body: '<p>Descending valleys is easy.</p>'});
		index.updateCard('b', corpus.b, corpus);
		assert.deepStrictEqual(index.materializedMap(false), groundTruth(corpus));

		//DELETE a card.
		delete corpus.c;
		index.updateCard('c', null, corpus);
		assert.deepStrictEqual(index.materializedMap(false), groundTruth(corpus));

		//A NON-BODY card contributes nothing (body cards only, matching the
		//ground truth's own filter).
		corpus.s = card('s', {card_type: 'section-head', title: 'A section head', body: ''});
		index.updateCard('s', corpus.s, corpus);
		assert.deepStrictEqual(index.materializedMap(false), groundTruth(corpus));
		assert.strictEqual(index.bodyCardCount, 4);
	});

	it('a delete is O(one card): one term extraction, never a rebuild', () => {
		const corpus = baseCorpus();
		const index = buildIndex(corpus);
		const extractionsBefore = index.termExtractionCount;
		delete corpus.c;
		index.updateCard('c', null, corpus);
		//The spy: exactly ONE term-set derivation (the deleted card's
		//decrement) — a full rebuild would re-derive every card.
		assert.strictEqual(index.termExtractionCount, extractionsBefore + 1);
		assert.deepStrictEqual(index.materializedMap(false), groundTruth(corpus));
		//An edit is exactly two: decrement the old object, increment the new.
		const beforeEdit = index.termExtractionCount;
		corpus.a = card('a', {title: 'Fresh title entirely', body: '<p>Fresh body entirely.</p>'});
		index.updateCard('a', corpus.a, corpus);
		assert.strictEqual(index.termExtractionCount, beforeEdit + 2);
	});

	it('an idempotent re-apply of the same card object is free', () => {
		const corpus = baseCorpus();
		const index = buildIndex(corpus);
		const before = index.termExtractionCount;
		const version = index.version;
		//The sliced build and the incremental hook can both see the same
		//object (mid-build interleavings); the second sighting must no-op.
		index.updateCard('a', corpus.a, corpus);
		assert.strictEqual(index.termExtractionCount, before);
		assert.strictEqual(index.version, version);
	});

	it('terms at zero are removed outright', () => {
		const corpus = {only: card('only', {title: 'Singular xylotheque holdings', body: '<p>One card only.</p>'})};
		const index = buildIndex(corpus);
		assert.ok(index.bodyCardCount === 1);
		index.updateCard('only', null, {});
		assert.strictEqual(index.bodyCardCount, 0);
		assert.deepStrictEqual(index.materializedMap(false), {idf: {}, maxIDF: 0});
	});

	it('reference-field vocabulary is present in the map (the maxIDF-skew fix)', () => {
		//An inbound-reference text run reaches the card's vocabulary via the
		//references_info_inbound processed field — the overrideExtractor-style
		//fields the old server map skipped entirely.
		const corpus = baseCorpus();
		corpus.a = card('a', {
			title: 'Seed crystals crystalize gradients',
			references_info_inbound: {b: {link: 'xylotheque zibeline'}},
		});
		const index = buildIndex(corpus);
		const map = index.materializedMap(false);
		assert.ok(Object.keys(map.idf).some(term => term.includes('xylothequ')),
			`reference vocabulary missing from the map: ${Object.keys(map.idf).filter(t => t.startsWith('x')).join(', ') || '(no x terms)'}`);
		//And the ground truth agrees, because both sides run the same
		//tokenization over the same processed card.
		assert.deepStrictEqual(map, groundTruth(corpus));
	});
});

describe('IDFIndex epoch policy', () => {

	const biggerCorpus = (count) => {
		const cards = {};
		for (let i = 0; i < count; i++) {
			const id = 'card' + i;
			cards[id] = card(id, {title: `Topic ${i} alpha beta`, body: `<p>Common words plus unique${i} vocabulary.</p>`});
		}
		return cards;
	};

	it('the published map is frozen: identity stable across sub-threshold updates', () => {
		const corpus = biggerCorpus(20);
		const index = buildIndex(corpus);
		const published = index.publish();
		assert.strictEqual(index.publishedMap, published);
		assert.strictEqual(index.epoch, 1);
		//One edit: docFreq changes, published map does NOT.
		corpus.card3 = card('card3', {title: 'A completely different topic', body: '<p>New words here.</p>'});
		index.updateCard('card3', corpus.card3, corpus);
		assert.strictEqual(index.publishedMap, published);
		assert.strictEqual(index.cardCountDriftExceeded(), false);
		//One add (5% of 20): still under the 10% drift threshold.
		corpus.extra1 = card('extra1', {title: 'Extra topic one'});
		index.updateCard('extra1', corpus.extra1, corpus);
		assert.strictEqual(index.cardCountDriftExceeded(), false);
		assert.strictEqual(index.publishedMap, published);
	});

	it('rolls at >10% cardCount drift, in either direction', () => {
		const corpus = biggerCorpus(20);
		const index = buildIndex(corpus);
		index.publish();
		//Add three more body cards: 15% > threshold.
		for (let i = 0; i < 3; i++) {
			const id = 'grow' + i;
			corpus[id] = card(id, {title: `Grown topic ${i}`});
			index.updateCard(id, corpus[id], corpus);
		}
		assert.strictEqual(index.cardCountDriftExceeded(), true);
		const before = index.publishedMap;
		const published = index.publish();
		assert.strictEqual(index.epoch, 2);
		assert.notStrictEqual(published, before);
		assert.strictEqual(index.cardCountDriftExceeded(), false);
		//Mass delete: drift in the shrinking direction rolls too (the old
		//count-based memo only noticed growth).
		for (const id of ['grow0', 'grow1', 'grow2', 'card0', 'card1', 'card2']) {
			delete corpus[id];
			index.updateCard(id, null, corpus);
		}
		assert.strictEqual(index.cardCountDriftExceeded(), true);
	});

	it('exposes the drift threshold the tests assert against', () => {
		assert.strictEqual(IDF_REPUBLISH_DRIFT_FRACTION, 0.1);
	});

	it('trims df==1 terms from the published map only, with maxIDF computed pre-trim', () => {
		const corpus = {
			a: card('a', {title: 'shared vocabulary xylotheque', body: ''}),
			b: card('b', {title: 'shared vocabulary again', body: ''}),
			c: card('c', {title: 'shared vocabulary thrice', body: ''}),
		};
		const index = buildIndex(corpus);
		const untrimmed = index.materializedMap(false);
		const published = index.publish();
		//'xylotheque' appears on exactly one card: present untrimmed, absent
		//from the shipped map.
		const singleton = Object.keys(untrimmed.idf).find(term => term.includes('xylothequ'));
		assert.ok(singleton, 'expected a singleton term');
		assert.ok(!(singleton in published.idf), 'df==1 term must be trimmed from the published map');
		//Shared terms (df==3) survive.
		const shared = Object.keys(untrimmed.idf).find(term => term.includes('vocabulari') || term.includes('vocabulary'));
		assert.ok(shared, 'expected a shared term');
		assert.ok(shared in published.idf, 'df>1 terms must survive the trim');
		//maxIDF is the UNTRIMMED maximum, so trimmed singletons still score
		//exactly their true idf via the absent-term maxIDF fallback.
		assert.strictEqual(published.maxIDF, untrimmed.maxIDF);
		assert.strictEqual(published.maxIDF, untrimmed.idf[singleton]);
	});

	it('reset drops the published map; resetCounts keeps it for consumers mid-rebuild', () => {
		const corpus = {a: card('a'), b: card('b')};
		const index = buildIndex(corpus);
		const published = index.publish();
		index.resetCounts();
		assert.strictEqual(index.bodyCardCount, 0);
		assert.strictEqual(index.publishedMap, published);
		index.reset();
		assert.strictEqual(index.publishedMap, null);
	});

	it('the query engine consumes the exact published epoch identity (worker and main agree per epoch)', () => {
		const engine = new QueryEngine();
		engine.updateCards({z1: card('z1', {title: 'Zebra migration patterns'})}, []);
		//Pre-publication: the pending-map convention — never a synchronous
		//local whole-corpus build.
		assert.strictEqual(engine._ensureSuggestGenerator()._idfMap, PENDING_IDF_MAP);
		const index = buildIndex({z1: engine.rawCards.z1});
		const published = index.publish();
		engine.setIDFMap(published);
		//The engine's generator scores with the SAME frozen object the main
		//thread receives, so suggestTags (worker) and word clouds (main)
		//agree within an epoch.
		assert.strictEqual(engine._ensureSuggestGenerator()._idfMap, published);
	});
});

describe('IDF privacy (structural)', () => {

	it('a published-tier index never contains unpublished-only vocabulary', () => {
		//The reader worker's corpus contains only published cards BY
		//CONSTRUCTION (its listeners are published-only); the index inherits
		//that scope rather than implementing one. Model it: the full corpus
		//has an unpublished card with a distinctive term; the reader-tier
		//index is built over the published subset.
		const fullCorpus = {
			pub1: card('pub1', {title: 'Common knowledge topics'}),
			pub2: card('pub2', {title: 'More common knowledge'}),
			secret: card('secret', {published: false, title: 'Unreleased flumphgristle research', body: '<p>Secret flumphgristle notes.</p>'}),
		};
		const publishedCorpus = Object.fromEntries(Object.entries(fullCorpus).filter(([, c]) => c.published));
		const readerIndex = buildIndex(publishedCorpus);
		const publishedMap = readerIndex.publish();
		const untrimmed = readerIndex.materializedMap(false);
		for (const map of [publishedMap.idf, untrimmed.idf]) {
			assert.ok(!Object.keys(map).some(term => term.includes('flumphgristl')),
				'unpublished-only vocabulary leaked into a published-tier map');
		}
		//Sanity: a privileged index over the full corpus DOES include it (the
		//richer-rarity wrinkle the design accepts).
		const privilegedIndex = buildIndex(fullCorpus);
		assert.ok(Object.keys(privilegedIndex.materializedMap(false).idf).some(term => term.includes('flumphgristl')));
	});
});

describe('server-IDF subsystem deletion (structural)', () => {

	const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

	const walk = (dir) => {
		const results = [];
		for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) results.push(...walk(full));
			else results.push(full);
		}
		return results;
	};

	it('no src file references the deleted server-IDF machinery', () => {
		const files = walk(path.join(repoRoot, 'src')).filter(file => file.endsWith('.ts'));
		assert.ok(files.length > 100, 'sanity: the sweep should see the whole src tree');
		const forbidden = ['idf-maps', 'ServerIDFData', 'loadServerIDFMap', 'UPDATE_SERVER_IDF'];
		for (const file of files) {
			const content = fs.readFileSync(file, 'utf8');
			for (const needle of forbidden) {
				assert.ok(!content.includes(needle),
					`${path.relative(repoRoot, file)} still references '${needle}'`);
			}
			//'server_idf_cache' is allowed ONLY at the one-time cleanup site.
			if (content.includes('server_idf_cache')) {
				assert.strictEqual(path.basename(file), 'corpus-bridge.ts',
					`${path.relative(repoRoot, file)} references server_idf_cache outside the cleanup site`);
				assert.ok(content.includes('removeItem(\'server_idf_cache\')'),
					'the only permitted server_idf_cache reference is the removeItem cleanup');
			}
		}
	});

	it('the one-time localStorage cleanup exists', () => {
		const bridge = fs.readFileSync(path.join(repoRoot, 'src', 'corpus-bridge.ts'), 'utf8');
		assert.ok(bridge.includes('removeItem(\'server_idf_cache\')'),
			'corpus-bridge must remove the legacy 1.6MB localStorage entry at boot');
	});

	it('the deleted files stay deleted', () => {
		assert.ok(!fs.existsSync(path.join(repoRoot, 'src', 'idf-cache.ts')), 'src/idf-cache.ts must stay deleted');
		assert.ok(!fs.existsSync(path.join(repoRoot, 'functions', 'src', 'idf.ts')), 'functions/src/idf.ts must stay deleted');
	});

	it('storage.rules no longer exposes the public idf-maps surface', () => {
		const rules = fs.readFileSync(path.join(repoRoot, 'storage.rules'), 'utf8');
		assert.ok(!rules.includes('idf-maps'), 'the public-read idf-maps rule must stay deleted');
	});

	it('functions/src no longer defines calculateIDF (deploy list omission does not undeploy)', () => {
		const files = walk(path.join(repoRoot, 'functions', 'src')).filter(file => file.endsWith('.ts'));
		for (const file of files) {
			assert.ok(!fs.readFileSync(file, 'utf8').includes('calculateIDF'),
				`${path.relative(repoRoot, file)} still references calculateIDF`);
		}
		//The deploy tool must instead carry the operational note: the live
		//function must be deleted explicitly, on both projects.
		const deploy = fs.readFileSync(path.join(repoRoot, 'tools', 'deploy-firebase.ts'), 'utf8');
		assert.ok(deploy.includes('functions:delete calculateIDF'),
			'tools/deploy-firebase.ts must document the explicit functions:delete step');
	});
});
