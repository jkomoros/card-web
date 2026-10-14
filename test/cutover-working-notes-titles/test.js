/*eslint-env node, es2022*/

//The slice-5 cutover script (docs/lean-architecture/04 §4.2, §5.4): the
//pure planner over the six card shapes it must tell apart, and the whole
//script run twice against the emulator — the second run writes nothing,
//revision moved by exactly one, updated was bumped.

import assert from 'assert';
import {spawnSync} from 'child_process';
import {JSDOM} from 'jsdom';
import {overrideDocument} from '../../shared/dist/document.js';
import admin from 'firebase-admin';
import {planWorkingNotesCutover, runWorkingNotesCutover, GENERATED_TITLE} from '../../tools/cutover-working-notes-titles.mjs';
import {nlpSourceFingerprintForCard, cardWithNormalizedTextPropertiesSimple, ngrams, CURRENT_NLP_VERSION} from '../../shared/dist/nlp.js';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
overrideDocument(dom.window.document);

const sentinels = {serverTimestamp: () => 'SERVER_TIMESTAMP', increment: (n) => `INCREMENT_${n}`};
const note = (id, extras = {}) => ({id, card_type: 'working-notes', title: '', body: `<p>Body of ${id} with some distinct words</p>`, ...extras});
const fingerprintOf = card => nlpSourceFingerprintForCard(card);
//What the client writes on a save (the script's fullNLPFields is a copy).
const fullNLPFields = (card) => {
	const processed = cardWithNormalizedTextPropertiesSimple(card);
	const nlp_tokens = Object.fromEntries(Object.entries(processed.nlp).map(([field, runs]) => [field, runs.map(run => ({normalized: run.normalized, ...(run.uppercaseRanges ? {uppercaseRanges: run.uppercaseRanges} : {})}))]));
	const tokens = new Set();
	for (const runs of Object.values(processed.nlp)) for (const run of runs || []) {
		for (const word of run.stemmed.split(' ')) if (word) tokens.add(word);
		for (const bigram of ngrams(run.stemmed, 2)) tokens.add(bigram);
	}
	return {nlp_tokens, nlp_search_tokens: Array.from(tokens), nlp_version: CURRENT_NLP_VERSION};
};

//A card whose stored NLP fields and fingerprint are current for its text.
const tokenized = (card) => ({...card, ...fullNLPFields(card), nlp_source_fingerprint: fingerprintOf(card)});

