import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

describe('multi-edit acceptance coverage', () => {
	it('keeps every UI-expressible CardDiff field in the production-build round trip', () => {
		const selectors = read('src/selectors.ts');
		const selectorStart = selectors.indexOf('export const selectMultiEditCardDiff');
		const selectorEnd = selectors.indexOf('export const selectBulkImportDialogExportContent', selectorStart);
		assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, 'could not isolate selectMultiEditCardDiff');
		const selectorBody = selectors.slice(selectorStart, selectorEnd);
		const expressedFields = [...selectorBody.matchAll(/result\.([a-z_]+)\s*=/g)].map(match => match[1]);
		assert.deepStrictEqual(new Set(expressedFields), new Set([
			'references_diff',
			'add_tags',
			'remove_tags',
			'auto_todo_overrides_enablements',
			'auto_todo_overrides_disablements',
			'published',
		]));

		const harness = read('src/perf-harness-api.ts');
		const roundTripStart = harness.indexOf('durableMultiEditRoundTrip: async');
		const roundTripEnd = harness.indexOf('\n\t\t},\n\t};', roundTripStart);
		assert.ok(roundTripStart >= 0 && roundTripEnd > roundTripStart, 'could not isolate durableMultiEditRoundTrip');
		const roundTrip = harness.slice(roundTripStart, roundTripEnd);
		for (const field of expressedFields) {
			assert.match(roundTrip, new RegExp(`\\b${field}\\b`), `${field} is not exercised by the generic round trip`);
		}
		assert.match(roundTrip, /references_diff:[\s\S]*value: ''/i, 'reference addition is not exercised');
		assert.match(roundTrip, /references_diff:[\s\S]*delete: true/i, 'reference removal is not exercised');
		assert.match(roundTrip, /published: true/i, 'publish is not exercised');
		assert.match(roundTrip, /published: false/i, 'unpublish is not exercised');
	});

	it('enforces the 20 second ceiling for both bulk paths', () => {
		const runner = read('test/perf-harness/run.js');
		assert.match(runner, /result\.addMs > 20000 \|\| result\.removeMs > 20000/);
		assert.match(runner, /general\.applyMs > 20000 \|\| general\.restoreMs > 20000/);
	});

	it('keeps active progress truthful and the covered edit form unreachable', () => {
		const dialog = read('src/components/multi-edit-dialog.ts');
		assert.match(dialog, /serverConfirmed \? 'server-confirmed' : 'processed safely'/);
		assert.doesNotMatch(dialog, /bulkTagProgress\.total} server-confirmed/,
			'generic progress must not be labelled server-confirmed');
		assert.match(dialog, /class='edit-form' \?inert=\$\{this\._cardModificationPending}/,
			'the form beneath the active scrim must be inert');
		assert.match(dialog, /aria-hidden=\$\{this\._cardModificationPending \? 'true' : 'false'}/,
			'the form beneath the active scrim must be hidden from assistive technology');
	});

	it('does not rewrite body-derived NLP during a reference-only multi-edit', () => {
		const actions = read('src/actions/data.ts');
		const changedStart = actions.indexOf('const contentFieldsChanged =');
		const changedEnd = actions.indexOf('\n\n\tif (contentFieldsChanged)', changedStart);
		assert.ok(changedStart >= 0 && changedEnd > changedStart,
			'could not isolate the stored-NLP regeneration predicate');
		assert.doesNotMatch(actions.slice(changedStart, changedEnd), /references_diff/,
			'reference-only edits must not regenerate stored NLP from a stale body snapshot');
		assert.match(actions, /modifyCardWithBatch\(state, authoritative\.cards\[id\],[\s\S]*false, true\)/,
			'durable dialog edits must suppress unrelated card-finisher fields');
	});
});
