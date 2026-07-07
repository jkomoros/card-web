/*eslint-env node*/

//Tests for the `updated` write-invariant (docs/corpus-sync-design.md). The
//watermark delta sync only fetches cards with updated > watermark and
//fastDedupe treats equal `updated` as proof of equivalence, so every card
//mutation MUST bump `updated`. Two layers are checked here:
// 1. The pure policy core (src/card-write-guard.ts) that MultiBatch enforces.
// 2. A source audit that every updateWithoutTimestampBump() escape hatch is
//    annotated, so the exemptions stay grep-able and reviewed.

import assert from 'assert';
import fs from 'fs';
import path from 'path';

let isTopLevelDocPath;
let cardWriteViolation;

const CARDS = 'cards';

describe('updated-invariant pure core', () => {
	before(async () => {
		({isTopLevelDocPath, cardWriteViolation} = await import('../../lib/src/card-write-guard.js'));
	});

	it('isTopLevelDocPath is true only for a top-level card doc', () => {
		assert.strictEqual(isTopLevelDocPath('cards/abc', CARDS), true);
	});

	it('isTopLevelDocPath is false for a card subcollection doc', () => {
		assert.strictEqual(isTopLevelDocPath('cards/abc/updates/123', CARDS), false);
	});

	it('isTopLevelDocPath is false for the bare collection and other collections', () => {
		assert.strictEqual(isTopLevelDocPath('cards', CARDS), false);
		assert.strictEqual(isTopLevelDocPath('sections/main', CARDS), false);
		assert.strictEqual(isTopLevelDocPath('', CARDS), false);
	});

	it('a card write WITH the updated sentinel is compliant (no violation)', () => {
		assert.strictEqual(cardWriteViolation('cards/abc', CARDS, true), null);
	});

	it('a card write WITHOUT the updated sentinel is a violation', () => {
		const violation = cardWriteViolation('cards/abc', CARDS, false);
		assert.ok(violation, 'expected a violation message');
		//The message must point writers at the annotated escape hatch.
		assert.ok(violation.includes('updateWithoutTimestampBump'), 'message should name the escape hatch');
		assert.ok(violation.includes('cards/abc'), 'message should name the offending path');
	});

	it('a subcollection write without the sentinel is exempt (updates/{ts})', () => {
		assert.strictEqual(cardWriteViolation('cards/abc/updates/123', CARDS, false), null);
	});

	it('a write to a non-card collection without the sentinel is exempt', () => {
		assert.strictEqual(cardWriteViolation('sections/main', CARDS, false), null);
		assert.strictEqual(cardWriteViolation('stars/xyz', CARDS, false), null);
	});
});

//Recursively collect every .ts file under a directory.
const collectTsFiles = (dir) => {
	const out = [];
	for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...collectTsFiles(full));
		} else if (entry.name.endsWith('.ts')) {
			out.push(full);
		}
	}
	return out;
};

describe('updated-invariant escape-hatch audit', () => {
	const srcDir = path.join(process.cwd(), 'src');
	//The annotation every exempt call site must carry near its use, so the
	//exemptions stay grep-able and reviewed (see multi_batch.ts).
	const ANNOTATION = 'updated-invariant: exempt';
	//How many lines above the call the annotation may appear.
	const LOOKBACK = 6;

	let callSites;

	before(() => {
		callSites = [];
		for (const file of collectTsFiles(srcDir)) {
			//The definition lives in multi_batch.ts; skip the declaration file
			//so we only audit *call* sites.
			if (file.endsWith(path.join('src', 'multi_batch.ts'))) continue;
			const lines = fs.readFileSync(file, 'utf8').split('\n');
			lines.forEach((line, idx) => {
				if (line.includes('.updateWithoutTimestampBump(')) {
					callSites.push({file, line: idx + 1, lines, idx});
				}
			});
		}
	});

	it('finds the known escape-hatch call sites (guards against a broken scan)', () => {
		//Stars (add/remove), the message counter, and the vestigial tweet
		//reset are the sanctioned reader-counter exemptions. If this drops to
		//zero the scan is broken; if it grows, a new exemption was added and
		//must be reviewed.
		assert.ok(callSites.length >= 4, `expected >=4 escape-hatch call sites, found ${callSites.length}`);
	});

	it('every updateWithoutTimestampBump() call site is annotated as exempt', () => {
		const unannotated = callSites.filter(({lines, idx}) => {
			const start = Math.max(0, idx - LOOKBACK);
			const window = lines.slice(start, idx + 1).join('\n');
			return !window.includes(ANNOTATION);
		});
		assert.strictEqual(
			unannotated.length,
			0,
			'unannotated escape-hatch call sites (add a "//updated-invariant: exempt" comment explaining why):\n' +
				unannotated.map(({file, line}) => `  ${path.relative(process.cwd(), file)}:${line}`).join('\n')
		);
	});
});