describe('cutover planner', () => {
	it('recognizes the generator\'s date prefix (and its one-week "> " variant) and nothing else', () => {
		for (const title of ['11/4/20 Truth Landing Ground', '1/1/26', '12/31/99 x', '> 10/20/20 Early Form']) assert.ok(GENERATED_TITLE.test(title), title);
		for (const title of ['', 'Authored', '2020/11/04 x', '11/4/2020 x', ' 11/4/20 x', 'On 11/4/20', '>11/4/20 x']) assert.ok(!GENERATED_TITLE.test(title), JSON.stringify(title));
	});

	it('plans the shapes: generated, ambiguous, current, stale tokens, never tokenized, other types', () => {
		const generated = note('g1', {title: '11/4/20 Truth Landing Ground'});
		const generatedTokenized = tokenized(note('g2', {title: '11/4/20 Truth Landing Ground'}));
		const ambiguous = note('a1', {title: 'My own note title', nlp_source_fingerprint: 'stale'});
		const current = tokenized(note('e1'));
		const staleFingerprint = {...tokenized(note('s1')), nlp_source_fingerprint: 'stale'};
		const neverTokenized = note('n1');
		const content = {...note('c1', {title: '11/4/20 looks generated'}), card_type: 'content'};

		const p1 = planWorkingNotesCutover(generated, sentinels);
		assert.strictEqual(p1.kind, 'cleared');
		assert.strictEqual(p1.update.title, '');
		assert.deepStrictEqual(Object.keys(p1.update).sort(), ['nlp_search_tokens', 'nlp_source_fingerprint', 'nlp_tokens', 'nlp_version', 'revision', 'title', 'updated'], 'a cleared card is tokenized for its new text and fingerprinted together');
		assert.strictEqual(p1.update.nlp_source_fingerprint, fingerprintOf({...generated, title: ''}), 'the fingerprint is of the card WITHOUT the generated title');
		assert.ok(!p1.update.nlp_search_tokens.includes('landing'), 'the generated title\'s words are not indexed');

		const p2 = planWorkingNotesCutover(generatedTokenized, sentinels);
		assert.strictEqual(p2.kind, 'cleared');
		assert.notStrictEqual(p2.update.nlp_source_fingerprint, generatedTokenized.nlp_source_fingerprint);

		const p3 = planWorkingNotesCutover(ambiguous, sentinels);
		assert.strictEqual(p3.kind, 'ambiguous');
		assert.strictEqual(p3.update.title, undefined, 'an authored-looking title is kept');
		assert.ok(p3.update.nlp_search_tokens.includes('own'), 'the kept title is indexed');
		assert.strictEqual(p3.update.nlp_source_fingerprint, fingerprintOf(ambiguous), 'and fingerprinted with its tokens');

		assert.deepStrictEqual(planWorkingNotesCutover(current, sentinels), {kind: 'clean', update: null});
		assert.deepStrictEqual(planWorkingNotesCutover(neverTokenized, sentinels), {kind: 'clean', update: null}, 'never tokenized and nothing to clear: not this script\'s');

		const p5 = planWorkingNotesCutover(staleFingerprint, sentinels);
		assert.strictEqual(p5.kind, 'retokenized');
		assert.ok(p5.update.nlp_tokens, 'tokens are rewritten with the fingerprint, never the fingerprint alone');

		assert.deepStrictEqual(planWorkingNotesCutover(content, sentinels), {kind: 'not-working-notes', update: null});
	});

	it('never stamps stale tokens as current: a body that changed behind the tokens is re-tokenized', () => {
		//The drift the fingerprint exists to detect: tokens from an old body,
		//a fingerprint that no longer matches. Writing a fresh fingerprint
		//alone would have made this card fast and wrong.
		const old = tokenized(note('d1', {body: '<p>alpha beta original words</p>'}));
		const drifted = {...old, body: '<p>zebra quokka replaced everything</p>'};
		const {kind, update} = planWorkingNotesCutover(drifted, sentinels);
		assert.strictEqual(kind, 'retokenized');
		assert.ok(update.nlp_search_tokens.includes('zebra'), 'the stored tokens reflect the new body');
		assert.ok(!update.nlp_search_tokens.includes('alpha'));
		assert.strictEqual(update.nlp_source_fingerprint, fingerprintOf(drifted));
		//And the generated-title case too.
		const driftedGenerated = {...old, title: '11/4/20 Alpha Beta', body: '<p>zebra quokka replaced everything</p>'};
		const cleared = planWorkingNotesCutover(driftedGenerated, sentinels);
		assert.strictEqual(cleared.kind, 'cleared');
		assert.ok(cleared.update.nlp_search_tokens.includes('zebra'));
	});

	it('is idempotent: planning the written result again writes nothing', () => {
		for (const card of [
			note('g3', {title: '11/4/20 Truth Landing Ground', nlp_source_fingerprint: 'stale', revision: 4}),
			note('a2', {title: 'Kept', nlp_source_fingerprint: 'stale'}),
			{...tokenized(note('s2')), nlp_source_fingerprint: 'stale'},
		]) {
			const {kind, update} = planWorkingNotesCutover(card, sentinels);
			assert.ok(update, kind);
			const {updated, revision, ...fields} = update;
			assert.strictEqual(updated, 'SERVER_TIMESTAMP');
			assert.strictEqual(revision, 'INCREMENT_1');
			const after = {...card, ...fields};
			const again = planWorkingNotesCutover(after, sentinels);
			assert.strictEqual(again.update, null, `${kind} written again`);
			assert.strictEqual(again.kind, kind === 'ambiguous' ? 'ambiguous' : 'clean');
		}
	});
});

