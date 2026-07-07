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
