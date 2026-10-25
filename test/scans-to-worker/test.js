/*eslint-env node, es2022*/

//THE WHOLE-CORPUS SCANS THAT RAN ON THE MAIN THREAD NOW RUN IN THE WORKER
//(#777, option A step 2). Three surfaces evaluated configurable filters over
//every card on the main thread: the info panel's "In this collection"
//verdicts (about once a second while open), the hover preview's reference
//blocks (the missing-concept block of a concept card), and the find dialog's
//query collection while editing (from before the editing card was mirrored
//into the worker). The engine's own answer is covered behaviourally in
//test/query-engine; these are source pins on the call sites, because each
//fact is about WHICH path a component takes, and a mounted component would
//assert less than the line that decides it.

import assert from 'assert';
import {readFile} from 'fs/promises';

const read = async (path) => {
	const source = await readFile(new URL('../../' + path, import.meta.url), 'utf8');
	//Comments stripped, so a pin cannot be satisfied by prose.
	return source.replace(/^\s*\/\/.*$/gm, '');
};

const between = (source, start, end) => {
	const from = source.indexOf(start);
	assert.ok(from >= 0, `missing ${start}`);
	const to = source.indexOf(end, from);
	assert.ok(to > from, `missing ${end} after ${start}`);
	return source.slice(from, to);
};

