/*eslint-env node*/

//Tests for identity-preservation behavior in the collection and data
//reducers: single-card updates must only change the identity of filter maps
//whose membership actually changed, and no-op star/read updates must return
//the same state object, so downstream selectors don't reevaluate.

import {
	JSDOM
} from 'jsdom';

import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

after(() => {
	dom.window.close();
	//Importing the editor reducer pulls in Firebase's Node transport, which
	//keeps a MessagePort referenced even though this pure reducer suite never
	//uses it. Unref only that transport handle so the full npm test chain exits.
	for (const handle of process._getActiveHandles()) {
		if (handle.constructor?.name === 'MessagePort' && typeof handle.unref === 'function') handle.unref();
	}
});

let collectionReducer;
let dataReducer;
let editorReducer;
let UPDATE_CARDS;
let UPDATE_READS;
let UPDATE_STARS;
let MODIFY_CARD;
let MODIFY_CARD_SUCCESS;
let MODIFY_CARD_FAILURE;
let CLEAR_ENQUEUED_CARD_UPDATES;
let UPDATE_CORPUS_STATUS;
let UPDATE_CORPUS_DETAIL;
let UPDATE_PENDING_AUX_WRITE_COUNT;
let REMOVE_CARDS;
let ENQUEUE_CARD_UPDATES;
let UPDATE_COLLECTION_SHAPSHOT;
let UPDATE_CARD_META;
let EDITING_START;
let EDITING_RESTORE_DRAFT;
let EDITING_FINISH;
let EDITING_TEXT_FIELD_UPDATED;
let EDITING_SIMILARITY_PENDING;
let EDITING_UPDATE_SIMILAR_CARDS;
let INITIAL_COLLECTION_STATE;

const makeCard = (id, extras) => ({
	id,
	card_type: 'content',
	title: 'Title of ' + id,
	body: '<p>Body of ' + id + '</p>',
	section: 'main',
	tags: [],
	references: {},
	references_info: {},
	references_inbound: {},
	references_info_inbound: {},
	star_count: 0,
	star_count_manual: 0,
	tweet_favorite_count: 0,
	tweet_retweet_count: 0,
	thread_count: 0,
	thread_resolved_count: 0,
	notes: '',
	todo: '',
	auto_todo_overrides: {},
	published: true,
	full_bleed: false,
	images: [],
	...extras,
});