describe('cutover script against the emulator', function() {
	this.timeout(120000);
	const host = process.env.FIRESTORE_EMULATOR_HOST;
	const app = admin.initializeApp({projectId: 'demo-perf'}, 'cutover-test');
	const db = app.firestore();
	const run = () => spawnSync(process.execPath, ['tools/cutover-working-notes-titles.mjs', '--emulator', '--write', '--project=demo-perf'], {encoding: 'utf8', env: {...process.env, FIRESTORE_EMULATOR_HOST: host}});

	it('clears generated titles once, bumps revision by exactly one, and the second run writes nothing', async () => {
		assert.ok(host, 'FIRESTORE_EMULATOR_HOST must be set (the suite runs under emulators:exec)');
		const stamp = Date.now();
		const seeded = {
			[`cut-${stamp}-generated`]: note('x', {title: '11/4/20 Truth Landing Ground', nlp_source_fingerprint: 'stale', revision: 3}),
			[`cut-${stamp}-ambiguous`]: note('x', {title: 'Kept title', nlp_source_fingerprint: 'stale', revision: 1}),
			[`cut-${stamp}-clean`]: note('x', {revision: 2}),
			[`cut-${stamp}-content`]: {...note('x', {title: '11/4/20 not a note'}), card_type: 'content', revision: 1},
		};
		for (const [id, card] of Object.entries(seeded)) await db.collection('cards').doc(id).set({...card, id, updated: admin.firestore.Timestamp.fromMillis(1_600_000_000_000)});

		const first = run();
		assert.strictEqual(first.status, 0, first.stdout + first.stderr);
		const generated = (await db.collection('cards').doc(`cut-${stamp}-generated`).get()).data();
		assert.strictEqual(generated.title, '');
		assert.strictEqual(generated.revision, 4, 'revision +1 exactly once');
		assert.ok(generated.updated.toMillis() > 1_600_000_000_000, 'updated was bumped');
		assert.strictEqual(generated.nlp_source_fingerprint, fingerprintOf({...seeded[`cut-${stamp}-generated`], title: ''}));
		const ambiguous = (await db.collection('cards').doc(`cut-${stamp}-ambiguous`).get()).data();
		assert.strictEqual(ambiguous.title, 'Kept title');
		assert.strictEqual(ambiguous.revision, 2);
		assert.ok(ambiguous.nlp_tokens, 'ambiguous card got NLP fields');
		assert.strictEqual(ambiguous.nlp_source_fingerprint, fingerprintOf({...seeded[`cut-${stamp}-ambiguous`], id: `cut-${stamp}-ambiguous`}), 'and its fingerprint');
		assert.ok(first.stdout.includes(`cut-${stamp}-ambiguous`), 'the ambiguous id is reported');
		const clean = (await db.collection('cards').doc(`cut-${stamp}-clean`).get()).data();
		assert.strictEqual(clean.revision, 2, 'a clean card is untouched');
		assert.strictEqual(clean.updated.toMillis(), 1_600_000_000_000);
		const content = (await db.collection('cards').doc(`cut-${stamp}-content`).get()).data();
		assert.strictEqual(content.title, '11/4/20 not a note', 'other types are untouched');

		const second = run();
		assert.strictEqual(second.status, 0, second.stdout + second.stderr);
		const again = (await db.collection('cards').doc(`cut-${stamp}-generated`).get()).data();
		assert.strictEqual(again.revision, 4, 'the second run wrote nothing');
		assert.strictEqual((await db.collection('cards').doc(`cut-${stamp}-ambiguous`).get()).data().revision, 2);
	});

	it('a card edited between the read and the commit fails its precondition and is left for a re-run', async () => {
		const stamp = Date.now();
		const ids = ['p0', 'p1', 'p2'].map(suffix => `cut-${stamp}-${suffix}`);
		for (const id of ids) await db.collection('cards').doc(id).set({...note('x', {title: '11/4/20 Truth Landing Ground', revision: 1}), id, updated: admin.firestore.Timestamp.fromMillis(1_600_000_000_000)});
		//Between the page read and its commit, another client authors a title
		//on one of the cards.
		const racedDB = {
			collection: name => db.collection(name),
			batch: () => {
				const real = db.batch();
				const commit = real.commit.bind(real);
				real.commit = async () => {
					await db.collection('cards').doc(ids[1]).update({title: 'Authored mid-run', updated: admin.firestore.FieldValue.serverTimestamp()});
					return commit();
				};
				return real;
			},
		};
		const first = await runWorkingNotesCutover(racedDB, {write: true});
		assert.ok(first.counts['precondition-failed'] >= 3, `the whole raced batch failed its precondition: ${JSON.stringify(first.counts)}`);
		assert.strictEqual((await db.collection('cards').doc(ids[1]).get()).data().title, 'Authored mid-run', 'the mid-run edit survived');
		const second = await runWorkingNotesCutover(db, {write: true});
		assert.strictEqual(second.counts['precondition-failed'], 0);
		assert.strictEqual((await db.collection('cards').doc(ids[0]).get()).data().title, '', 'the re-run cleared the unraced card');
		assert.strictEqual((await db.collection('cards').doc(ids[1]).get()).data().title, 'Authored mid-run', 'and reported the authored one as ambiguous');
		assert.ok(second.ambiguousIDs.includes(ids[1]));
	});

	it('refuses to run without the emulator host, and prod without confirmation', () => {
		const noHost = spawnSync(process.execPath, ['tools/cutover-working-notes-titles.mjs', '--emulator', '--write'], {encoding: 'utf8', env: {...process.env, FIRESTORE_EMULATOR_HOST: ''}});
		assert.strictEqual(noHost.status, 1);
		assert.match(noHost.stderr, /FIRESTORE_EMULATOR_HOST/);
	});
});
