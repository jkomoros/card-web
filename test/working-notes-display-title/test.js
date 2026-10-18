/*eslint-env node, es2022*/

//The working-notes display title (slice 5 §5.2): a viewer-side projection
//that replaces the finisher which used to write the same dated summary
//into the shared title field. Parity is asserted against a verbatim copy
//of that finisher (git show 8f56ea89:src/card_finishers.ts), run over the
//same state, so the only difference is where the string lives.

import {JSDOM} from 'jsdom';
import {overrideDocument} from '../../lib/shared/document.js';
const dom = new JSDOM('', {url: 'http://localhost/'});
overrideDocument(dom.window.document);
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

import assert from 'assert';
import {readFileSync, readdirSync, statSync} from 'fs';
import path from 'path';

const {BASE_DATA} = await import('../fingerprint/data.js');
const {cardWithNormalizedTextProperties, FingerprintGenerator} = await import('../../lib/src/nlp.js');
const {backportFallbackTextMapForCard} = await import('../../lib/src/util.js');
const {selectCards, selectConcepts, selectSynonymMap, getSemanticFingerprintForCard} = await import('../../lib/src/selectors.js');
const {
	displayTitle, displayTitleBudgeted, displayTitleWithMeta, beginDisplayTitleBudget, generatedWorkingNotesTitle, graphNodeName,
	selectDisplayTitleInputs, subscribeDisplayTitles, pendingDisplayTitleCount, displayTitleDateLabel, displayTitleKey, legacyDisplayTitleKey, restoredDisplayTitleKey,
} = await import('../../lib/src/working-notes-display-title.js');

const NOTE_BODY = '<p>Hill climbing is totally a thing.</p><p>There is not one truth</p><p>(just as there is not one cause, or one solution)</p><p>Truth is a mindset, a process. Seeking disconfirming evidence, incorporating it into an ever-more nuanced model. Ground-truthing even when it\'s inconvenient.</p><p>Things can be more or less true, it\'s that there\'s a <em>spectrum</em>.</p><p>Truth is an asymptotic ideal, what matters is motion towards the goal, not ever landing at it.</p>';
const stamp = (seconds) => ({seconds, nanoseconds: 0, toMillis() { return seconds * 1000; }});
//Mid-day UTC, so the local-timezone date label is the same day everywhere.
const NOTE_SECONDS = 1_604_500_000;
const NOTE_DATE = new Date(NOTE_SECONDS * 1000).toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'});
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const baseCard = (id, extras = {}) => ({
	id, card_type: 'content', title: '', body: '', section: 'main', tags: [], references: {}, references_info: {}, references_inbound: {}, references_info_inbound: {},
	star_count: 0, thread_count: 0, notes: '', todo: '', auto_todo_overrides: {}, published: true, full_bleed: false, images: [], slugs: [],
	created: stamp(1_600_000_000), updated: stamp(1_700_000_000), updated_substantive: stamp(NOTE_SECONDS), ...extras,
});
const corpus = () => {
	const cards = Object.fromEntries(Object.entries(BASE_DATA).map(([id, data]) => [id, baseCard(id, data)]));
	cards.note = baseCard('note', {card_type: 'working-notes', body: NOTE_BODY, published: false});
	return cards;
};
const stateFor = (cards, workerIDF = null) => ({data: {cards, workerIDF, sections: {}, tags: {}}});

//master@8f56ea89 src/card_finishers.ts workingNotesExtractor, with the one
//deliberate difference: the date source (Q1: updated_substantive, not
//updated, which every inbound-link write and the cutover bump).
const legacyExtractor = (card, state) => {
	const fallbackMap = backportFallbackTextMapForCard(card, selectCards(state));
	const cardCopy = cardWithNormalizedTextProperties(card, fallbackMap || {}, selectConcepts(state), selectSynonymMap(state));
	const fingerprint = getSemanticFingerprintForCard(state, cardCopy, ['body']);
	const pretty = fingerprint.dedupedPrettyItemsFromCard();
	return displayTitleDateLabel(card) + ' ' + pretty.split(' ').slice(0, 8).join(' ');
};