describe('reducer identity preservation', () => {
	before(async () => {
		collectionReducer = (await import('../../lib/src/reducers/collection.js')).default;
		dataReducer = (await import('../../lib/src/reducers/data.js')).default;
		editorReducer = (await import('../../lib/src/reducers/editor.js')).default;
		({
			UPDATE_CARDS,
			UPDATE_READS,
			UPDATE_STARS,
			MODIFY_CARD,
			MODIFY_CARD_SUCCESS,
			MODIFY_CARD_FAILURE,
			CLEAR_ENQUEUED_CARD_UPDATES,
			UPDATE_CORPUS_STATUS,
			UPDATE_CORPUS_DETAIL,
			UPDATE_PENDING_AUX_WRITE_COUNT,
			REMOVE_CARDS,
			ENQUEUE_CARD_UPDATES,
			UPDATE_COLLECTION_SHAPSHOT,
			UPDATE_CARD_META,
			EDITING_START,
			EDITING_RESTORE_DRAFT,
			EDITING_FINISH,
			EDITING_TEXT_FIELD_UPDATED,
			EDITING_SIMILARITY_PENDING,
			EDITING_UPDATE_SIMILAR_CARDS,
		} = await import('../../lib/src/actions.js'));
		({
			INITIAL_STATE: INITIAL_COLLECTION_STATE
		} = await import('../../lib/src/filters.js'));
	});

	it('restores a draft only onto its matching active editor snapshot', () => {
		const base = makeCard('draft-card');
		const restored = {...base, title: 'Recovered title'};
		const editing = editorReducer(undefined, {type: EDITING_START, card: base});
		const result = editorReducer(editing, {type: EDITING_RESTORE_DRAFT, card: restored, substantive: true});
		assert.strictEqual(result.card.title, 'Recovered title');
		assert.strictEqual(result.substantive, true);
		assert.strictEqual(result.underlyingCardSnapshot, base);

		const rejected = editorReducer(editing, {type: EDITING_RESTORE_DRAFT, card: {...restored, id: 'other'}, substantive: true});
		assert.strictEqual(rejected, editing);
	});

	//The editing-similarity staleness contract: similar-cards UI dims from
	//the moment a draft-content similarity request is issued until THAT
	//request's version-stamped result lands. The retry coordinator's
	//last-request-wins discipline means any other version is a cancelled
	//chain's leftover and must be dropped whole — it must neither un-dim a
	//newer pending request nor overwrite the current draft's slot.
	describe('editing similarity pending / version discipline', () => {
		const startEditing = () => editorReducer(undefined, {type: EDITING_START, card: makeCard('sim-card')});

		it('a pending request sets the dim signal for its version', () => {
			const editing = startEditing();
			assert.strictEqual(editing.similarityPendingVersion, 0);
			const pending = editorReducer(editing, {type: EDITING_SIMILARITY_PENDING, version: 5});
			assert.strictEqual(pending.similarityPendingVersion, 5);
			//A duplicate demand for the same content version is coalesced by
			//the coordinator; the reducer mirrors that with identity.
			assert.strictEqual(editorReducer(pending, {type: EDITING_SIMILARITY_PENDING, version: 5}), pending);
			//A newer request owns the chain: last-request-wins.
			const newer = editorReducer(pending, {type: EDITING_SIMILARITY_PENDING, version: 6});
			assert.strictEqual(newer.similarityPendingVersion, 6);
		});

		it('the current version\'s result lands the similarity and un-dims', () => {
			let state = startEditing();
			state = editorReducer(state, {type: EDITING_SIMILARITY_PENDING, version: 5});
			const similarity = {'other-card': 0.9};
			state = editorReducer(state, {type: EDITING_UPDATE_SIMILAR_CARDS, similarity, version: 5});
			assert.strictEqual(state.editingCardSimilarity, similarity);
			assert.strictEqual(state.similarityPendingVersion, 0);
		});

		it('a stale result neither un-dims a newer pending nor lands its value', () => {
			let state = startEditing();
			state = editorReducer(state, {type: EDITING_SIMILARITY_PENDING, version: 5});
			state = editorReducer(state, {type: EDITING_SIMILARITY_PENDING, version: 7});
			//The cancelled version-5 chain's leftover (e.g. an onDrop settle)
			//arrives after version 7 became the outstanding request.
			const result = editorReducer(state, {type: EDITING_UPDATE_SIMILAR_CARDS, similarity: {'stale-card': 0.4}, version: 5});
			assert.strictEqual(result, state);
			assert.strictEqual(result.similarityPendingVersion, 7);
			assert.strictEqual(result.editingCardSimilarity, undefined);
			//The current draft's own result still lands normally afterwards.
			const landed = editorReducer(result, {type: EDITING_UPDATE_SIMILAR_CARDS, similarity: {'fresh-card': 0.8}, version: 7});
			assert.deepStrictEqual(landed.editingCardSimilarity, {'fresh-card': 0.8});
			assert.strictEqual(landed.similarityPendingVersion, 0);
		});

		it('a result with nothing pending is accepted (legacy settle paths)', () => {
			const editing = startEditing();
			const state = editorReducer(editing, {type: EDITING_UPDATE_SIMILAR_CARDS, similarity: {}, version: 3});
			assert.deepStrictEqual(state.editingCardSimilarity, {});
			assert.strictEqual(state.similarityPendingVersion, 0);
		});

		it('a pending request after editing finished is ignored', () => {
			//The 1s settle timeout can outlive a quick editor close; there is
			//nothing to dim once editing has ended.
			let state = startEditing();
			state = editorReducer(state, {type: EDITING_FINISH});
			assert.strictEqual(editorReducer(state, {type: EDITING_SIMILARITY_PENDING, version: 5}), state);
		});

		it('starting or finishing editing clears any pending dim', () => {
			let state = startEditing();
			state = editorReducer(state, {type: EDITING_SIMILARITY_PENDING, version: 5});
			const restarted = editorReducer(state, {type: EDITING_START, card: makeCard('other-card')});
			assert.strictEqual(restarted.similarityPendingVersion, 0);
			const finished = editorReducer(state, {type: EDITING_FINISH});
			assert.strictEqual(finished.similarityPendingVersion, 0);
		});
	});

	//The post-save render contract: from the instant a committed single-card
	//save tears the editor down, the card face must have the NEW value
	//available at every observable step — never a frame where both the editing
	//card and the optimistic pending-save card are gone and the face would
	//fall back to the stale pre-edit state.data.cards copy — until the durable
	//executor settles the save with SUCCESS or FAILURE.
	describe('pending-save optimistic face', () => {
		const editedState = () => {
			let state = editorReducer(undefined, {type: EDITING_START, card: makeCard('save-card')});
			state = editorReducer(state, {type: EDITING_TEXT_FIELD_UPDATED, fieldName: 'title', value: 'New title', fromContentEditable: false});
			return state;
		};

		it('a save teardown hands the committed draft to pendingSaveCard in the same action that clears the editor', () => {
			const state = editorReducer(editedState(), {type: EDITING_FINISH, pendingSave: true});
			//One action, both effects: there is no dispatch between "editor
			//closed" and "optimistic face installed" for a render to observe.
			assert.strictEqual(state.editing, false);
			assert.strictEqual(state.card, null);
			assert.strictEqual(state.pendingSaveCard.title, 'New title');
		});

		it('the optimistic face survives MODIFY_CARD and clears exactly on settle', () => {
			let state = editorReducer(editedState(), {type: EDITING_FINISH, pendingSave: true});
			//The executor dispatches MODIFY_CARD right after the teardown; the
			//new value must still be renderable at that step.
			state = editorReducer(state, {type: MODIFY_CARD, modificationCount: 1});
			assert.strictEqual(state.pendingSaveCard.title, 'New title');
			//Success: the post-commit echo has already installed the confirmed
			//card into data.cards, so dropping the face swaps identical values.
			const confirmed = editorReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 1});
			assert.strictEqual(confirmed.pendingSaveCard, null);
			//Failure: the save did NOT land — the face must revert to server
			//truth while the save indicator's Retry/Stop takes over.
			const failed = editorReducer(state, {type: MODIFY_CARD_FAILURE, error: new Error('nope')});
			assert.strictEqual(failed.pendingSaveCard, null);
		});

		it('a non-save teardown leaves no optimistic face', () => {
			const cancelled = editorReducer(editedState(), {type: EDITING_FINISH});
			assert.strictEqual(cancelled.pendingSaveCard, null);
			//And a teardown-without-flag (purge, ownership loss) clears one
			//left by an earlier save.
			let state = editorReducer(editedState(), {type: EDITING_FINISH, pendingSave: true});
			state = editorReducer(state, {type: EDITING_FINISH});
			assert.strictEqual(state.pendingSaveCard, null);
		});

		it('a new editing session on the SAME card supersedes a lingering optimistic face', () => {
			let state = editorReducer(editedState(), {type: EDITING_FINISH, pendingSave: true});
			const pendingID = state.pendingSaveCard.id;
			state = editorReducer(state, {type: EDITING_START, card: makeCard(pendingID)});
			assert.strictEqual(state.pendingSaveCard, null);
		});

		it('a new editing session on a DIFFERENT card keeps the in-flight optimistic face (#763)', () => {
			//With per-card editor sessions, opening card B while card A's save
			//round-trips is routine. Clearing A's face here made navigating
			//back to A show the pre-save content — the "save reverted"
			//symptom pendingSaveCard exists to prevent. It still clears on
			//settle.
			let state = editorReducer(editedState(), {type: EDITING_FINISH, pendingSave: true});
			const pending = state.pendingSaveCard;
			assert.ok(pending);
			state = editorReducer(state, {type: EDITING_START, card: makeCard('other-card')});
			assert.strictEqual(state.pendingSaveCard, pending);
			state = editorReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 1});
			assert.strictEqual(state.pendingSaveCard, null);
		});

		it('settle actions with no pending face preserve state identity', () => {
			const state = editorReducer(undefined, {type: EDITING_START, card: makeCard('idle-card')});
			assert.strictEqual(editorReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 0}), state);
			assert.strictEqual(editorReducer(state, {type: MODIFY_CARD_FAILURE, error: new Error('nope')}), state);
		});
	});

	const primedCollectionState = (cards) => {
		return collectionReducer(INITIAL_COLLECTION_STATE, {type: UPDATE_CARDS, cards, fetchType: 'published'});
	};

	it('UPDATE_CARDS with an unchanged card preserves state identity', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		//Redelivering the same card (e.g. a snapshot echo) changes no
		//membership, so the whole state object should be identical.
		const nextState = collectionReducer(state, {type: UPDATE_CARDS, cards: {'card-one': makeCard('card-one')}, fetchType: 'published'});
		assert.strictEqual(nextState, state);
	});

	it('UPDATE_CARDS changing one membership only changes affected filter maps', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		//Adding a note flips membership in the has-notes/no-notes filters but
		//nothing else.
		const changed = makeCard('card-one', {notes: 'some notes'});
		const nextState = collectionReducer(state, {type: UPDATE_CARDS, cards: {'card-one': changed}, fetchType: 'published'});
		assert.notStrictEqual(nextState, state);
		assert.notStrictEqual(nextState.filters, state.filters);
		let changedMaps = 0;
		let sharedMaps = 0;
		for (const name of Object.keys(state.filters)) {
			if (nextState.filters[name] === state.filters[name]) {
				sharedMaps++;
			} else {
				changedMaps++;
			}
		}
		//Only a small number of note-related filter maps should have changed;
		//every untouched filter map must keep its identity.
		assert.ok(changedMaps > 0, 'expected at least one filter map to change');
		assert.ok(changedMaps <= 6, 'expected few filter maps to change, got ' + changedMaps);
		assert.ok(sharedMaps > 50, 'expected most filter maps to keep identity, got ' + sharedMaps);
	});

	it('atomically installs a complete worker card-filter projection and preserves user filters', async () => {
		const card = makeCard('card-one');
		let baseline = primedCollectionState({'card-one': card});
		baseline = collectionReducer(baseline, {type: UPDATE_STARS, starsToAdd: ['card-one'], starsToRemove: []});
		const cardFilterNames = Object.keys((await import('../../lib/src/filters.js')).CARD_FILTER_FUNCS);
		const projection = Object.fromEntries(cardFilterNames.map(name => [name, baseline.filters[name]]));
		const empty = collectionReducer(INITIAL_COLLECTION_STATE, {type: UPDATE_STARS, starsToAdd: ['card-one'], starsToRemove: []});
		const installed = collectionReducer(empty, {type: UPDATE_CARDS, cards: {'card-one': card}, fetchType: 'published', cardFilters: projection});
		for (const name of cardFilterNames) assert.deepStrictEqual(installed.filters[name], baseline.filters[name], name);
		assert.deepStrictEqual(installed.filters.starred, {'card-one': true});

		const incomplete = {...projection};
		delete incomplete[cardFilterNames[0]];
		const fallback = collectionReducer(INITIAL_COLLECTION_STATE, {type: UPDATE_CARDS, cards: {'card-one': card}, fetchType: 'published', cardFilters: incomplete});
		assert.deepStrictEqual(fallback.filters.content, {'card-one': true});
	});

	it('large initial card-major projection matches every filter predicate and preserves non-card map identity', async () => {
		const {CARD_FILTER_FUNCS} = await import('../../lib/src/filters.js');
		const cards = {};
		for (let i = 0; i < 1000; i++) {
			const id = `large-prime-${i}`;
			cards[id] = makeCard(id, {
				card_type: i % 7 === 0 ? 'working-notes' : 'content',
				notes: i % 11 === 0 ? `note ${i}` : '',
				todo: i % 13 === 0 ? `todo ${i}` : '',
				published: i % 5 !== 0,
				tags: i % 3 === 0 ? ['tag-a'] : [],
			});
		}

		const before = collectionReducer(INITIAL_COLLECTION_STATE, {
			type: UPDATE_STARS,
			starsToAdd: ['large-prime-1'],
			starsToRemove: [],
		});
		const next = collectionReducer(before, {type: UPDATE_CARDS, cards, fetchType: 'published'});

		for (const [name, info] of Object.entries(CARD_FILTER_FUNCS)) {
			const expected = Object.fromEntries(Object.values(cards)
				.filter(card => Boolean(info.func(card)))
				.map(card => [card.id, true]));
			assert.deepStrictEqual(next.filters[name], expected, name);
			//The direct projection installs a complete, independently-owned set
			//of card-derived maps rather than mutating the empty initial maps.
			assert.notStrictEqual(next.filters[name], before.filters[name], name);
		}
		assert.strictEqual(next.filters.starred, before.filters.starred);
		assert.strictEqual(next.filters.read, before.filters.read);
		assert.deepStrictEqual(next.filters.starred, {'large-prime-1': true});
	});

	it('no-op UPDATE_READS preserves state identity', async () => {
		const card = makeCard('card-one');
		let state = primedCollectionState({'card-one': card});
		state = collectionReducer(state, {type: UPDATE_READS, readsToAdd: ['card-one'], readsToRemove: []});
		const readState = state;
		//Marking an already-read card read again (echo redelivery) is a no-op.
		state = collectionReducer(state, {type: UPDATE_READS, readsToAdd: ['card-one'], readsToRemove: []});
		assert.strictEqual(state, readState);
		//Removing a read that isn't set is also a no-op.
		state = collectionReducer(state, {type: UPDATE_READS, readsToAdd: [], readsToRemove: ['card-two']});
		assert.strictEqual(state, readState);
	});

	it('genuine UPDATE_READS changes only the read filter', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		const nextState = collectionReducer(state, {type: UPDATE_READS, readsToAdd: ['card-one'], readsToRemove: []});
		assert.notStrictEqual(nextState, state);
		assert.strictEqual(nextState.filters.read['card-one'], true);
		for (const name of Object.keys(state.filters)) {
			if (name === 'read') continue;
			assert.strictEqual(nextState.filters[name], state.filters[name], 'filter ' + name + ' should keep identity');
		}
	});

	it('no-op UPDATE_STARS preserves state identity', async () => {
		const card = makeCard('card-one');
		const state = primedCollectionState({'card-one': card});
		const nextState = collectionReducer(state, {type: UPDATE_STARS, starsToAdd: [], starsToRemove: ['card-one']});
		assert.strictEqual(nextState, state);
	});

	it('MODIFY_CARD_SUCCESS corrects pendingModificationCount to the writes actually made', async () => {
		const initial = dataReducer(undefined, {type: '@@INIT'});
		//A commit plans one write…
		let state = dataReducer(initial, {type: MODIFY_CARD, modificationCount: 1});
		assert.strictEqual(state.pendingModificationCount, 1);
		//…but the diff turns out to be a no-op: zero writes committed. The
		//count must clear, or receiveCards would suppress applying card
		//updates forever (no echo is ever coming).
		state = dataReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 0});
		assert.strictEqual(state.pendingModifications, false);
		assert.strictEqual(state.pendingModificationCount, 0);
		//A settled commit zeroes the gate outright: every echo it will ever
		//produce has already been enqueued or deduped away (echoes are
		//awaited before commit()), and dedupe drops updated-only echoes —
		//keeping a residual count froze all subsequent card updates in the
		//queue (the mostly-no-op tag-sweep stall).
		state = dataReducer(state, {type: MODIFY_CARD, modificationCount: 3});
		state = dataReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 2});
		assert.strictEqual(state.pendingModificationCount, 0);
		//If the echo already arrived and flushed (latency-compensated local
		//echo lands before commit resolves), the count is already 0 and
		//success must NOT re-raise it.
		state = dataReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 0});
		state = dataReducer(state, {type: MODIFY_CARD, modificationCount: 1});
		state = dataReducer(state, {type: CLEAR_ENQUEUED_CARD_UPDATES});
		assert.strictEqual(state.pendingModificationCount, 0);
		state = dataReducer(state, {type: MODIFY_CARD_SUCCESS, modificationCount: 1});
		assert.strictEqual(state.pendingModificationCount, 0);
	});

	it('MODIFY_CARD_FAILURE clears pendingModificationCount', async () => {
		const initial = dataReducer(undefined, {type: '@@INIT'});
		let state = dataReducer(initial, {type: MODIFY_CARD, modificationCount: 1});
		state = dataReducer(state, {type: MODIFY_CARD_FAILURE, error: new Error('nope')});
		assert.strictEqual(state.pendingModifications, false);
		assert.strictEqual(state.pendingModificationCount, 0);
	});

	it('UPDATE_CORPUS_STATUS stores user-visible sync health', () => {
		const initial = dataReducer(undefined, {type: '@@INIT'});
		const state = dataReducer(initial, {
			type: UPDATE_CORPUS_STATUS,
			status: 'stale',
			message: 'Sync interrupted',
		});
		assert.strictEqual(state.corpusStatus, 'stale');
		assert.strictEqual(state.corpusStatusMessage, 'Sync interrupted');
	});

	it('UPDATE_CORPUS_DETAIL stores the counts the status indicator renders', () => {
		const initial = dataReducer(undefined, {type: '@@INIT'});
		assert.strictEqual(initial.expectedCorpusSize, null);
		assert.strictEqual(initial.verifyDone, null);
		assert.strictEqual(initial.verifyTotal, null);
		let state = dataReducer(initial, {
			type: UPDATE_CORPUS_DETAIL,
			corpusSize: 12400,
			snapshotAgeMs: 5000,
			expectedCorpusSize: 40200,
			verifyDone: 3,
			verifyTotal: 16,
		});
		assert.strictEqual(state.corpusSize, 12400);
		assert.strictEqual(state.corpusSnapshotAgeMs, 5000);
		assert.strictEqual(state.expectedCorpusSize, 40200);
		assert.strictEqual(state.verifyDone, 3);
		assert.strictEqual(state.verifyTotal, 16);
		//loadComplete republishes with the target cleared; a lingering total
		//would keep the indicator promising progress toward a goal already
		//reached. Verify progress, by contrast, OUTLIVES loadComplete — the
		//verifying window is after it — and clears on teardown/reconnect (an
		//action without the fields normalizes them to null).
		state = dataReducer(state, {
			type: UPDATE_CORPUS_DETAIL,
			corpusSize: 40225,
			snapshotAgeMs: null,
			expectedCorpusSize: null,
			verifyDone: 16,
			verifyTotal: 16,
		});
		assert.strictEqual(state.expectedCorpusSize, null);
		assert.strictEqual(state.verifyDone, 16);
		state = dataReducer(state, {
			type: UPDATE_CORPUS_DETAIL,
			corpusSize: 0,
			snapshotAgeMs: null,
			expectedCorpusSize: null,
		});
		assert.strictEqual(state.verifyDone, null);
		assert.strictEqual(state.verifyTotal, null);
	});

	it('UPDATE_PENDING_AUX_WRITE_COUNT mirrors the durable queue depth', () => {
		const initial = dataReducer(undefined, {type: '@@INIT'});
		assert.strictEqual(initial.pendingAuxWriteCount, 0);
		let state = dataReducer(initial, {type: UPDATE_PENDING_AUX_WRITE_COUNT, count: 3});
		assert.strictEqual(state.pendingAuxWriteCount, 3);
		state = dataReducer(state, {type: UPDATE_PENDING_AUX_WRITE_COUNT, count: 0});
		assert.strictEqual(state.pendingAuxWriteCount, 0);
	});

	it('UPDATE_CARDS prunes only similarity entries mentioning changed cards', async () => {
		const dataState = dataReducer(undefined, {type: '@@INIT'});
		const primed = {
			...dataState,
			cards: {},
			cardSimilarity: {
				'card-one': {'card-two': 0.9, 'card-three': 0.5},
				'card-four': {'card-five': 0.8},
			}
		};
		//Updating a card that appears in one entry's results prunes only that
		//entry.
		const nextState = dataReducer(primed, {type: UPDATE_CARDS, cards: {'card-two': makeCard('card-two')}, fetchType: 'published'});
		assert.strictEqual(nextState.cardSimilarity['card-one'], undefined);
		assert.strictEqual(nextState.cardSimilarity['card-four'], primed.cardSimilarity['card-four']);
		//Updating a card mentioned nowhere keeps the whole map's identity.
		const unrelated = dataReducer(primed, {type: UPDATE_CARDS, cards: {'card-nine': makeCard('card-nine')}, fetchType: 'published'});
		assert.strictEqual(unrelated.cardSimilarity, primed.cardSimilarity);
	});

	it('REMOVE_CARDS purges every cached and queued representation', () => {
		const card = makeCard('secret-card', {published: false, slugs: ['secret-slug']});
		let state = dataReducer(undefined, {type: '@@INIT'});
		state = dataReducer(state, {type: UPDATE_CARDS, cards: {'secret-card': card}, fetchType: 'unpublished'});
		state = dataReducer(state, {type: UPDATE_COLLECTION_SHAPSHOT});
		state = dataReducer(state, {type: UPDATE_CARD_META, metas: {'secret-card': {id: 'secret-card'}}, removedIDs: []});
		state = dataReducer(state, {type: ENQUEUE_CARD_UPDATES, cards: {'secret-card': card}, fetchType: 'unpublished'});
		state = {
			...state,
			pendingDeletions: {'secret-card': true},
			cardSimilarity: {
				'secret-card': {'other-card': 0.9},
				'other-card': {'secret-card': 0.8},
			},
		};
		state = dataReducer(state, {type: REMOVE_CARDS, cardIDs: ['secret-card']});
		assert.strictEqual(state.cards['secret-card'], undefined);
		assert.strictEqual(state.cardsSnapshot['secret-card'], undefined);
		assert.strictEqual(state.slugIndex['secret-slug'], undefined);
		assert.strictEqual(state.cardMeta['secret-card'], undefined);
		assert.strictEqual(state.enqueuedCards.unpublished['secret-card'], undefined);
		assert.strictEqual(state.pendingDeletions['secret-card'], undefined);
		assert.strictEqual(state.cardSimilarity['secret-card'], undefined);
		assert.strictEqual(state.cardSimilarity['other-card'], undefined);
	});
});
