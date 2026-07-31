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

//NOTE: this audit is a heuristic lower-bound, not a proof. It only
//recognizes card refs via the CARD_REF_STRONG/CARD_REF_WEAK name allowlists
//above; a card write using an unrecognized ref variable name (e.g.
//`newCardRef`) on a line that doesn't otherwise mention CARDS_COLLECTION
//would silently not be flagged here. Treat this suite as a tripwire that
//catches sloppy/renamed bypasses, not as the enforcement mechanism itself —
//the actual enforcement is the runtime guard (src/card-write-guard.ts, wired
//through src/multi_batch.ts) for client code, and the Firestore security
//rules for all client writes regardless of code path.
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

//---------------------------------------------------------------------------
//Combinatorial falsification of the pure policy core. The input domain is
//small and finite (a doc path, a collection name, and a set of field names),
//so we enumerate it EXHAUSTIVELY — a stronger guarantee than random property
//sampling would give for this shape. Each test states an invariant PROPERTY
//and tries to find a counterexample, rather than re-deriving the impl.
//---------------------------------------------------------------------------
describe('updated-invariant pure core — combinatorial falsification', () => {
	let isTopLevelDocPath, cardWriteViolation, nonBumpCardWriteViolation, COUNTER_FIELDS;

	before(async () => {
		({isTopLevelDocPath, cardWriteViolation, nonBumpCardWriteViolation, COUNTER_FIELDS_EXEMPT_FROM_UPDATED: COUNTER_FIELDS} =
			await import('../../lib/src/card-write-guard.js'));
	});

	const CARD_IDS = ['abc', 'a', 'card-with-dashes', '123', 'UPPERCASE', 'a.b'];
	//Deliberately excludes the malformed 'cards/' (empty doc id) — real
	//DocumentReference paths never have an empty id, and isTopLevelDocPath
	//treats it as a card path, which is fine because it cannot occur.
	const NON_CARD_PATHS = ['sections/main', 'stars/x', 'tags/y', 'tombstones/z', 'cards', '', 'cards/a/b', 'cards/a/updates/1', 'cards/a/updates/1/extra/2', 'x'];
	const CONTENT_FIELDS = ['body', 'title', 'references', 'references_info', 'published', 'notes', 'todo', 'tags', 'section', 'images', 'font_size_boost', 'updated_substantive', 'nlp_tokens'];

	it('isTopLevelDocPath is true for cards/{id} and false for everything else in the domain', () => {
		for (const id of CARD_IDS) assert.strictEqual(isTopLevelDocPath('cards/' + id, CARDS), true, `cards/${id}`);
		for (const p of NON_CARD_PATHS) assert.strictEqual(isTopLevelDocPath(p, CARDS), false, `"${p}"`);
	});

	it('cardWriteViolation: a violation IFF top-level card path AND no sentinel', () => {
		for (const id of CARD_IDS) {
			const p = 'cards/' + id;
			assert.strictEqual(cardWriteViolation(p, CARDS, true), null, `sentinel present must be compliant: ${p}`);
			const v = cardWriteViolation(p, CARDS, false);
			assert.ok(v && v.includes('updateWithoutTimestampBump') && v.includes(p),
				`no-sentinel card write must violate, name the hatch, and name the path: ${p}`);
		}
	});

	it('cardWriteViolation: never a violation for a non-top-level-card path (sentinel or not)', () => {
		for (const p of NON_CARD_PATHS) {
			for (const hasSentinel of [true, false]) {
				assert.strictEqual(cardWriteViolation(p, CARDS, hasSentinel), null, `must be inert for "${p}" (sentinel=${hasSentinel})`);
			}
		}
	});

	it('nonBump: every counter-only card write (all 1- and 2-field subsets) is allowed', () => {
		const allowed = [...COUNTER_FIELDS];
		for (const a of allowed) assert.strictEqual(nonBumpCardWriteViolation('cards/x', CARDS, [a]), null, `single counter allowed: ${a}`);
		for (let i = 0; i < allowed.length; i++) {
			for (let j = i; j < allowed.length; j++) {
				assert.strictEqual(nonBumpCardWriteViolation('cards/x', CARDS, [allowed[i], allowed[j]]), null, `counter pair allowed: ${allowed[i]},${allowed[j]}`);
			}
		}
	});

	it('nonBump: any content field (alone or mixed with a counter) violates and is named', () => {
		for (const c of CONTENT_FIELDS) {
			const vAlone = nonBumpCardWriteViolation('cards/x', CARDS, [c]);
			assert.ok(vAlone && vAlone.includes(c), `content field alone must violate + be named: ${c}`);
			for (const a of COUNTER_FIELDS) {
				const vMixed = nonBumpCardWriteViolation('cards/x', CARDS, [a, c]);
				assert.ok(vMixed && vMixed.includes(c), `content field smuggled alongside a counter must still violate + name it: ${a}+${c}`);
			}
		}
	});

	it('nonBump: adding any key never clears an existing violation (monotonicity — no smuggling)', () => {
		for (const c of CONTENT_FIELDS) {
			assert.ok(nonBumpCardWriteViolation('cards/x', CARDS, [c]), `precondition: ${c} violates`);
			for (const extra of [...COUNTER_FIELDS, ...CONTENT_FIELDS]) {
				assert.ok(nonBumpCardWriteViolation('cards/x', CARDS, [c, extra]), `adding ${extra} must not clear the ${c} violation`);
			}
		}
	});

	it('nonBump: inert for non-card and subcollection paths regardless of keys', () => {
		for (const p of NON_CARD_PATHS) {
			assert.strictEqual(nonBumpCardWriteViolation(p, CARDS, ['body', 'title', 'anything']), null, `must be inert for "${p}"`);
		}
	});

	//The violation messages ARE the guard's developer-facing contract — pin
	//their load-bearing content (the escape hatch, the design doc, the
	//comma-listed offending + allowed fields, and the fix) so a future edit
	//that guts the guidance is caught. (Also kills the message-text mutants
	//that survive the behavioural assertions above.)
	it('violation messages pin their load-bearing guidance', () => {
		const cw = cardWriteViolation('cards/xyz', CARDS, false);
		assert.ok(cw.includes('Every card mutation must bump'), 'cardWriteViolation states the rule');
		assert.ok(cw.includes('docs/corpus-sync-design.md'), 'cardWriteViolation names the design doc');
		assert.ok(cw.includes('updateWithoutTimestampBump'), 'cardWriteViolation names the escape hatch');

		const nb = nonBumpCardWriteViolation('cards/xyz', CARDS, ['body', 'title']);
		assert.ok(nb.includes('body, title'), 'nonBump lists the disallowed fields comma-separated');
		assert.ok(nb.includes('reader-driven counters'), 'nonBump explains the exemption');
		assert.ok(nb.includes('star_count, star_count_manual'), 'nonBump lists the allowlist comma-separated');
		assert.ok(nb.includes('); '), 'nonBump closes the allowlist parenthetical');
		assert.ok(nb.includes('use update()'), 'nonBump points to the fix');
	});
});