describe('working-notes display title', () => {
	//With no worker map the selector hands out the pending sentinel (a
	//jsdom window reads as worker mode), i.e. TF-only ranking until the
	//first epoch — a real boot state — and then a real injected map.
	it('matches the finisher it replaced, before the first IDF epoch and with an injected IDF map', () => {
		//An injected map, as the worker would publish one: built over the
		//same corpus by a generator so it has the real shape.
		const injected = new FingerprintGenerator(Object.fromEntries(Object.entries(corpus()).map(([id, card]) => [id, cardWithNormalizedTextProperties(card, {}, {}, {})])))._idfMap;
		for (const workerIDF of [null, {idf: injected.idf, maxIDF: injected.maxIDF}]) {
			const cards = corpus();
			const state = stateFor(cards, workerIDF);
			const expected = legacyExtractor(cards.note, state);
			const actual = displayTitle(selectCards(state).note, selectDisplayTitleInputs(state));
			assert.strictEqual(actual, expected, `workerIDF ${workerIDF ? 'injected' : 'pending'}`);
			assert.match(actual, new RegExp(`^${escapeRegExp(NOTE_DATE)} \\S+( \\S+){1,7}$`), actual);
			assert.ok(/truth/i.test(actual), 'the body\'s dominant term is in the title');
		}
	});

	it('an authored title wins; other card types have no display title; the date falls back to created', () => {
		const cards = corpus();
		cards.note.title = 'Mine';
		cards.plain = baseCard('plain', {body: '<p>a body</p>'});
		cards.undated = baseCard('undated', {card_type: 'working-notes', body: '<p>x</p>', updated_substantive: undefined, created: stamp(1_577_880_000)});
		const state = stateFor(cards);
		const processed = selectCards(state);
		const inputs = selectDisplayTitleInputs(state);
		assert.strictEqual(displayTitle(processed.note, inputs), 'Mine');
		assert.strictEqual(displayTitle(processed.plain, inputs), '');
		assert.ok(displayTitle(processed.undated, inputs).startsWith(new Date(1_577_880_000 * 1000).toLocaleDateString('en-US', {month: 'numeric', day: 'numeric', year: '2-digit'})));
	});

	it('memoizes on the card object: an unrelated save or an inputs change recomputes nothing; a new image does', () => {
		const cards = corpus();
		const state = stateFor(cards);
		const inputs = selectDisplayTitleInputs(state);
		const original = FingerprintGenerator.prototype.fingerprintForCardObj;
		let computed = 0;
		FingerprintGenerator.prototype.fingerprintForCardObj = function(...args) { computed++; return original.apply(this, args); };
		try {
			const processed = selectCards(state);
			const first = displayTitle(processed.note, inputs);
			assert.strictEqual(computed, 1);
			assert.strictEqual(displayTitle(processed.note, inputs), first);
			assert.strictEqual(computed, 1, 'a hit computes nothing');
			//Another card changes: the note keeps its identity through an
			//incremental update, and its title is still a hit.
			const next = stateFor({...cards, '02af83': {...cards['02af83'], title: 'renamed'}});
			assert.strictEqual(selectCards(next).note, processed.note, 'unchanged card keeps its processed identity');
			displayTitle(selectCards(next).note, selectDisplayTitleInputs(next));
			assert.strictEqual(computed, 1, 'an unrelated save is still a hit');
			//A new image of the note recomputes.
			const edited = stateFor({...cards, note: {...cards.note, body: NOTE_BODY + '<p>more</p>'}});
			displayTitle(selectCards(edited).note, selectDisplayTitleInputs(edited));
			assert.strictEqual(computed, 2);
			//New inputs (an IDF epoch, a concept edit) do NOT recompute: a
			//title is frozen to the card object, as the owner asked (titles
			//change very rarely; stale is fine). Only a new image does.
			const epoch = stateFor(cards, {idf: {truth: 3}, maxIDF: 3});
			assert.strictEqual(displayTitle(selectCards(epoch).note, selectDisplayTitleInputs(epoch)), first);
			assert.strictEqual(computed, 2, 'an inputs change is a hit');
		} finally {
			FingerprintGenerator.prototype.fingerprintForCardObj = original;
		}
	});

	it('accepts a frozen card and never writes to it', () => {
		const cards = corpus();
		const state = stateFor(cards);
		const processed = selectCards(state).note;
		Object.freeze(processed);
		const before = JSON.stringify(processed);
		const title = displayTitle(processed, selectDisplayTitleInputs(state));
		assert.ok(title.length > 9);
		assert.strictEqual(JSON.stringify(processed), before);
		assert.strictEqual(processed.title, '');
	});

	it('past the render budget returns the date alone, then fills in an idle slice and notifies', async () => {
		const cards = corpus();
		for (let index = 0; index < 6; index++) cards['n' + index] = baseCard('n' + index, {card_type: 'working-notes', body: NOTE_BODY + `<p>variant ${index}</p>`, published: false});
		const state = stateFor(cards);
		const processed = selectCards(state);
		const inputs = selectDisplayTitleInputs(state);
		let notified = 0;
		const unsubscribe = subscribeDisplayTitles(() => { notified++; });
		//A budget that is already spent: everything queues.
		beginDisplayTitleBudget(performance.now() - 1000);
		const placeholders = ['n0', 'n1', 'n2'].map(id => displayTitleBudgeted(processed[id], inputs));
		for (const placeholder of placeholders) assert.strictEqual(placeholder, NOTE_DATE, 'the placeholder is the date alone');
		assert.strictEqual(pendingDisplayTitleCount(), 3);
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.strictEqual(pendingDisplayTitleCount(), 0);
		assert.ok(notified >= 1, 'subscribers were told to re-render');
		for (const id of ['n0', 'n1', 'n2']) assert.match(displayTitleBudgeted(processed[id], inputs), new RegExp(`^${escapeRegExp(NOTE_DATE)} \\S+`), 'filled in after the slice');
		//Within budget, misses are computed synchronously.
		beginDisplayTitleBudget();
		assert.match(displayTitleBudgeted(processed.n3, inputs), new RegExp(`^${escapeRegExp(NOTE_DATE)} \\S+`));
		assert.strictEqual(pendingDisplayTitleCount(), 0);
		unsubscribe();
	});

	it('is a projection: the kernel reads only the card and the inputs', () => {
		const cards = corpus();
		const state = stateFor(cards);
		const inputs = selectDisplayTitleInputs(state);
		const processed = selectCards(state).note;
		assert.strictEqual(generatedWorkingNotesTitle(processed, inputs), displayTitle(processed, inputs));
	});

	it('is never imported by a write path, the worker, or the server', () => {
		//Source pin: the one guarantee that makes this a PROJECTION. Anything
		//that builds a card to save, replays a queue, or runs in the worker or
		//on the server must not be able to reach a generated title.
		const root = path.resolve('src');
		const forbidden = ['src/actions', 'src/worker', 'src/card_diff.ts', 'src/multi_batch.ts', 'src/aux-write-queue.ts', 'src/edit-draft.ts', 'src/edit-recovery.ts', 'functions/src', 'shared'];
		const offenders = [];
		const walk = dir => {
			for (const entry of readdirSync(dir)) {
				const full = path.join(dir, entry);
				if (statSync(full).isDirectory()) { walk(full); continue; }
				if (!/\.(ts|js|mjs|cjs)$/.test(entry)) continue;
				//Imports only: comments may name the module.
				if (!/(from\s*['"][^'"]*working-notes-display-title|import\(\s*['"][^'"]*working-notes-display-title)/.test(readFileSync(full, 'utf8'))) continue;
				const relative = path.relative(path.resolve('.'), full);
				if (relative.startsWith('src/working-notes-display-title')) continue;
				if (forbidden.some(prefix => relative === prefix || relative.startsWith(prefix + '/') || relative.startsWith(prefix.replace(/\.ts$/, '')))) offenders.push(relative);
			}
		};
		walk(root);
		for (const dir of ['functions/src', 'shared']) walk(path.resolve(dir));
		assert.deepStrictEqual(offenders, [], 'a write path, the worker or the server imports the display-title projection');
	});
});

//§5.3 privacy: the projection is computed from the VIEWER's inputs. The
//fingerprint is over the body alone, so a title holds only the note's own
//words (T4) — what leaked through the finisher was the RANKING: which of
//the note's words made the cut was decided by the viewer's IDF over the
//viewer's corpus, unpublished cards included, and that choice was written
//into the shared field for everyone. Two viewers with different corpora
//must get their own titles, and one viewer's must not be reshaped by the
//other's having computed first.
describe('working-notes display title privacy', () => {
	//More than eight candidate words, each used once, so the cut is decided
	//by IDF alone.
	const NOTE = '<p>Truth seeking, mindset, process, evidence, nuance, growth, asymptote, motion, landing, spectrum, discovery, context, development.</p>';
	//Viewer A also holds forty unpublished cards that use the note's
	//dominant term in every sentence, so for A it is common and ranks low.
	const fixture = (viewer) => {
		const cards = corpus();
		cards.w = baseCard('w', {card_type: 'working-notes', published: true, body: NOTE});
		if (viewer === 'A') {
			for (let index = 0; index < 40; index++) cards['private' + index] = baseCard('private' + index, {published: false, body: `<p>Truth, seeking, mindset, process, evidence and nuance, private note ${index}.</p>`});
		}
		return cards;
	};
	//Each viewer's IDF map is built over that viewer's own corpus, as the
	//worker builds its per-epoch map over the visible corpus.
	const titleFor = (viewer) => {
		const cards = fixture(viewer);
		const idf = new FingerprintGenerator(Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, cardWithNormalizedTextProperties(card, {}, {}, {})])))._idfMap;
		const state = stateFor(cards, {idf: idf.idf, maxIDF: idf.maxIDF});
		return displayTitle(selectCards(state).w, selectDisplayTitleInputs(state));
	};

	it('two viewers with different corpora get different titles for the same note (the non-vacuity check)', () => {
		const a = titleFor('A');
		const b = titleFor('B');
		assert.notStrictEqual(a, b, `A: ${a} / B: ${b}`);
		//The six words A's private corpus saturates are common for A and
		//fall out of A's eight; B, who sees nothing unusual, keeps some.
		const saturated = /truth|seeking|mindset|process|evidence|nuance/gi;
		const count = title => (title.match(saturated) || []).length;
		assert.ok(count(b) >= 3, `B keeps the saturated terms: ${b}`);
		assert.ok(count(a) <= count(b) - 3, `A's private corpus demotes them: ${a}`);
	});

	it('a viewer\'s title is computed from that viewer\'s inputs alone, whoever computed first', () => {
		const before = titleFor('B');
		titleFor('A');
		const after = titleFor('B');
		assert.strictEqual(after, before, 'no module-level state crosses viewers');
		assert.strictEqual(titleFor('A'), titleFor('A'));
	});
});

