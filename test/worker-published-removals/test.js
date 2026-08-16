/*eslint-env node*/

import assert from 'assert';

import {publishedGhostIDs, safePublishedRemovals} from '../../lib/src/worker/published-removals.js';

describe('published listener removal ordering', () => {
	it('preserves an unpublished version already installed by the delta listener', () => {
		const corpus = new Map([
			['flipped', {id: 'flipped', published: false}],
			['published', {id: 'published', published: true}],
		]);
		assert.deepStrictEqual(
			safePublishedRemovals(['flipped', 'published', 'missing'], corpus),
			['published', 'missing'],
		);
	});

	it('reconciles snapshot ghosts against an earlier authoritative server ID set', () => {
		const corpus = new Map([
			['real', {id: 'real', published: true}],
			['ghost', {id: 'ghost', published: true}],
			['draft', {id: 'draft', published: false}],
		]);
		assert.deepStrictEqual(publishedGhostIDs(corpus, new Set(['real'])), ['ghost']);
	});
});
