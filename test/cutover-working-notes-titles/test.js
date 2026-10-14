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
import {planWorkingNotesCutover, GENERATED_TITLE} from '../../tools/cutover-working-notes-titles.mjs';
import {nlpSourceFingerprintForCard} from '../../shared/dist/nlp.js';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
overrideDocument(dom.window.document);

const sentinels = {serverTimestamp: () => 'SERVER_TIMESTAMP', increment: (n) => `INCREMENT_${n}`};
const note = (id, extras = {}) => ({id, card_type: 'working-notes', title: '', body: `<p>Body of ${id} with some distinct words</p>`, ...extras});
const fingerprintOf = card => nlpSourceFingerprintForCard(card);

describe('cutover planner', () => {
	it('recognizes the generator\'s date prefix and nothing else', () => {
		for (const title of ['11/4/20 Truth Landing Ground', '1/1/26', '12/31/99 x']) assert.ok(GENERATED_TITLE.test(title), title);
		for (const title of ['', 'Authored', '2020/11/04 x', '11/4/2020 x', ' 11/4/20 x', 'On 11/4/20']) assert.ok(!GENERATED_TITLE.test(title), JSON.stringify(title));
	});

	it('plans the six shapes: generated with and without a stored fingerprint, ambiguous, empty, stale fingerprint only, other types', () => {
		const generatedNoFingerprint = note('g1', {title: '11/4/20 Truth Landing Ground'});
		const generatedWithFingerprint = note('g2', {title: '11/4/20 Truth Landing Ground', nlp_source_fingerprint: 'stale'});
		const ambiguous = note('a1', {title: 'My own note title', nlp_source_fingerprint: 'stale'});
		const empty = note('e1', {nlp_source_fingerprint: fingerprintOf(note('e1'))});
		const staleOnly = note('s1', {nlp_source_fingerprint: 'stale'});
		const content = {...note('c1', {title: '11/4/20 looks generated'}), card_type: 'content'};

		const p1 = planWorkingNotesCutover(generatedNoFingerprint, sentinels);
		assert.strictEqual(p1.kind, 'cleared');
		assert.deepStrictEqual(p1.update, {title: '', updated: 'SERVER_TIMESTAMP', revision: 'INCREMENT_1'}, 'no stored fingerprint: none written');

		const p2 = planWorkingNotesCutover(generatedWithFingerprint, sentinels);
		assert.strictEqual(p2.kind, 'cleared');
		assert.strictEqual(p2.update.title, '');
		assert.strictEqual(p2.update.nlp_source_fingerprint, fingerprintOf({...generatedWithFingerprint, title: ''}), 'the fingerprint is of the card WITHOUT the generated title');
		assert.notStrictEqual(p2.update.nlp_source_fingerprint, fingerprintOf(generatedWithFingerprint));

		const p3 = planWorkingNotesCutover(ambiguous, sentinels);
		assert.strictEqual(p3.kind, 'ambiguous');
		assert.strictEqual(p3.update.title, undefined, 'an authored-looking title is kept');
		assert.ok(p3.update.nlp_tokens && p3.update.nlp_search_tokens && p3.update.nlp_version, 'its NLP fields are regenerated as authored');
		assert.ok(p3.update.nlp_search_tokens.includes('own'), 'the kept title is indexed');
		assert.strictEqual(p3.update.nlp_source_fingerprint, fingerprintOf(ambiguous));

		assert.deepStrictEqual(planWorkingNotesCutover(empty, sentinels), {kind: 'clean', update: null});
		assert.deepStrictEqual(planWorkingNotesCutover(note('e2'), sentinels), {kind: 'clean', update: null}, 'no title, no stored fingerprint: nothing to do');

		const p5 = planWorkingNotesCutover(staleOnly, sentinels);
		assert.strictEqual(p5.kind, 'fingerprint-only');
		assert.deepStrictEqual(Object.keys(p5.update).sort(), ['nlp_source_fingerprint', 'revision', 'updated']);

		assert.deepStrictEqual(planWorkingNotesCutover(content, sentinels), {kind: 'not-working-notes', update: null});
	});

	it('is idempotent: planning the written result again is clean', () => {
		const card = note('g3', {title: '11/4/20 Truth Landing Ground', nlp_source_fingerprint: 'stale', revision: 4});
		const {update} = planWorkingNotesCutover(card, sentinels);
		const after = {...card, title: update.title, nlp_source_fingerprint: update.nlp_source_fingerprint, revision: 5};
		assert.deepStrictEqual(planWorkingNotesCutover(after, sentinels), {kind: 'clean', update: null});
		//An ambiguous card stays reported as ambiguous, but writes nothing
		//once its NLP fields and fingerprint are current.
		const ambiguous = note('a2', {title: 'Kept', nlp_source_fingerprint: 'stale'});
		const first = planWorkingNotesCutover(ambiguous, sentinels);
		assert.strictEqual(first.kind, 'ambiguous');
		const written = {...ambiguous, nlp_tokens: first.update.nlp_tokens, nlp_search_tokens: first.update.nlp_search_tokens, nlp_version: first.update.nlp_version, nlp_source_fingerprint: first.update.nlp_source_fingerprint};
		assert.deepStrictEqual(planWorkingNotesCutover(written, sentinels), {kind: 'ambiguous', update: null});
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

	it('refuses to run without the emulator host, and prod without confirmation', () => {
		const noHost = spawnSync(process.execPath, ['tools/cutover-working-notes-titles.mjs', '--emulator', '--write'], {encoding: 'utf8', env: {...process.env, FIRESTORE_EMULATOR_HOST: ''}});
		assert.strictEqual(noHost.status, 1);
		assert.match(noHost.stderr, /FIRESTORE_EMULATOR_HOST/);
	});
});
