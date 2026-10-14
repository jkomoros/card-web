#!/usr/bin/env node

/**
 * One-time cutover for slice 5 (docs/lean-architecture/04-private-titles-and-cutover.md §4.2):
 * working-notes titles are authored and optional now, and the dated summary
 * the old finisher wrote into cards/*.title is a viewer-side projection.
 * Existing cards still carry that generated title, which now reads as
 * authored (indexed, embedded, frozen), and their stored
 * nlp_source_fingerprint no longer matches (the title is no longer a
 * derived field), which puts every one of them on the slow processing path.
 *
 * For every working-notes card:
 *   - a title matching the generator's date prefix is CLEARED;
 *   - any other non-empty title is AMBIGUOUS: it is kept, reported, and its
 *     full NLP fields are regenerated so it is consistently "authored";
 *   - the stored nlp_source_fingerprint is rewritten when it differs;
 *   - a card needing nothing is CLEAN (the script is idempotent);
 *   - every write bumps `updated` (updated-invariant) and `revision` by one
 *     (the Rules' content gate), with a precondition on the document's
 *     update time so a card edited mid-run fails loudly and is re-run.
 *
 * Usage (DEV and dry-run by default; nothing is written without --write):
 *   node tools/cutover-working-notes-titles.mjs                      # DEV dry run
 *   node tools/cutover-working-notes-titles.mjs --write              # DEV, writes
 *   node tools/cutover-working-notes-titles.mjs --prod               # PROD dry run
 *   node tools/cutover-working-notes-titles.mjs --prod --write --confirm-project=complexity-compendium
 *   node tools/cutover-working-notes-titles.mjs --emulator --write   # FIRESTORE_EMULATOR_HOST, project demo-perf
 *
 * Prerequisites: `npm run build:shared` (imports shared/dist) and, for a
 * real project, `gcloud auth application-default login`. The project id
 * comes from the repo's config, never from gcloud's active project.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'url';
import { cardWithNormalizedTextPropertiesSimple, ngrams, CURRENT_NLP_VERSION, nlpSourceFingerprintForCard } from '../shared/dist/nlp.js';
import { DERIVED_FIELDS_FOR_CARD_TYPE } from '../shared/dist/card_fields.js';
import { overrideDocument } from '../shared/dist/document.js';

//The exact prefix the old finisher produced: toLocaleDateString('en-US',
//{month:'numeric', day:'numeric', year:'2-digit'}) followed by the terms.
export const GENERATED_TITLE = /^\d{1,2}\/\d{1,2}\/\d{2}( |$)/;

const PAGE_SIZE = 400;

//The same storage shape tools/migrate-nlp-tokens.mjs writes.
const fullNLPFields = (card) => {
	const processedCard = cardWithNormalizedTextPropertiesSimple(card);
	const nlpTokens = {};
	for (const [fieldName, runs] of Object.entries(processedCard.nlp)) {
		nlpTokens[fieldName] = runs.map(run => ({
			normalized: run.normalized,
			...(run.uppercaseRanges ? { uppercaseRanges: run.uppercaseRanges } : {})
		}));
	}
	const searchTokenSet = new Set();
	for (const runs of Object.values(processedCard.nlp)) {
		if (!runs) continue;
		for (const run of runs) {
			for (const word of run.stemmed.split(' ')) if (word) searchTokenSet.add(word);
			for (const bigram of ngrams(run.stemmed, 2)) searchTokenSet.add(bigram);
		}
	}
	return {
		nlp_tokens: nlpTokens,
		nlp_search_tokens: Array.from(searchTokenSet),
		nlp_version: CURRENT_NLP_VERSION,
	};
};

//Structural equality that ignores key order: Firestore hands maps back in
//its own key order, so a stringify comparison would never match.
const canonical = (value) => {
	if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
	if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
	return JSON.stringify(value);
};

//Pure: what to write for one card, or nothing. `sentinels` supplies the
//server-timestamp and increment values so the planner itself is testable
//without the admin SDK.
export const planWorkingNotesCutover = (card, sentinels) => {
	if (card.card_type !== 'working-notes') return {kind: 'not-working-notes', update: null};
	const generated = GENERATED_TITLE.test(card.title || '');
	const next = generated ? {...card, title: ''} : card;
	const update = {};
	let kind = 'clean';
	if (generated) {
		update.title = '';
		kind = 'cleared';
	} else if (card.title) {
		//Kept, and reported as ambiguous on every run; its NLP fields are
		//written only when they differ from what is stored, so a second run
		//over the same card writes nothing.
		kind = 'ambiguous';
		const fields = fullNLPFields(next);
		const stored = {nlp_tokens: card.nlp_tokens, nlp_search_tokens: card.nlp_search_tokens, nlp_version: card.nlp_version};
		if (canonical(fields) !== canonical(stored)) Object.assign(update, fields);
	}
	if (card.nlp_source_fingerprint !== undefined) {
		const fingerprint = nlpSourceFingerprintForCard(next);
		if (fingerprint !== card.nlp_source_fingerprint) {
			update.nlp_source_fingerprint = fingerprint;
			if (kind === 'clean') kind = 'fingerprint-only';
		}
	}
	if (!Object.keys(update).length) return {kind, update: null};
	update.updated = sentinels.serverTimestamp();
	update.revision = sentinels.increment(1);
	return {kind, update};
};

//Walks every working-notes card in pages, planning and (with write)
//committing in batches. Returns the counts and the ambiguous ids.
export const runWorkingNotesCutover = async (db, {write, log = () => {}}) => {
	//`unchanged` counts every card that needed no write, whatever its kind;
	//a second run over a finished corpus has unchanged == total.
	const counts = {total: 0, cleared: 0, 'fingerprint-only': 0, ambiguous: 0, clean: 0, unchanged: 0, 'precondition-failed': 0};
	const ambiguousIDs = [];
	const sentinels = {serverTimestamp: () => FieldValue.serverTimestamp(), increment: (n) => FieldValue.increment(n)};
	let last = null;
	for (;;) {
		let query = db.collection('cards').where('card_type', '==', 'working-notes').orderBy('__name__').limit(PAGE_SIZE);
		if (last) query = query.startAfter(last);
		const page = await query.get();
		if (page.empty) break;
		const batch = db.batch();
		let staged = 0;
		for (const doc of page.docs) {
			counts.total++;
			const card = {...doc.data(), id: doc.id};
			const {kind, update} = planWorkingNotesCutover(card, sentinels);
			counts[kind]++;
			if (kind === 'ambiguous') ambiguousIDs.push(doc.id);
			if (!update) counts.unchanged++;
			if (!update || !write) continue;
			//A card edited between the read and the commit fails this
			//precondition; the batch fails as a whole and the run is repeated.
			batch.update(doc.ref, update, {lastUpdateTime: doc.updateTime});
			staged++;
		}
		if (staged) {
			try {
				await batch.commit();
			} catch (err) {
				if (err && err.code === 9) {
					//FAILED_PRECONDITION: count the page and keep going; a re-run
					//picks the raced cards up.
					counts['precondition-failed'] += staged;
					log(`page ending ${page.docs[page.docs.length - 1].id}: ${staged} write(s) failed their precondition; re-run after this pass`);
				} else {
					throw err;
				}
			}
		}
		log(`${counts.total} scanned — cleared ${counts.cleared}, fingerprint-only ${counts['fingerprint-only']}, ambiguous ${counts.ambiguous}, clean ${counts.clean}`);
		last = page.docs[page.docs.length - 1];
		if (page.size < PAGE_SIZE) break;
	}
	return {counts, ambiguousIDs};
};

const main = async () => {
	const args = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--')).map(arg => {
		const [key, value] = arg.slice(2).split('=');
		return [key, value === undefined ? true : value];
	}));
	if (args.help || args.h) {
		console.log('See the header of tools/cutover-working-notes-titles.mjs for usage.');
		process.exit(0);
	}
	//The slice-5 config must be built, or the script would clear titles
	//that the running app still derives.
	if ((DERIVED_FIELDS_FOR_CARD_TYPE['working-notes'] || {}).title) {
		console.error('Refusing: shared/dist still marks the working-notes title as derived. Build slice 5 first (npm run build:shared).');
		process.exit(1);
	}
	const write = Boolean(args.write);
	let projectId;
	if (args.emulator) {
		if (!process.env.FIRESTORE_EMULATOR_HOST) {
			console.error('--emulator needs FIRESTORE_EMULATOR_HOST');
			process.exit(1);
		}
		projectId = args.project || 'demo-perf';
		initializeApp({projectId});
	} else {
		const {devProdConfig} = await import('../lib/tools/util.js');
		const config = devProdConfig();
		const prod = Boolean(args.prod);
		projectId = (prod ? config.prod : config.dev).firebase.projectId;
		if (prod && write && args['confirm-project'] !== projectId) {
			console.error(`Refusing to write to PROD without --confirm-project=${projectId}`);
			process.exit(1);
		}
		initializeApp({credential: applicationDefault(), projectId});
	}
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	overrideDocument(dom.window.document);
	console.log(`Working-notes title cutover — project ${projectId} — ${write ? 'WRITING' : 'dry run'}`);
	const started = Date.now();
	const {counts, ambiguousIDs} = await runWorkingNotesCutover(getFirestore(), {write, log: line => console.log('  ' + line)});
	console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s:`, JSON.stringify(counts));
	if (ambiguousIDs.length) console.log(`ambiguous (titles kept, NLP regenerated): ${ambiguousIDs.join(', ')}`);
	if (counts['precondition-failed']) {
		console.log('some writes raced an edit; run again');
		process.exit(2);
	}
	process.exit(0);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
