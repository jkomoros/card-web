/*eslint-env node*/

//Search-recall (find narrowing) lifecycle: the pure token helper behaviorally,
//plus source pins on the worker's chunked-build wiring — the kick sites, the
//ready-gating, and the reset — in the same style as the other worker pins.
//
//A second section pins the stale-while-revalidate display contract that the
//recall index made possible: card-view, find-dialog and card-drawer must hold
//the last READY collection while a new one computes, rather than flashing
//empty, and the editor's tag suggestions must come from the worker. It lives
//here because it is the same "the index is not instant, so the UI must be
//honest about lag" property seen from the consumer side.

import assert from 'assert';
import fs from 'fs';

describe('search recall', () => {
	let queryTokensForText;

	before(async () => {
		({queryTokensForText} = await import('../../lib/src/worker/query-engine.js'));
	});

	it('tokenizes queries into the nlp_search_tokens space', () => {
		const tokens = queryTokensForText('Compounding loops strategy');
		//Stemmed, stop-word-free unigrams plus bigrams.
		assert.ok(tokens.length >= 3, JSON.stringify(tokens));
		assert.ok(tokens.some(token => token.includes(' ')), 'bigrams expected');
		assert.deepStrictEqual(queryTokensForText('the of and'), [], 'stop-word-only queries produce no tokens');
		assert.deepStrictEqual(queryTokensForText(''), []);
	});

	describe('worker wiring pins', () => {
		const worker = fs.readFileSync(new URL('../../src/worker/corpus-worker.ts', import.meta.url), 'utf8');

		it('builds chunked in the background, never synchronously on a query', () => {
			assert.ok(!worker.includes('ensureSearchIndex'), 'the synchronous on-demand rebuild must be gone');
			assert.match(worker, /const runQuery[\s\S]{0,400}scheduleSearchRecallBuild\(\)/,
				'a debug query kicks the chunked build');
			assert.match(worker, /searchRecallState === 'ready' \? index\.candidates\(tokens\) : null/,
				'queries before ready must answer with the full-scan fallback');
		});

		it('kicks the build at the prime handoff, at initial-load completion, and on find-dialog subscriptions', () => {
			assert.match(worker, /watermark prime: [\s\S]{0,800}scheduleSearchRecallBuild\(\)/,
				'prime handoff must start the low-duty background build');
			//Window widened from 300 to 420 when loadComplete gained the
			//snapshot-age field, and to 900 when initial-load completion also
			//began resuming the paused subscription flush (so the first
			//collection result rides directly behind loadComplete). The pin is
			//about the promote call still following initial-load completion,
			//not about the exact byte count.
			assert.match(worker, /initialLoadPending = null;[\s\S]{0,900}scheduleSearchRecallBuild\(\)/,
				'initial load completion must promote the build');
			assert.match(worker, /case 'subscribeCollection':[\s\S]{0,300}query\/[\s\S]{0,80}scheduleSearchRecallBuild\(\)/,
				'a query subscription is an intent signal');
		});

		it('routes card updates through the dirty set until ready, then incrementally', () => {
			assert.match(worker, /if \(searchRecallState === 'ready'\) \{[\s\S]{0,200}applyRecallEntry/,
				'post-ready updates maintain the index in place');
			assert.match(worker, /searchRecallDirtyIDs\.add\(id\)/,
				'pre-ready updates accumulate for the drain');
			assert.match(worker, /while \(searchRecallDirtyIDs\.size\)/,
				'the build must drain mid-build updates before declaring ready');
		});

		it('indexes reference-derived fields and treats stale tokens as always-scan', () => {
			assert.match(worker, /REFERENCE_RECALL_FIELDS = \['references_info_inbound', 'non_link_references', 'concept_references'\]/,
				'locally-derived scorable fields must be indexed or their matches are recall-missed');
			assert.match(worker, /nlp_version !== CURRENT_NLP_VERSION\) return null/,
				'stale-version cards must always be scanned');
			assert.match(worker, /nlp_source_fingerprint !== nlpSourceFingerprintForCard\(card\)\) return null/,
				'content-drifted cards must always be scanned');
		});

		it('resets recall on reconnect before the mass corpus removal', () => {
			const start = worker.indexOf('resetSearchRecall();');
			const removal = worker.indexOf('const staleCardIDs = [...corpus.keys()];');
			assert.ok(start >= 0 && removal > start,
				'resetSearchRecall must run before the stale-corpus removal');
			assert.match(worker, /const resetSearchRecall = [\s\S]{0,300}engine\.setSearchRecall\(null, null\)/,
				'the reset must disable engine narrowing');
		});

		it('yields between slices with an unclamped MessageChannel and keeps low duty during boot', () => {
			assert.match(worker, /const yieldToWorkerQueue[\s\S]{0,200}MessageChannel/,
				'slice yields must not use the 4ms-clamped nested setTimeout');
			assert.match(worker, /if \(initialLoadPending\) await new Promise/,
				'boot-time slices must keep a low duty cycle');
		});
	});
});