describe('updated-invariant no-bump allowlist (pure core)', () => {
	let nonBumpCardWriteViolation;

	before(async () => {
		({nonBumpCardWriteViolation} = await import('../../lib/src/card-write-guard.js'));
	});

	it('allows counter-only no-bump card writes', () => {
		assert.strictEqual(nonBumpCardWriteViolation('cards/abc', CARDS, ['star_count', 'star_count_manual']), null);
		assert.strictEqual(nonBumpCardWriteViolation('cards/abc', CARDS, ['updated_message']), null);
		assert.strictEqual(nonBumpCardWriteViolation('cards/abc', CARDS, ['tweet_count', 'last_tweeted']), null);
		assert.strictEqual(nonBumpCardWriteViolation('cards/abc', CARDS, ['thread_count', 'thread_resolved_count']), null);
	});

	it('rejects a no-bump card write that touches a content field', () => {
		const violation = nonBumpCardWriteViolation('cards/abc', CARDS, ['body']);
		assert.ok(violation, 'expected a violation for a content field via the escape hatch');
		assert.ok(violation.includes('body'), 'message should name the offending field');
	});

	it('rejects a mixed write, naming the disallowed field', () => {
		const violation = nonBumpCardWriteViolation('cards/abc', CARDS, ['star_count', 'title']);
		assert.ok(violation);
		assert.ok(violation.includes('title'), 'message should name the disallowed content field');
	});

	it('is inert for non-card and subcollection paths', () => {
		assert.strictEqual(nonBumpCardWriteViolation('sections/main', CARDS, ['anything']), null);
		assert.strictEqual(nonBumpCardWriteViolation('cards/abc/updates/1', CARDS, ['body']), null);
	});
});

//---------------------------------------------------------------------------
//Bypass audit. The MultiBatch guard only covers writes through the client
//MultiBatch. Card writes that bypass it — raw updateDoc/setDoc and
//runTransaction in src/, and ALL admin-SDK writes in functions/ and tools/ —
//are not enforced at runtime, so each must carry an "//updated-invariant:"
//annotation stating whether it bumps `updated` or is an accepted-drift
//exemption. This audit fails on any bypass that is unannotated — the
//regression class the invariant actually fears (a forgetful card write that
//never resyncs), which the escape-hatch audit alone cannot see.
//---------------------------------------------------------------------------

const readFilesRecursive = (dir, exts) => {
	const out = [];
	let entries;
	try {
		entries = fs.readdirSync(dir, {withFileTypes: true});
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib') continue;
			out.push(...readFilesRecursive(full, exts));
		} else if (exts.some(e => entry.name.endsWith(e))) {
			out.push(full);
		}
	}
	return out;
};

//Marker every bypass write must carry (covers the 'exempt' and 'bumps' forms).
const BYPASS_ANNOTATION = 'updated-invariant:';
const BYPASS_LOOKBACK = 8;

//Ref-argument signals that a write targets a top-level card doc. Strong
//signals are card-specific names; weak signals (generic loop refs) only count
//in a file that references CARDS_COLLECTION, to avoid flagging writes to other
//collections that happen to iterate with `doc.ref`.
const CARD_REF_STRONG = /\b(cardRef|cardDocRef|cardsRef|otherCardRef|startCardRef)\b|CARDS_COLLECTION/;
const CARD_REF_WEAK = /\b(otherRef|docSnap\.ref|doc\.ref)\b/;

