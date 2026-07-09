/*eslint-env node*/

//Loads a generated synthetic corpus (gen-corpus.js) into the Firestore
//EMULATOR via firebase-admin, so the perf harness can boot the real app
//against a worst-case 40k corpus with no live Firebase project, no quota, and
//no prod-backup restore. Admin-SDK writes bypass security rules (that's fine —
//this is seed data, not a rules test).
//
//REQUIRES the Firestore emulator to be running and FIRESTORE_EMULATOR_HOST set
//(the admin SDK auto-targets the emulator when that env var is present). Never
//point this at a real project — it refuses to run without the emulator env.
//
//Usage (from repo root, emulator already running on :8080):
//   FIRESTORE_EMULATOR_HOST=localhost:8080 \
//     node test/perf-harness/load-emulator.js --count 40000 --seed 1 --project demo-perf
//Or wrapped via `firebase emulators:exec` (see npm run perf:load).

import admin from 'firebase-admin';
import {generateCorpus, corpusStats} from './gen-corpus.js';

const args = process.argv.slice(2);
const getArg = (name, dflt) => {
	const idx = args.indexOf('--' + name);
	return idx >= 0 && args[idx + 1] ? args[idx + 1] : dflt;
};

const count = parseInt(getArg('count', '40000'), 10);
const seed = parseInt(getArg('seed', '1'), 10);
const projectId = getArg('project', 'demo-perf');
const adminUid = getArg('admin', 'perf-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
	console.error('REFUSING TO RUN: FIRESTORE_EMULATOR_HOST is not set. This tool only writes to the Firestore emulator, never a real project.');
	process.exit(1);
}

const {Timestamp} = admin.firestore;

//Convert the generator's SDK-agnostic {seconds, nanoseconds} plain objects into
//real Firestore Timestamps recursively (the app expects Timestamp instances for
//created/updated/etc.).
const isPlainTs = (v) => v && typeof v === 'object' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number' && Object.keys(v).length === 2;
const withTimestamps = (value) => {
	if (Array.isArray(value)) return value.map(withTimestamps);
	if (isPlainTs(value)) return new Timestamp(value.seconds, value.nanoseconds);
	if (value && typeof value === 'object') {
		const out = {};
		for (const [k, v] of Object.entries(value)) out[k] = withTimestamps(v);
		return out;
	}
	return value;
};

const main = async () => {
	admin.initializeApp({projectId});
	const db = admin.firestore();

	const cards = generateCorpus({count, seed});
	const stats = corpusStats(cards);
	console.error('[load-emulator] generated ' + JSON.stringify(stats));

	//Minimal app scaffolding so the corpus is usable: an admin permission doc
	//and a `main` section (the app reads sections; a bare corpus with none is
	//degenerate). Keep this small — it is seed data, not a fixture contract.
	await db.collection('permissions').doc(adminUid).set({admin: true});
	await db.collection('sections').doc('main').set({
		title: 'Main', subtitle: 'perf corpus', cards: [], start_cards: [], order: 0,
		updated: Timestamp.now(),
	});

	const ids = Object.keys(cards);
	const CHUNK = 400; //under the 500-op batch limit
	let written = 0;
	for (let i = 0; i < ids.length; i += CHUNK) {
		const batch = db.batch();
		for (const id of ids.slice(i, i + CHUNK)) {
			batch.set(db.collection('cards').doc(id), withTimestamps(cards[id]));
		}
		await batch.commit();
		written += Math.min(CHUNK, ids.length - i);
		if (written % 4000 === 0 || written === ids.length) {
			console.error(`[load-emulator] wrote ${written}/${ids.length}`);
		}
	}

	//Verify the write landed.
	const snap = await db.collection('cards').count().get();
	const actual = snap.data().count;
	console.error(`[load-emulator] cards collection count = ${actual}`);
	if (actual !== ids.length) {
		console.error(`[load-emulator] MISMATCH: expected ${ids.length}, got ${actual}`);
		process.exit(2);
	}
	console.error('[load-emulator] done.');
	process.exit(0);
};

main().catch(err => { console.error('[load-emulator] failed:', err); process.exit(1); });