//---------------------------------------------------------------------------
//Guard <-> rules DRIFT GATE. The client guard allowlist and the security
//rules encode the SAME policy, authored together — so this is NOT an
//independence oracle that proves the policy correct. It is a drift-regression
//gate: it fails if the two DIVERGE, which is the real risk (it would have
//caught the tweet_favorite_count/tweet_retweet_count mismatch fixed in
//ebe85506). A field the guard lets a client write without bumping `updated`
//that the rules reject == broken editing; the reverse == a client that can
//skip the bump undetected.
//---------------------------------------------------------------------------
describe('updated-invariant guard↔rules drift gate', () => {
	let COUNTER_FIELDS;

	before(async () => {
		({COUNTER_FIELDS_EXEMPT_FROM_UPDATED: COUNTER_FIELDS} = await import('../../lib/src/card-write-guard.js'));
	});

	//The card fields the rules permit to be written WITHOUT bumping `updated`:
	//the quoted string literals inside the cardEditLegal{Stars,Messages,Tweets}
	//helper bodies of the rules TEMPLATE (the tracked source; firestore.rules
	//is generated). In those bodies every quoted string is a field name (args
	//to editOnly* helpers / hasOnly([...])).
	const rulesNonBumpFields = () => {
		const rules = fs.readFileSync(path.join(process.cwd(), 'firestore.TEMPLATE.rules'), 'utf8');
		const fields = new Set();
		//starCountMovesWithOwnStar is where the star field names now live: the
		//star rule was split out so the counters could be bound to the user's
		//own star document. Without it in this list the gate reports a false
		//drift for star_count/star_count_manual.
		for (const fn of ['cardEditLegalStars', 'starCountMovesWithOwnStar', 'cardEditLegalMessages', 'cardEditLegalTweets']) {
			const start = rules.indexOf('function ' + fn);
			assert.ok(start >= 0, `rules must define ${fn}`);
			const rest = rules.slice(start);
			const end = rest.indexOf('\n    }');
			assert.ok(end > 0, `could not find end of ${fn}`);
			const body = rest.slice(0, end);
			for (const m of body.matchAll(/'([a-z_]+)'/g)) fields.add(m[1]);
		}
		return fields;
	};

	it('the guard no-bump allowlist exactly equals the rules non-bump fields', () => {
		const rulesFields = rulesNonBumpFields();
		//Canary: extraction actually found fields (guard against a silent empty set).
		assert.ok(rulesFields.size >= 5, `rules field extraction looks broken, found ${rulesFields.size}`);
		const guardSet = new Set(COUNTER_FIELDS);
		const onlyInGuard = [...guardSet].filter(f => !rulesFields.has(f)).sort();
		const onlyInRules = [...rulesFields].filter(f => !guardSet.has(f)).sort();
		assert.deepStrictEqual({onlyInGuard, onlyInRules}, {onlyInGuard: [], onlyInRules: []},
			'guard allowlist (card-write-guard.ts COUNTER_FIELDS_EXEMPT_FROM_UPDATED) and rules non-bump fields ' +
			'(cardEditLegal{Stars,Messages,Tweets}) have DRIFTED — re-align them.');
	});
});