//Write-call patterns; each captures the first (ref) argument.
const RAW_WRITE_PATTERNS = [
	/\bupdateDoc\(\s*([^,]+),/,
	/\bsetDoc\(\s*([^,]+),/,
	/\btransaction\.(?:update|set|create)\(\s*([^,)]+)[,)]/
];
//Admin batch writes are only unguarded in functions/tools (in src/, batch.* is
//the guarded client MultiBatch).
const ADMIN_BATCH_PATTERNS = [
	/\bbatch\.(?:update|set|create)\(\s*([^,)]+)[,)]/
];

const scanForCardBypassWrites = (files, patterns) => {
	const sites = [];
	for (const file of files) {
		if (file.endsWith(path.join('src', 'multi_batch.ts'))) continue;
		if (file.endsWith(path.join('src', 'card-write-guard.ts'))) continue;
		const text = fs.readFileSync(file, 'utf8');
		const fileMentionsCards = text.includes('CARDS_COLLECTION');
		const lines = text.split('\n');
		lines.forEach((line, idx) => {
			//Skip comment lines: they mention write calls in prose (e.g. type
			//docs) but are not real bypasses.
			const trimmed = line.trim();
			if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
			for (const pattern of patterns) {
				const m = line.match(pattern);
				if (!m) continue;
				const refArg = (m[1] || '').trim();
				const isCard = CARD_REF_STRONG.test(refArg) || (CARD_REF_WEAK.test(refArg) && fileMentionsCards);
				if (!isCard) continue;
				const start = Math.max(0, idx - BYPASS_LOOKBACK);
				const annotated = lines.slice(start, idx + 1).join('\n').includes(BYPASS_ANNOTATION);
				sites.push({file, line: idx + 1, annotated});
				break;
			}
		});
	}
	return sites;
};

describe('updated-invariant bypass audit', () => {
	let sites;

	before(() => {
		const srcFiles = readFilesRecursive(path.join(process.cwd(), 'src'), ['.ts'])
			.filter(f => !f.includes(`${path.sep}test${path.sep}`) && !f.endsWith('.d.ts'));
		const adminFiles = [
			...readFilesRecursive(path.join(process.cwd(), 'functions', 'src'), ['.ts']),
			...readFilesRecursive(path.join(process.cwd(), 'tools'), ['.ts', '.mjs'])
		].filter(f => !f.endsWith('.d.ts'));
		sites = [
			//src/: raw client writes + transactions bypass the guard. Client
			//batch.* IS the guarded MultiBatch, so it is deliberately not scanned.
			...scanForCardBypassWrites(srcFiles, RAW_WRITE_PATTERNS),
			//functions/ + tools/: admin SDK — every write bypasses the client guard.
			...scanForCardBypassWrites(adminFiles, [...RAW_WRITE_PATTERNS, ...ADMIN_BATCH_PATTERNS])
		];
	});

	it('finds the known card-write bypass sites (guards against a broken scan)', () => {
		//normalize-body (maintenance), 2 comment transactions, 2 twitter admin
		//writes, 2 mount admin writes, 1 nlp migration = 8. A collapse to near
		//zero means the scan silently stopped detecting bypasses.
		assert.ok(sites.length >= 8, `expected >=8 bypass sites, found ${sites.length}:\n` +
			sites.map(s => `  ${path.relative(process.cwd(), s.file)}:${s.line}`).join('\n'));
	});

	it('every card write that bypasses the MultiBatch guard is annotated', () => {
		const unannotated = sites.filter(s => !s.annotated);
		assert.strictEqual(unannotated.length, 0,
			'card writes that bypass the updated-invariant guard without an ' +
			'"//updated-invariant:" annotation (state whether it bumps `updated` or is exempt):\n' +
			unannotated.map(s => `  ${path.relative(process.cwd(), s.file)}:${s.line}`).join('\n'));
	});
});