describe('the why-here verdicts come from the worker', () => {
	it('the info panel asks the worker and treats the local selector as the no-worker fallback', async () => {
		const source = await read('src/components/card-info-panel.ts');
		const request = between(source, '_requestWhyHere(freshState : State, freshCardID : CardID) {', '_commitWhyHere(cardID : CardID');
		assert.match(request, /corpusWorkerCollectionMembership\(serialized, expression, freshCardID\)/, 'the verdicts are requested from the worker');
		//Every local computation sits behind "the worker never serves".
		const localCalls = request.split('selectWhyHereForActiveCard(').length - 1;
		assert.strictEqual(localCalls, 2, 'one local fallback per branch: not ready, and failed');
		assert.match(request, /if \(corpusWorkerServesCollections\(\)\) return;\s*const whyHere = selectWhyHereForActiveCard\(freshState\)/, 'a serving worker that is not ready holds the previous account');
		assert.match(request, /if \(corpusWorkerServesCollections\(\)\) return release\(\);\s*const whyHere = selectWhyHereForActiveCard\(currentState\)/, 'a failed request holds too while the worker serves, and is asked again');
		//A reply commits only for the card and the collection it was asked about.
		assert.match(request, /if \(!sectionResultCommits\(freshCardID, selectActiveCard\(currentState\)\?\.id \|\| ''\)\) return release\(\);/);
		assert.match(request, /if \(selectActiveCollectionDescription\(currentState\)\?\.serialize\(\) !== serialized\) return release\(\);/);
		assert.match(request, /if \(!this\._open\) return release\(\);/, 'a reply after the panel closed is dropped');
		//The reply is checked against the collection ON SCREEN, which may be an older push than the worker judged.
		assert.match(request, /const matched = selectActiveCollection\(currentState\)\?\.matchedCard\(freshCardID\) \?\? null;\s*if \(matched !== null && matched !== membership\.passes\) membership = null;/);
		//Asked on the old selector's cadence: once per (card, active collection), not per debounce fire.
		assert.match(request, /if \(requested && requested\.cardID === freshCardID && requested\.collection === collection\) return;/);
		//The debounce still owns the request: no synchronous whole-corpus path remains in it.
		const timeout = between(source, 'this._expensivePropertiesTimeout = window.setTimeout(', 'override async updated(');
		assert.ok(!/selectWhyHereForActiveCard\(/.test(timeout.slice(0, timeout.indexOf('_requestWhyHere(freshState : State'))), 'the timeout body does not compute the account itself');
	});

	it('the bridge bounds the request like a collection run and resolves null on failure', async () => {
		const source = await read('src/corpus-bridge.ts');
		const rpc = between(source, 'export const corpusWorkerCollectionMembership = (', 'let lastShadowLogLine');
		assert.match(rpc, /if \(!corpusWorkerCanRunCollections\(\)\) return null;/);
		assert.match(rpc, /\}, RUN_COLLECTION_TIMEOUT_MS\);/, 'the wait is bounded');
		assert.match(rpc, /type: 'collectionMembership'/);
		const reply = between(source, 'case \'collectionMembershipResult\': {', 'case \'suggestTagsResult\': {');
		assert.match(reply, /resolve\(message\.failed \? null : \{membership: message\.membership, ms: message\.ms\}\)/);
	});

	it('the worker replies with the request id even when the engine throws', async () => {
		const source = await read('src/worker/corpus-worker.ts');
		const handler = between(source, 'case \'collectionMembership\': {', 'case \'requestCorpusIDs\':');
		assert.match(handler, /engine\.collectionMembership\(message\.description, message\.expression, message\.cardID, \{/);
		assert.match(handler, /catch \(e\) \{[\s\S]*id: message\.id, membership: null, ms: 0, failed: true/);
	});

	it('the engine answers over the whole corpus, never a narrowed universe, and never defers on a cold map', async () => {
		const source = await read('src/worker/query-engine.ts');
		const method = between(source, 'collectionMembership(serializedDescription : string', 'return membership;');
		assert.match(method, /this\._collectionArguments\(description, \{\.\.\.options, deferWhenSimilarityCold: false\}, false\)/);
		assert.match(method, /const matched = collection\.matchedCard\(cardID\);\s*if \(matched !== null && matched !== membership\.passes\) return null;/, 'the account is checked against the artifact');
		const run = between(source, 'runCollection(serializedDescription : string', 'collectionMembership(serializedDescription');
		assert.match(run, /this\._collectionArguments\(description, options, true\)/, 'collection runs still narrow');
	});
});

describe('the hover preview expands its blocks in the worker', () => {
	it('main-view requests the blocks through the runner and keeps the sync selector for a worker that never serves', async () => {
		const source = await read('src/components/main-view.ts');
		const update = between(source, '_updatePreviewCardReferenceBlocks(state : State) {', 'override stateChanged(state : State) {');
		assert.match(update, /expandReferenceBlocksViaRunner\(\s*card,\s*primaryReferenceBlocksForCard\(card\),\s*selectCollectionConstructorArguments\(state\),\s*selectCardIDsUserMayEdit\(state\),\s*corpusWorkerRunCollection\s*\)/);
		assert.match(update, /this\._setPreviewCardReferenceBlocks\(corpusWorkerServesCollections\(\) \? NO_REFERENCE_BLOCKS : selectExpandedPrimaryReferenceBlocksForPreviewCard\(state\)\);/, 'not ready: hold empty; never serves: compute locally');
		assert.match(update, /this\._previewBlocksRequestedCard = card;\s*this\._setPreviewCardReferenceBlocks\(NO_REFERENCE_BLOCKS\);/, 'a new request starts from no blocks');
		assert.match(update, /if \(this\._previewBlocksRequestedCard !== card\) return;/, 'a late reply for another preview is dropped');
		assert.match(update, /if \(blocks === null\) \{\s*this\._previewBlocksRequestedCard = null;\s*if \(corpusWorkerServesCollections\(\)\) return;/, 'a failed run holds while the worker serves, and is asked again');
		const stateChanged = between(source, 'override stateChanged(state : State) {', 'this._mayViewUnpublished =');
		assert.ok(!/selectExpandedPrimaryReferenceBlocksForPreviewCard\(state\)/.test(stateChanged), 'stateChanged no longer expands the preview blocks synchronously');
		assert.match(stateChanged, /this\._updatePreviewCardReferenceBlocks\(state\);/);
	});
});

describe('the find dialog is served by the worker while editing', () => {
	it('the bridge subscribes the query slot whenever the dialog is open', async () => {
		const source = await read('src/corpus-bridge.ts');
		const rule = between(source, 'const queryDescriptionToServe = (state : State)', ';');
		assert.match(rule, /selectFindDialogOpen\(state\) \? selectCollectionDescriptionForQuery\(state\) : null/);
		assert.ok(!/selectIsEditing/.test(rule), 'editing no longer withholds the subscription');
		//Both readers take the one rule (the fast path kept its own copy once).
		assert.match(source, /ensureSubscription\('query', queryDescriptionToServe\(state\), state\);/);
		assert.match(source, /const queryDescription = readMode\(\) === 'on' \? queryDescriptionToServe\(state\) : null;/);
		assert.strictEqual(source.split('selectCollectionDescriptionForQuery(state)').length - 1, 1, 'the query description is read in exactly one place');
	});

	it('the query collection and its preparing state take the worker result while editing', async () => {
		const source = await read('src/selectors.ts');
		const collection = between(source, 'export const selectCollectionForQuery = createSelector(', 'return description.collection(args);');
		assert.match(collection, /if \(corpusWorkerServesCollections\(\)\) \{/);
		assert.ok(!/args\.editingCard/.test(collection), 'no editing-card gate on the worker result');
		const preparing = between(source, 'export const selectFindSearchPreparing = createSelector(', 'if (!recall) return');
		assert.ok(!/editingCard/.test(preparing));
	});

	it('the worker re-runs an editing-dependent subscription on editing dirt (the mirror that makes this honest)', async () => {
		const source = await read('src/worker/corpus-worker.ts');
		assert.match(source, /if \(engine\.setEditingCard\(editingCard, message\.similarity\)\) subscriptions\.markDirty\('editing'\);/);
		const engine = await read('src/worker/query-engine.ts');
		assert.match(between(engine, '_collectionArguments(description : CollectionDescription', 'return args;'), /editingCard: this\._editingCard \|\| undefined,/);
	});
});