//The consumers. Both of these were missed by the first build because no
//test drove them: card-link showed '' whenever the compact meta was absent
//(the warm-boot prime sends none), and the chip branch was unreachable
//because the tag-info selector fell back to the card's name.
describe('working-notes display title consumers', () => {
	it('selectTagInfosForCards keeps an untitled note\'s title empty rather than its name', async () => {
		const {selectTagInfosForCards} = await import('../../lib/src/selectors.js');
		const cards = corpus();
		cards.note.name = 'note';
		cards.plain = baseCard('plain', {name: 'plain-name', body: '<p>x</p>'});
		const infos = selectTagInfosForCards(stateFor(cards));
		assert.strictEqual(infos.note.title, '', 'no id-shaped name stands in for an untitled note');
		assert.strictEqual(infos.plain.title, 'plain-name', 'other types still fall back to their name');
		assert.strictEqual(infos.note.previewCard, 'note');
	});

	it('card-link shows the display title with and without a compact meta', async () => {
		await import('../../lib/src/components/card-link.js');
		const cards = corpus();
		const state = stateFor(cards);
		const processed = selectCards(state);
		const inputs = selectDisplayTitleInputs(state);
		const expected = displayTitle(processed.note, inputs);
		const link = document.createElement('card-link');
		link.auto = 'title';
		link.card = 'note';
		link._cards = processed;
		link._displayTitleInputs = inputs;
		link._cardMetas = {note: {id: 'note', title: '', card_type: 'working-notes', published: false}};
		assert.strictEqual(link._autoValue, expected, 'with a meta');
		link._cardMetas = {};
		assert.strictEqual(link._autoValue, expected, 'without a meta (warm-boot prime, off mode)');
		link._cardMetas = {note: {id: 'note', title: 'Authored', card_type: 'working-notes', published: false}};
		assert.strictEqual(link._autoValue, 'Authored');
		link._cardMetas = {note: {id: 'note', title: '', card_type: 'working-notes', published: false, displayTitle: '11/4/20 Worker Title'}};
		assert.strictEqual(link._autoValue, '11/4/20 Worker Title', 'the worker\'s frozen title wins');
	});

	it('the budgeted title is frozen across an inputs change, and a meta title wins over both', async () => {
		const cards = corpus();
		cards.s = baseCard('s', {card_type: 'working-notes', body: NOTE_BODY + '<p>frozen</p>', published: false});
		const stateA = stateFor(cards);
		const card = selectCards(stateA).s;
		const inputsA = selectDisplayTitleInputs(stateA);
		beginDisplayTitleBudget();
		const first = displayTitleBudgeted(card, inputsA);
		assert.match(first, new RegExp(`^${escapeRegExp(NOTE_DATE)} \\S+`));
		const stateB = stateFor(cards, {idf: {frozen: 7}, maxIDF: 7});
		const inputsB = selectDisplayTitleInputs(stateB);
		beginDisplayTitleBudget(performance.now() - 1000);
		assert.strictEqual(displayTitleBudgeted(card, inputsB), first, 'no recompute, no placeholder, no queue');
		assert.strictEqual(pendingDisplayTitleCount(), 0);
		//The worker's frozen title on the compact meta is preferred to the
		//main-thread fallback — and needs no computation at all.
		const metas = {s: {id: 's', title: '', card_type: 'working-notes', displayTitle: '11/4/20 From The Worker'}};
		assert.strictEqual(displayTitleBudgeted(card, inputsB, metas), '11/4/20 From The Worker');
		assert.strictEqual(displayTitleWithMeta(card, metas, inputsB), '11/4/20 From The Worker');
		assert.strictEqual(displayTitleWithMeta({...card, title: 'Authored'}, metas, inputsB), 'Authored', 'an authored title still wins');
		//The web view labels its nodes the way the list does, and a card with
		//neither title keeps the id label the Collection gave it.
		assert.strictEqual(graphNodeName(card, metas, inputsB), '11/4/20 From The Worker');
		assert.strictEqual(graphNodeName({...card, title: 'Authored'}, metas, inputsB), 'Authored');
		assert.strictEqual(graphNodeName({...card, card_type: 'content', title: ''}, metas, inputsB), 's', 'no title at all falls back to the id');
		//A card never computed and without a meta title shows the date.
		cards.fresh = baseCard('fresh', {card_type: 'working-notes', body: '<p>never seen</p>', published: false});
		const stateC = stateFor(cards);
		beginDisplayTitleBudget(performance.now() - 1000);
		assert.strictEqual(displayTitleBudgeted(selectCards(stateC).fresh, selectDisplayTitleInputs(stateC), {}), NOTE_DATE);
		//Let its slice drain so the queue is empty for the next test.
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.strictEqual(pendingDisplayTitleCount(), 0);
	});

	it('an idle-slice drain does not evict a title computed since the card was queued', async () => {
		const cards = corpus();
		cards.q = baseCard('q', {card_type: 'working-notes', body: NOTE_BODY + '<p>queued</p>', published: false});
		const stateA = stateFor(cards);
		const stateB = stateFor(cards, {idf: {queued: 5}, maxIDF: 5});
		const card = selectCards(stateA).q;
		const inputsA = selectDisplayTitleInputs(stateA);
		const inputsB = selectDisplayTitleInputs(stateB);
		beginDisplayTitleBudget(performance.now() - 1000);
		displayTitleBudgeted(card, inputsA);
		assert.strictEqual(pendingDisplayTitleCount(), 1);
		//Computed under newer inputs before the slice runs.
		const under = displayTitle(card, inputsB);
		await new Promise(resolve => setTimeout(resolve, 30));
		assert.strictEqual(pendingDisplayTitleCount(), 0);
		beginDisplayTitleBudget(performance.now() - 1000);
		assert.strictEqual(displayTitleBudgeted(card, inputsB), under, 'the newer entry survived the drain');
	});
});