//---------------------------------------------------------------------------
//Guard cost micro-bench (informational). The pure-core policy check runs once
//per card set/update; this bounds it as O(1) and negligible against the 200ms
//commit budget. Deliberately a LOOSE smoke ceiling, not a tight wall-clock
//gate (CI hardware varies — the printed per-call figure is the real datum).
//NOTE: this covers the pure core only; the full guard also calls
//isServerTimestampSentinel (a WeakMap.get + an occasional JSON.stringify of a
//tiny FieldValue), which lives in firebase.ts and cannot be imported in Node —
//it is likewise O(1). End-to-end commit latency is the browser harness's job.
//---------------------------------------------------------------------------
describe('updated-invariant guard cost (micro-bench, informational)', () => {
	let cardWriteViolation, nonBumpCardWriteViolation;

	before(async () => {
		({cardWriteViolation, nonBumpCardWriteViolation} = await import('../../lib/src/card-write-guard.js'));
	});

	it('2e6 pure-core policy checks complete well under the commit budget', function() {
		this.timeout(10000);
		const N = 1_000_000;
		const t0 = process.hrtime.bigint();
		for (let i = 0; i < N; i++) {
			cardWriteViolation('cards/abc', CARDS, (i & 1) === 0);
			nonBumpCardWriteViolation('cards/abc', CARDS, ['star_count', 'tweet_count']);
		}
		const ms = Number(process.hrtime.bigint() - t0) / 1e6;
		const perCallNs = (ms * 1e6) / (N * 2);
		//eslint-disable-next-line no-console
		console.log(`      [micro-bench] ${N * 2} pure-core policy checks in ${ms.toFixed(1)}ms (${perCallNs.toFixed(1)} ns/call)`);
		assert.ok(ms < 3000, `2e6 policy checks took ${ms.toFixed(0)}ms — unexpectedly slow for O(1) checks`);
	});
});

