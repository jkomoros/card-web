/*eslint-env node, es2022*/

import assert from 'assert';

let navigationCommitDecision;
let normalizeNavigationPath;

describe('navigation compare-and-commit decision', () => {
	before(async () => {
		({ navigationCommitDecision, normalizeNavigationPath } = await import(
			'../../lib/src/navigation-commit.js'
		));
	});

	it('normalizes both leading-slash path forms', () => {
		assert.strictEqual(normalizeNavigationPath('c/everything/'), '/c/everything/');
		assert.strictEqual(normalizeNavigationPath('/c/everything/'), '/c/everything/');
	});

	it('does not push a duplicate history entry', () => {
		assert.deepStrictEqual(
			navigationCommitDecision('/c/everything/', 'c/everything/', false),
			{ status: 'unchanged', path: '/c/everything/', history: 'none' }
		);
	});

	//THE CASE MASTER'S GUARD COULD NEVER SEE, now that it fires. That guard read
	//`'/' + path === location.pathname`, so it matched only for the one caller
	//that passes a path with NO leading slash (canonicalizeURL, via
	//actions/collection.ts). Every other caller passes '/c/…', which compared as
	//'//c/…' and never matched — so re-asking for the collection already on
	//screen pushed a duplicate history entry and re-dispatched navigated().
	//Normalizing both sides makes the guard mean what it has always said.
	//
	//AUDITED, not assumed: the five leading-slash callers are
	//navigateToDefaultIfSectionsAndTagsLoaded, navigateToCardInCurrentCollection,
	//navigateToCardInDefaultCollection, navigateToCollection and the chat
	//destination. None depends on the re-dispatch to refresh anything — a
	//same-path navigation produces the UPDATE_PAGE it just produced — and the
	//sixth caller, askForPathToNavigateTo, has always had its own same-path
	//guard. 'unchanged' is deliberately not a refusal, so nothing reports.
	it('dedupes when BOTH paths carry the leading slash', () => {
		assert.deepStrictEqual(
			navigationCommitDecision('/c/main/', '/c/main/', false),
			{ status: 'unchanged', path: '/c/main/', history: 'none' }
		);
		//Silently, too: a passive URL sync to where we already are is not a
		//replaceState anybody needs.
		assert.deepStrictEqual(
			navigationCommitDecision('/c/main/', '/c/main/', false, true),
			{ status: 'unchanged', path: '/c/main/', history: 'none' }
		);
		//And a same-path request while editing is 'unchanged', not
		//'blocked-editing': there is no navigation to block.
		assert.deepStrictEqual(
			navigationCommitDecision('/c/main/', '/c/main/', true),
			{ status: 'unchanged', path: '/c/main/', history: 'none' }
		);
	});

	it('reports editing as an explicit blocker without history', () => {
		assert.deepStrictEqual(
			navigationCommitDecision('/c/everything/', '/c/starred/', true),
			{ status: 'blocked-editing', path: '/c/starred/', history: 'none' }
		);
	});

	it('distinguishes push from silent replace', () => {
		assert.deepStrictEqual(
			navigationCommitDecision('/c/everything/', '/c/starred/', false),
			{ status: 'commit', path: '/c/starred/', history: 'push' }
		);
		assert.deepStrictEqual(
			navigationCommitDecision('/c/everything/', '/c/starred/', false, true),
			{ status: 'commit', path: '/c/starred/', history: 'replace' }
		);
	});
});
