/*eslint-env node, es2022*/

//The pure part of the paged embedding reindex (#783). The function loaded
//every card and every Qdrant point with its vector into one 1 GiB process and
//died out of memory on every deploy since Sept 20, silently. It now walks
//cards in pages, decides per card from the point's payload alone, and reports
//each page to the deploy. The pure part lives in shared/ (built by
//build:shared, which CI runs; CI never installs functions/node_modules), and
//embeddings.ts itself initializes Firebase, OpenAI and Qdrant at load.

import assert from 'assert';
import {readFileSync} from 'fs';

const {reindexDecision, nextCursorFor, pageOverBudget, chunked, DEFAULT_REINDEX_PAGE_SIZE, UNCHANGED_PAYLOAD_BATCH, PAGE_TIME_BUDGET_MS} = await import('../../shared/dist/reindex-paging.js');

describe('paged embedding reindex', () => {
	it('decides per card from the point payload: touch when current, reuse the vector when only the version is old, embed when the content changed or there is no point', () => {
		const V = 3;
		assert.strictEqual(reindexDecision('body', {content: 'body', extraction_version: 3}, V), 'touch');
		assert.strictEqual(reindexDecision('body', {content: 'body', extraction_version: 2}, V), 'reuse-vector');
		assert.strictEqual(reindexDecision('body', {content: 'body'}, V), 'reuse-vector', 'a point with no version is version 0');
		assert.strictEqual(reindexDecision('body', {content: 'old body', extraction_version: 3}, V), 'embed');
		assert.strictEqual(reindexDecision('body', null, V), 'embed');
		assert.strictEqual(reindexDecision('body', undefined, V), 'embed');
	});

	it('pages: a full page continues after its last id, a short page ends the walk, and a page cut by its time budget continues inside itself', () => {
		assert.strictEqual(nextCursorFor('c-zzz', 500, 500, 500), 'c-zzz');
		assert.strictEqual(nextCursorFor('c-zzz', 499, 499, 500), null);
		assert.strictEqual(nextCursorFor(null, 0, 0, 500), null);
		assert.strictEqual(nextCursorFor('c-120', 120, 500, 500), 'c-120', 'a page that stopped at its 120th card resumes after it');
		assert.strictEqual(nextCursorFor('c-120', 120, 300, 500), 'c-120', 'even when the page was the last one, the unprocessed tail must still be walked');
		//The budget: Node's fetch gives up on headers after 300 s; a page of
		//fresh embeddings is 500 sequential model calls.
		assert.ok(PAGE_TIME_BUDGET_MS < 300 * 1000 && PAGE_TIME_BUDGET_MS >= 60 * 1000);
		assert.strictEqual(pageOverBudget(0, PAGE_TIME_BUDGET_MS, 0), false, 'never stop before the first card is processed');
		assert.strictEqual(pageOverBudget(0, PAGE_TIME_BUDGET_MS - 1, 10), false);
		assert.strictEqual(pageOverBudget(0, PAGE_TIME_BUDGET_MS, 10), true);
		assert.strictEqual(DEFAULT_REINDEX_PAGE_SIZE, 500);
		assert.ok(UNCHANGED_PAYLOAD_BATCH > 0 && UNCHANGED_PAYLOAD_BATCH <= DEFAULT_REINDEX_PAGE_SIZE);
		assert.deepStrictEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
		assert.deepStrictEqual(chunked([], 2), []);
	});

	it('the function reads one page per request, never the whole corpus or every vector, and the deploy reads every page', () => {
		const strip = (text) => text.replace(/\/\/[^\n]*/g, '');
		const embeddings = strip(readFileSync(new URL('../../functions/src/embeddings.ts', import.meta.url), 'utf8'));
		const reindex = embeddings.slice(embeddings.indexOf('export const reindexCardEmbeddings'), embeddings.indexOf('export const cleanupOldEmbeddings'));
		assert.ok(!/getCards\(\)/.test(reindex), 'the reindex must not load every card');
		assert.match(reindex, /orderBy\(FieldPath\.documentId\(\)\)\.limit\(pageSize\)/, 'cards come one page at a time');
		assert.match(reindex, /startAfter\(cursor\)/);
		assert.match(reindex, /with_vector: false/, 'the page lookup carries payloads only');
		assert.match(reindex, /match: \{any: ids\}/, 'and only the page\'s own points — without the filter every card would fall through to a per-card fetch');
		assert.match(reindex, /if \(pageOverBudget\(startedAt, Date\.now\(\), result\.processed\)\) break;/, 'a page stops taking cards past its time budget');
		assert.match(reindex, /try \{\s*const text = textContentForEmbeddingForCard\(card\);/, 'text extraction is inside the per-card try: a malformed document is one failure, not the end of the page (the first DEV walk aborted page 94 on one)');
		assert.match(reindex, /\} finally \{[\s\S]{0,200}chunked\(toTouch, UNCHANGED_PAYLOAD_BATCH\)/, 'collected touches land even when the page aborts');
		assert.match(reindex, /nextCursorFor\(lastProcessedID, result\.processed, cards\.length, pageSize\)/);
		assert.ok(!/limit: MAX_EMBEDDINGS/.test(reindex), 'never a scroll of every point');
		const index = strip(readFileSync(new URL('../../functions/src/index.ts', import.meta.url), 'utf8'));
		assert.match(index, /reindexCardEmbeddingsImpl\(cursor, pageSize\)/, 'the handler passes the page through');
		assert.match(index, /res\.status\(200\)\.json\(result\)/, 'and returns the page result');
		const cli = strip(readFileSync(new URL('../../tools/cli.ts', import.meta.url), 'utf8'));
		const step = cli.slice(cli.indexOf('const reindexCardEmbeddings'), cli.indexOf('const cleanupOldEmbeddings'));
		assert.ok(!/runBackground/.test(step), 'the deploy no longer fires the reindex and forgets it');
		assert.match(step, /if \(!response\.ok\) throw new Error/, 'an HTTP failure fails the step');
		assert.match(step, /reindexResumeHint\(projectId, cursor\)\}\): HTTP/, 'and names the cursor to resume from, before the body');
		assert.match(step, /catch \(err\) \{\s*throw new Error\(`reindexCardEmbeddings page \$\{page\} failed \(\$\{reindexResumeHint/, 'a fetch that throws carries the cursor too');
		assert.match(step, /if \(!result\.nextCursor\) break;/, 'it loops until the walk is done');
		assert.match(step, /if \(totals\.failed\) throw new Error/, 'card failures fail the standalone command');
		assert.match(step, /const reindexAfterDeploy = async[\s\S]{0,200}try \{\s*await reindexCardEmbeddings\(\);\s*\} catch/, 'but the deploy reports a reindex failure instead of failing after everything shipped');
		assert.strictEqual((cli.match(/await reindexAfterDeploy\(\);/g) || []).length, 2, 'both deploys use the reporting wrapper');
		assert.strictEqual((cli.match(/await reindexCardEmbeddings\(reindexCursorArg\(\)\);/g) || []).length, 2, 'both standalone commands accept --cursor');
	});
});