//The worker side: the engine computes the same title the main-thread kernel
//does over the same inputs; the compact meta carries it and compares it;
//the snapshot record validates it.
describe('worker-side display titles', () => {
	it('the engine\'s generatedDisplayTitle equals the main-thread kernel over the same corpus', async () => {
		const {QueryEngine} = await import('../../lib/src/worker/query-engine.js');
		const cards = corpus();
		const engine = new QueryEngine();
		engine.updateCards(cards, []);
		const state = stateFor(cards);
		//Both sides before the first IDF epoch: the pending sentinel.
		assert.strictEqual(engine.generatedDisplayTitle('note'), displayTitle(selectCards(state).note, selectDisplayTitleInputs(state)));
		assert.strictEqual(engine.generatedDisplayTitle('02af83'), null, 'not a working-notes card');
		//A new image is a new object (the engine's processed-card cache is
		//keyed on identity, as everywhere else).
		engine.updateCards({note: {...cards.note, title: 'Mine'}}, []);
		assert.strictEqual(engine.generatedDisplayTitle('note'), null, 'an authored title needs no projection');
	});

	it('the worker warms titles AFTER the tag build and BEFORE similarity, and persists them (source pin)', () => {
		//The worker body has no unit harness. The J6 re-measure found the
		//title pass running concurrently with the fingerprint warm-up, which
		//pushed the tag build past the first editor open (a 2.5s synchronous
		//worker task) and nothing persisted the warmed titles, so the next
		//boot recomputed all ~38k of them. Pin the order and the save.
		//Comments stripped first: a pin that matched a `//TODO call()` would
		//pass with the call gone (the review's mutant M4).
		const source = readFileSync(path.resolve('src/worker/corpus-worker.ts'), 'utf8').replace(/\/\/[^\n]*/g, '');
		const warmup = source.indexOf('const scheduleFingerprintWarmup = ');
		assert.ok(warmup > 0);
		const body = source.slice(warmup, source.indexOf('const scheduleIDFBuild', warmup));
		const tags = body.indexOf('await engine.warmTagFingerprints(');
		const similar = body.indexOf('await engine.warmSimilarityFingerprints(');
		//AWAITED, not fired: `void runDisplayTitleWarmup(` would put the
		//concurrent pass back (mutant M5).
		const titles = body.indexOf('await runDisplayTitleWarmup(');
		assert.ok(tags > 0 && similar > tags && titles > similar, `tags → similarity → titles, each awaited, got ${tags}/${similar}/${titles}`);
		assert.ok(!/scheduleDisplayTitleWarmup\(/.test(source), 'no concurrent title warm-up at epoch publication');
		const titlePass = source.slice(source.indexOf('const runDisplayTitleWarmup'), source.indexOf('const pushMetaDeltas'));
		//The pass body must itself be awaited (mutant M7: `void (async` makes
		//the function resolve at once, and the chain runs it concurrently).
		assert.ok(/await \(async \(\) =>/.test(titlePass) && !/void \(async/.test(titlePass), 'the title pass awaits its own body');
		assert.ok((titlePass.match(/scheduleCorpusSnapshotSave\(\)/g) || []).length >= 2, 'the title pass schedules the snapshot save as it goes and at the end');
		//Both prime paths restore them. The signed-in watermark prime (the
		//only path that holds working notes) did not, so every warm boot
		//recomputed all ~38k titles while the snapshot carried them.
		const readerPrime = source.slice(source.indexOf('const connectPublishedFromSnapshot'), source.indexOf('const connectCards'));
		const watermarkStart = source.indexOf('compactTombstoneIDs = compactSnapshot.processedTombstoneIDs');
		const watermarkPrime = source.slice(watermarkStart, source.indexOf('watermark prime handoff starting', watermarkStart));
		assert.ok(watermarkStart > 0 && watermarkPrime.length > 0, 'found the watermark prime');
		assert.ok(/restoreDisplayTitles\(compactSnapshot\)/.test(readerPrime), 'the reader prime restores persisted titles');
		assert.ok(/restoreDisplayTitles\(compactSnapshot\)/.test(watermarkPrime), 'the signed-in watermark prime restores persisted titles');
		//And they are persisted ONLY into the per-uid privileged record. The
		//shared published record is written by signed-in non-privileged
		//authors too; a real-browser review found their private notes' titles
		//in it, surviving to the next anonymous visitor.
		const save = source.slice(source.indexOf('const saveCorpusSnapshot = '), source.indexOf('const scheduleCorpusSnapshotSave'));
		assert.ok(/scope === 'privileged' && displayTitles\.size \?/.test(save), 'titles are saved only for the privileged scope');
	});

	it('metas carry and compare the display title; the snapshot record validates it', async () => {
		const {metaForCard, metasEquivalent} = await import('../../lib/src/worker/worker-protocol.js');
		const {validCorpusSnapshot} = await import('../../lib/src/worker/corpus-snapshot.js');
		const card = baseCard('n', {card_type: 'working-notes', published: false});
		const a = metaForCard(card);
		const b = {...metaForCard(card), displayTitle: '11/4/20 Frozen'};
		assert.strictEqual(a.displayTitle, undefined, 'metaForCard never computes one');
		assert.strictEqual(metasEquivalent(a, b), false, 'a title arriving is a change the main thread must see');
		assert.strictEqual(metasEquivalent(b, {...b}), true);
		const base = {schemaVersion: 2, cards: {}, clientClockCardIDs: [], processedTombstoneIDs: [], tombstoneCursor: null, watermarkClamp: null, savedAt: 1};
		assert.strictEqual(validCorpusSnapshot({...base, displayTitles: {n: ['s1604500000000', '11/4/20 Frozen']}}), true);
		assert.strictEqual(validCorpusSnapshot({...base, displayTitles: {n: ['s1604500000000']}}), false, 'a malformed entry rejects the record');
		assert.strictEqual(validCorpusSnapshot({...base, displayTitles: []}), false);
		assert.strictEqual(validCorpusSnapshot(base), true, 'absent is fine (older records)');
	});

	it('keys a frozen title on the revision, so an ordinary body save recomputes it and nothing else does', () => {
		//#784: a note is created with an empty body (title = the bare date)
		//and its first body save is not "substantive", so updated_substantive
		//stays at the creation time; keyed on that, the date-only title was
		//frozen forever. The revision moves on every content write.
		const created = baseCard('k', {card_type: 'working-notes', published: false, created: stamp(NOTE_SECONDS), updated_substantive: stamp(NOTE_SECONDS), revision: 1});
		const saved = {...created, body: '<p>Penguins navigate glaciers</p>', revision: 2};
		assert.notStrictEqual(displayTitleKey(saved), displayTitleKey(created), 'a body save at the same updated_substantive changes the key');
		assert.strictEqual(displayTitleKey({...saved, updated_substantive: stamp(NOTE_SECONDS + 999)}), displayTitleKey(saved), 'a timestamp move without a content write does not');
		//A legacy card never written under the revision Rules keeps the
		//timestamp key, so the snapshot's titles for it stay valid.
		const legacy = baseCard('l', {card_type: 'working-notes', published: false, created: stamp(NOTE_SECONDS), updated_substantive: stamp(NOTE_SECONDS + 5)});
		delete legacy.revision;
		assert.match(displayTitleKey(legacy), /^s\d+$/);
	});

	it('re-keys a persisted title for the snapshot image it was frozen for, so the key change recomputes nothing at prime', () => {
		const card = baseCard('p', {card_type: 'working-notes', published: false, created: stamp(NOTE_SECONDS), updated_substantive: stamp(NOTE_SECONDS + 5), revision: 3});
		const legacy = legacyDisplayTitleKey(card);
		assert.match(legacy, /^s\d+$/);
		assert.strictEqual(restoredDisplayTitleKey(card, legacy), 'r3', 'a title saved under the legacy key for this image is re-keyed, not dropped');
		assert.strictEqual(restoredDisplayTitleKey(card, 'r3'), 'r3', 'a current key is kept');
		assert.strictEqual(restoredDisplayTitleKey(card, 's1'), 's1', 'a legacy key for a DIFFERENT image stays stale, so the warm-up recomputes it');
		assert.strictEqual(restoredDisplayTitleKey(undefined, legacy), legacy, 'no image in the snapshot, no re-keying');
		const worker = readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');
		const restore = worker.slice(worker.indexOf('const restoreDisplayTitles'), worker.indexOf('const cachedDisplayTitle'));
		assert.match(restore, /restoredDisplayTitleKey\(cards\[id\], key\)/, 'the worker restores through restoredDisplayTitleKey with the snapshot image');
	});
});