describe('stale-while-revalidate collection display (pins)', () => {
	const read = (path) => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

	it('card-view holds the last ready collection while the worker result is pending', () => {
		const view = read('src/components/card-view.ts');
		assert.match(view, /selectWorkerActiveCollectionReady\(state\)/);
		assert.match(view, /this\._collection = this\._lastReadyCollection;/,
			'a pending description must keep showing the previous collection, not honest-empty');
		assert.match(view, /COLLECTION_UPDATING_GRACE_MS/,
			'the updating affordance must wait a grace period so fast pushes never flicker');
	});

	it('find-dialog does the same for the query collection', () => {
		const dialog = read('src/components/find-dialog.ts');
		assert.match(dialog, /selectWorkerQueryCollectionReady\(state\)/);
		assert.match(dialog, /this\._collection = this\._lastReadyCollection;/);
	});

	it('the drawer labels stale content instead of blanking', () => {
		const drawer = read('src/components/card-drawer.ts');
		assert.match(drawer, /updating: boolean;/);
		assert.match(drawer, /container\.updating \.scroller/,
			'stale content must be visibly dimmed');
		assert.match(drawer, /content: 'updating/,
			'stale content must be labeled');
	});

	it('the worker computes tag suggestions off the UI thread', () => {
		const worker = read('src/worker/corpus-worker.ts');
		assert.match(worker, /case 'suggestTags':/);
		const editor = read('src/components/card-editor.ts');
		assert.match(editor, /corpusWorkerSuggestTags\(\)/,
			'the editor must request worker-served suggestions');
		assert.ok(!/this\._suggestedTags = \[\];\s*\n\s*this\._suggestedConcepts = selectEditingCardSuggestedConceptReferences/.test(editor),
			'the permanent empty-suggestions stub must be gone');
	});
});

//There is no component-mounting harness in this repo, so keyboard bindings have
//never had ANY coverage — grep test/ for shiftKey/keydown and you find only
//Shift-CLICK tests. This binding has now moved four times, and its FIRST
//incarnation was dead for its entire life because it compared e.key=='c' while
//requiring Shift (which uppercases e.key) and nothing caught it. These assert
//on the source text, the same way the pins above do.
describe('card-editor keyboard bindings (#729)', () => {
	const read = (path) => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

	it('never binds a DevTools or inspect-element combination', () => {
		const editor = read('src/components/card-editor.ts');
		//0ed8dc69 removed Cmd/Ctrl-Shift-C and -I precisely because Chrome acts
		//on them AND delivers the keydown to the page. This handler treats meta
		//and ctrl interchangeably, so neither spelling is safe on either
		//platform. Nothing currently guards that decision; this does.
		const shiftBranch = /e\.shiftKey\s*&&\s*e\.key\.toLowerCase\(\)\s*==\s*'([a-z])'/g;
		const bound = [...editor.matchAll(shiftBranch)].map(m => m[1]);
		assert.ok(bound.length > 0, 'expected at least one shifted binding to exist');
		for (const letter of bound) {
			assert.ok(!['c', 'i', 'j'].includes(letter),
				`Cmd/Ctrl-Shift-${letter.toUpperCase()} is a DevTools key and must never be bound here`);
		}
	});

	it('binds accept-all-suggested-concepts to Shift-K and kills the event', () => {
		const editor = read('src/components/card-editor.ts');
		assert.match(editor, /e\.shiftKey\s*&&\s*e\.key\.toLowerCase\(\)\s*==\s*'k'/,
			'the binding must match on e.key case-insensitively — Shift uppercases it, which is why the original never fired');
		assert.match(editor, /this\._handleAddAllConceptsClicked\(\);\s*\n\s*return killEvent\(e\);/,
			'it must preventDefault, which the removed binding never did');
	});

	it('does not blanket-swallow every other shifted key', () => {
		const editor = read('src/components/card-editor.ts');
		//`if (e.shiftKey) { ... return; }` would kill Cmd-Shift-B/I/7/8, which
		//are reachable with Caps Lock on, and on layouts where digits are the
		//shifted level.
		assert.ok(!/if\s*\(e\.shiftKey\)\s*\{/.test(editor),
			'match the specific key; a blanket shifted early-return breaks the existing execCommand shortcuts');
	});

	it('advertises the binding in both button tooltips', () => {
		const editor = read('src/components/card-editor.ts');
		//The button is rendered twice (mobile and desktop); updating only one
		//is the easy miss.
		const matches = editor.match(/Add all suggested concepts \(Cmd-Shift-K\)/g) || [];
		assert.strictEqual(matches.length, 2, 'both render sites must name the shortcut');
	});
});