describe('MultiBatchBase chokepoint wiring (the enforcement, not just the policy)', () => {
	//These tests close the hole the adversarial audit named: deleting the
	//guard call inside the batch implementation used to pass every test in
	//the repo while the pure-policy mutation score stayed 100%. They drive
	//the SHARED base class — the single implementation both the client and
	//the admin MultiBatch now inherit — with a stub SDK config, so a
	//regression in the wiring itself fails loudly here.
	let MultiBatchBase;
	let MULTI_BATCH_COMMIT_CONCURRENCY;
	let commitFanoutThenMarker;

	before(async () => {
		({MultiBatchBase, MULTI_BATCH_COMMIT_CONCURRENCY} = await import('../../lib/shared/multi_batch.js'));
		({commitFanoutThenMarker} = await import('../../lib/src/durable-fanout.js'));
	});

	const SENTINEL = {__serverTimestamp: true};

	const makeBatch = (withGuard = true, effectiveBatchLimit) => {
		const writes = [];
		const config = {
			createBatch: () => ({}),
			batchSet: (_batch, ref, data) => writes.push({op: 'set', path: ref.path, data}),
			batchUpdate: (_batch, ref, data) => writes.push({op: 'update', path: ref.path, data}),
			batchDelete: (_batch, ref) => writes.push({op: 'delete', path: ref.path}),
			commitBatch: async () => {},
		};
		if (withGuard) {
			config.cardWriteGuard = {
				cardsCollection: 'cards',
				refPath: ref => ref.path,
				isServerTimestampValue: value => value === SENTINEL,
			};
		}
		return {batch: new MultiBatchBase(config, effectiveBatchLimit), writes, config};
	};

	const ref = (path) => ({path});

	it('update on a card without the sentinel THROWS and queues nothing', () => {
		const {batch, writes} = makeBatch();
		assert.throws(() => batch.update(ref('cards/c-123-abcdef'), {body: 'hi'}), /does not set updated/);
		assert.strictEqual(writes.length, 0);
	});

	it('set on a card without the sentinel THROWS (create path is guarded too)', () => {
		const {batch} = makeBatch();
		assert.throws(() => batch.set(ref('cards/c-123-abcdef'), {body: 'hi'}), /does not set updated/);
	});

	it('card write WITH the sentinel is queued', () => {
		const {batch, writes} = makeBatch();
		batch.update(ref('cards/c-123-abcdef'), {body: 'hi', updated: SENTINEL});
		batch.set(ref('cards/c-456-ghijkl'), {body: 'new', updated: SENTINEL});
		assert.strictEqual(writes.length, 2);
	});

	it('non-card and subcollection writes are never guarded', () => {
		const {batch, writes} = makeBatch();
		batch.update(ref('sections/main'), {title: 'x'});
		batch.set(ref('cards/c-123-abcdef/updates/12345'), {diff: {}});
		assert.strictEqual(writes.length, 2);
	});

	it('updateWithoutTimestampBump admits counters and REJECTS content', () => {
		const {batch, writes} = makeBatch();
		batch.updateWithoutTimestampBump(ref('cards/c-123-abcdef'), {star_count: 2, star_count_manual: 2});
		assert.strictEqual(writes.length, 1);
		assert.throws(() => batch.updateWithoutTimestampBump(ref('cards/c-123-abcdef'), {body: 'smuggled'}), /non-counter field/);
		assert.strictEqual(writes.length, 1);
	});

	it('a config without cardWriteGuard enforces nothing (opt-in)', () => {
		const {batch, writes} = makeBatch(false);
		batch.update(ref('cards/c-123-abcdef'), {body: 'hi'});
		assert.strictEqual(writes.length, 1);
	});

	it('waits for every underlying commit before reporting partial failure', async () => {
		const {batch, config} = makeBatch(false, 1);
		batch.update(ref('sections/one'), {title: 'one'});
		batch.update(ref('sections/two'), {title: 'two'});

		let finishSecondCommit;
		const secondCommit = new Promise(resolve => { finishSecondCommit = resolve; });
		let commitIndex = 0;
		config.commitBatch = async () => {
			commitIndex++;
			if (commitIndex === 1) throw new Error('first failed');
			await secondCommit;
		};

		let settled = false;
		const committed = batch.commit().catch(error => {
			settled = true;
			return error;
		});
		await Promise.resolve();
		await Promise.resolve();
		assert.strictEqual(settled, false, 'must not reject while another commit is still in flight');
		finishSecondCommit();
		const error = await committed;
		assert.strictEqual(error.name, 'MultiBatchCommitError');
		assert.strictEqual(error.succeededBatchCount, 1);
		assert.strictEqual(error.failedBatchCount, 1);
		assert.match(error.message, /1 of 2 Firestore batches failed/);
	});

	it('rolls to a new batch rather than splitting an atomic group', async () => {
		const committedBatches = [];
		let nextBatchID = 0;
		const config = {
			createBatch: () => ({id: ++nextBatchID, writes: []}),
			batchSet: (batch, ref) => batch.writes.push(ref.path),
			batchUpdate: (batch, ref) => batch.writes.push(ref.path),
			batchDelete: (batch, ref) => batch.writes.push(ref.path),
			commitBatch: async batch => { committedBatches.push(batch); },
		};
		const batch = new MultiBatchBase(config, 3);
		batch.update(ref('sections/one'), {});
		batch.update(ref('sections/two'), {});
		batch.beginAtomicGroup();
		batch.update(ref('cards/a/updates/one'), {});
		batch.update(ref('sections/three'), {});
		batch.endAtomicGroup();
		await batch.commit();
		assert.deepStrictEqual(committedBatches.map(item => item.writes), [
			['sections/one', 'sections/two'],
			['cards/a/updates/one', 'sections/three'],
		]);
	});

	it('splits an oversized atomic group across batches with the groupID on every batch it spans', async () => {
		//An edit whose fanout exceeds one Firestore batch can't be atomic at
		//all; refusing made such cards permanently unsavable. The split
		//attaches the groupID to EVERY spanned batch, so a partial failure
		//reports the group as both succeeded and failed -> the recovery
		//layer treats its cards as ambiguous and re-reads server state.
		const committedBatches = [];
		const config = {
			createBatch: () => ({writes: []}),
			batchSet: (batch, ref) => batch.writes.push(ref.path),
			batchUpdate: (batch, ref) => batch.writes.push(ref.path),
			batchDelete: (batch, ref) => batch.writes.push(ref.path),
			commitBatch: async batch => { committedBatches.push(batch); },
		};
		const batch = new MultiBatchBase(config, 1);
		batch.beginAtomicGroup('huge');
		batch.update(ref('sections/one'), {});
		batch.update(ref('sections/two'), {});
		batch.endAtomicGroup();
		await batch.commit();
		assert.deepStrictEqual(committedBatches.map(item => item.writes), [
			['sections/one'],
			['sections/two'],
		]);
		//The recovery contract: the group is attributed to BOTH batches.
		assert.deepStrictEqual(batch._atomicBatches.map(item => item.groupIDs), [
			['huge'],
			['huge'],
		]);
	});

	it('never commits an oversized-operation marker after a partial fanout failure', async () => {
		const calls = [];
		const fanout = {
			commit: async () => {
				calls.push('fanout-prefix');
				throw new Error('one split batch failed');
			},
		};
		const marker = {commit: async () => { calls.push('marker'); }};
		await assert.rejects(commitFanoutThenMarker(fanout, marker), /split batch failed/);
		assert.deepStrictEqual(calls, ['fanout-prefix']);
	});

	it('commits an oversized-operation marker only after the complete fanout', async () => {
		const calls = [];
		await commitFanoutThenMarker(
			{commit: async () => { calls.push('fanout-complete'); }},
			{commit: async () => { calls.push('marker'); }},
		);
		assert.deepStrictEqual(calls, ['fanout-complete', 'marker']);
	});

	it('starts no commits when SDK validation throws while materializing an atomic batch', async () => {
		let commitCount = 0;
		const config = {
			createBatch: () => ({writes: []}),
			batchSet: (batch, ref) => batch.writes.push(ref.path),
			batchUpdate: (batch, ref) => {
				if (ref.path === 'sections/bad') throw new Error('SDK validation failed');
				batch.writes.push(ref.path);
			},
			batchDelete: (batch, ref) => batch.writes.push(ref.path),
			commitBatch: async () => { commitCount++; },
		};
		const batch = new MultiBatchBase(config, 3);
		batch.beginAtomicGroup();
		batch.update(ref('sections/good'), {});
		batch.update(ref('sections/bad'), {});
		batch.endAtomicGroup();
		await assert.rejects(batch.commit(), /SDK validation failed/);
		assert.strictEqual(commitCount, 0, 'no batch may reach the server after materialization fails');
	});

	it('bounds underlying Firestore commit concurrency', async () => {
		let active = 0;
		let maximumActive = 0;
		const config = {
			createBatch: () => ({}),
			batchSet: () => {},
			batchUpdate: () => {},
			batchDelete: () => {},
			commitBatch: async () => {
				active++;
				maximumActive = Math.max(maximumActive, active);
				await new Promise(resolve => setTimeout(resolve, 2));
				active--;
			},
		};
		const batch = new MultiBatchBase(config, 1);
		for (let i = 0; i < MULTI_BATCH_COMMIT_CONCURRENCY * 3; i++) {
			batch.update(ref(`sections/${i}`), {});
		}
		await batch.commit();
		assert.strictEqual(maximumActive, MULTI_BATCH_COMMIT_CONCURRENCY);
	});

	it('allows callers to serialize conflict-prone underlying commits', async () => {
		let active = 0;
		let maximumActive = 0;
		const config = {
			createBatch: () => ({}),
			batchSet: () => {},
			batchUpdate: () => {},
			batchDelete: () => {},
			commitConcurrency: 1,
			commitBatch: async () => {
				active++;
				maximumActive = Math.max(maximumActive, active);
				await new Promise(resolve => setTimeout(resolve, 2));
				active--;
			},
		};
		const batch = new MultiBatchBase(config, 1);
		for (let i = 0; i < 4; i++) batch.update(ref(`sections/${i}`), {});
		await batch.commit();
		assert.strictEqual(maximumActive, 1);
	});

	it('reports card-group membership for successful and failed split batches', async () => {
		let commitIndex = 0;
		const config = {
			createBatch: () => ({}),
			batchSet: () => {},
			batchUpdate: () => {},
			batchDelete: () => {},
			commitBatch: async () => {
				commitIndex++;
				if (commitIndex === 2) throw new Error('second batch failed');
			},
		};
		const batch = new MultiBatchBase(config, 1);
		batch.beginAtomicGroup('card-a');
		batch.update(ref('sections/a'), {});
		batch.endAtomicGroup();
		batch.beginAtomicGroup('card-b');
		batch.update(ref('sections/b'), {});
		batch.endAtomicGroup();
		const error = await batch.commit().catch(value => value);
		assert.deepStrictEqual(error.succeededGroupIDs, ['card-a']);
		assert.deepStrictEqual(error.failedGroupIDs, ['card-b']);
	});
});
