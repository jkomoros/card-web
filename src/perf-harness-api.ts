//Narrow browser-driver API installed only when DEBUG_PERF was enabled before
//boot. This lets the acceptance harness exercise the production Rollup build
//without importing a second copy of the unbundled store/action graph.

import {store} from './store.js';
import {navigateToNextCard} from './actions/app.js';
import {markActiveCardReadIfLoggedIn} from './actions/user.js';
import {editingCommit, editingSelectTab, editingStart, textFieldUpdated} from './actions/editor.js';
import {openFindDialog, updateQuery} from './actions/find.js';
import {selectRawCards} from './selectors.js';
import {State} from './types.js';
import {auth, db, signInWithCustomToken} from './firebase.js';
import {EDITING_FINISH} from './actions.js';
import {modifyCardsWithDurableTagOperation, modifyCardsWithDurableMultiEdit} from './actions/data.js';
import {doc, getDocFromServer} from 'firebase/firestore';

const waitFor = async (condition : () => boolean, timeoutMs = 15000) => {
	const start = performance.now();
	while (!condition()) {
		if (performance.now() - start > timeoutMs) throw new Error('timed out waiting for listener state');
		await new Promise(resolve => setTimeout(resolve, 25));
	}
};

export const installPerfHarnessAPI = () : void => {
	window.PERF_HARNESS = {
		navigateAndRead: () => {
			store.dispatch(navigateToNextCard());
			store.dispatch(markActiveCardReadIfLoggedIn());
		},
		startEditingContent: () => {
			store.dispatch(editingStart());
			store.dispatch(editingSelectTab('content'));
		},
		finishEditing: () => store.dispatch({type: EDITING_FINISH}),
		dirtyEditingBody: (marker : string) => {
			const editingCard = (store.getState() as State).editor?.card;
			if (!editingCard) throw new Error('editor is not open');
			store.dispatch(textFieldUpdated('body', `${editingCard.body}\n${marker}`));
		},
		commitEditing: () => store.dispatch(editingCommit()),
		openFind: (query : string) => {
			store.dispatch(openFindDialog());
			store.dispatch(updateQuery(query));
		},
		signInAsAdmin: async (uid : string) => {
			const encode = (value : object) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
			const now = Math.floor(Date.now() / 1000);
			const token = `${encode({alg: 'none', typ: 'JWT'})}.${encode({
				iss: 'perf-harness', sub: 'perf-harness',
				aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
				iat: now, exp: now + 3600, uid,
			})}.`;
			const result = await signInWithCustomToken(auth, token);
			return {uid: result.user.uid, isAnonymous: result.user.isAnonymous};
		},
		activeRawCard: () => {
			const state = store.getState() as State;
			const id = state.collection?.activeCardID || '';
			const card = selectRawCards(state)[id];
			return {id, body: card?.body || '', modificationError: state.data.cardModificationError ? String(state.data.cardModificationError) : ''};
		},
		prepareBulkTag: (count : number) => {
			const state = store.getState() as State;
			const tag = Object.keys(state.data.tags)[0];
			if (!tag) throw new Error('perf corpus has no tag documents');
			const cards = Object.values(selectRawCards(state))
				.filter(card => !(card.tags || []).includes(tag))
				.slice(0, count);
			if (cards.length !== count) throw new Error(`only ${cards.length} cards do not already have ${tag}`);
			return {tag, ids: cards.map(card => card.id)};
		},
		startPreparedBulkTag: async (ids : string[], tag : string, adding : boolean) => {
			const rawCards = selectRawCards(store.getState() as State);
			const cards = ids.map(id => rawCards[id]);
			if (cards.some(card => !card)) throw new Error('prepared bulk-tag card is not loaded');
			await store.dispatch(modifyCardsWithDurableTagOperation(cards, tag, adding));
		},
		bulkTagRoundTrip: async (count : number) => {
			const state = store.getState() as State;
			const tag = Object.keys(state.data.tags)[0];
			if (!tag) throw new Error('perf corpus has no tag documents');
			const cards = Object.values(selectRawCards(state))
				.filter(card => !(card.tags || []).includes(tag))
				.slice(0, count);
			if (cards.length !== count) throw new Error(`only ${cards.length} cards do not already have ${tag}`);
			const originals = Object.fromEntries(cards.map(card => [card.id, {
				body: card.body,
				title: card.title,
				tags: card.tags || [],
				references: card.references || {},
			}]));
			const addStart = performance.now();
			await store.dispatch(modifyCardsWithDurableTagOperation(cards, tag, true));
			const addMs = performance.now() - addStart;
			await waitFor(() => cards.every(card => (selectRawCards(store.getState() as State)[card.id]?.tags || []).includes(tag)));
			const afterAdd = selectRawCards(store.getState() as State);
			if (cards.some(card => !(afterAdd[card.id]?.tags || []).includes(tag))) throw new Error('local add echo incomplete');
			const authoritativeTagAfterAdd = await getDocFromServer(doc(db, 'tags', tag));
			const mirrored = new Set((authoritativeTagAfterAdd.data()?.cards || []) as string[]);
			if (cards.some(card => !mirrored.has(card.id))) throw new Error('authoritative tag mirror incomplete after add');
			const removeStart = performance.now();
			await store.dispatch(modifyCardsWithDurableTagOperation(cards.map(card => afterAdd[card.id]), tag, false));
			const removeMs = performance.now() - removeStart;
			await waitFor(() => cards.every(card => !(selectRawCards(store.getState() as State)[card.id]?.tags || []).includes(tag)));
			const afterRemove = selectRawCards(store.getState() as State);
			for (const card of cards) {
				const current = afterRemove[card.id];
				if (JSON.stringify(current?.tags || []) !== JSON.stringify(originals[card.id].tags)) throw new Error(`local tags not restored for ${card.id}`);
				if (current?.body !== originals[card.id].body || current?.title !== originals[card.id].title ||
					JSON.stringify(current?.references || {}) !== JSON.stringify(originals[card.id].references)) throw new Error(`non-tag field changed for ${card.id}`);
			}
			return {tag, ids: cards.map(card => card.id), originals, addMs, removeMs};
		},
		durableMultiEditRoundTrip: async (count : number) => {
			const state = store.getState() as State;
			const tags = Object.keys(state.data.tags).slice(0, 3);
			if (tags.length !== 3) throw new Error('need three perf tags');
			const removeTag = tags[0];
			const addTags = tags.slice(1);
			const referenceTarget = Object.values(selectRawCards(state))[0];
			if (!referenceTarget) throw new Error('need a reference target');
			const referenceType = 'generic';
			const cards = Object.values(selectRawCards(state)).filter(card =>
				card.id !== referenceTarget.id &&
				!card.published &&
				(card.tags || []).includes(removeTag) &&
				addTags.every(tag => !(card.tags || []).includes(tag)) &&
				card.auto_todo_overrides?.prioritized === undefined &&
				card.auto_todo_overrides?.prose === undefined &&
				!card.references_info?.[referenceTarget.id],
			).slice(0, count);
			if (cards.length !== count) throw new Error(`only ${cards.length} cards fit generic multi-edit preconditions`);
			const originals = Object.fromEntries(cards.map(card => [card.id, {
				body: card.body,
				title: card.title,
				tags: card.tags || [],
				references: card.references || {},
				references_info: card.references_info || {},
				auto_todo_overrides: card.auto_todo_overrides || {},
				published: card.published,
			}]));
			const start = performance.now();
			await store.dispatch(modifyCardsWithDurableMultiEdit(cards, {
				add_tags: addTags,
				remove_tags: [removeTag],
				auto_todo_overrides_enablements: ['prioritized'],
				auto_todo_overrides_disablements: ['prose'],
				references_diff: [{cardID: referenceTarget.id, referenceType, value: ''}],
				published: true,
			}));
			const applyMs = performance.now() - start;
			await waitFor(() => cards.every(card => {
				const current = selectRawCards(store.getState() as State)[card.id];
				return addTags.every(tag => (current?.tags || []).includes(tag)) &&
					!(current?.tags || []).includes(removeTag) &&
					current?.auto_todo_overrides?.prioritized === true &&
					current?.auto_todo_overrides?.prose === false &&
					current?.references_info?.[referenceTarget.id]?.[referenceType] === '' &&
					current?.published === true;
			}));
			const changed = selectRawCards(store.getState() as State);
			const restoreStart = performance.now();
			await store.dispatch(modifyCardsWithDurableMultiEdit(cards.map(card => changed[card.id]), {
				add_tags: [removeTag],
				remove_tags: addTags,
				auto_todo_overrides_removals: ['prioritized', 'prose'],
				references_diff: [{cardID: referenceTarget.id, referenceType, delete: true}],
				published: false,
			}));
			const restoreMs = performance.now() - restoreStart;
			await waitFor(() => cards.every(card => {
				const current = selectRawCards(store.getState() as State)[card.id];
				return (current?.tags || []).includes(removeTag) &&
					addTags.every(tag => !(current?.tags || []).includes(tag)) &&
					current?.auto_todo_overrides?.prioritized === undefined &&
					current?.auto_todo_overrides?.prose === undefined &&
					current?.references_info?.[referenceTarget.id] === undefined &&
					current?.published === false;
			}));
			const restored = selectRawCards(store.getState() as State);
			for (const card of cards) {
				const current = restored[card.id];
				const original = originals[card.id];
				const mismatches = !current ? ['missing'] : [
					current.body !== original.body && 'body',
					current.title !== original.title && 'title',
					JSON.stringify([...(current.tags || [])].sort()) !== JSON.stringify([...original.tags].sort()) && 'tags',
					JSON.stringify(current.references || {}) !== JSON.stringify(original.references) && 'references',
					JSON.stringify(current.references_info || {}) !== JSON.stringify(original.references_info) && 'references_info',
					JSON.stringify(current.auto_todo_overrides || {}) !== JSON.stringify(original.auto_todo_overrides) && 'auto_todo_overrides',
					current.published !== original.published && 'published',
				].filter(Boolean);
				if (mismatches.length) {
					throw new Error(`generic multi-edit failed to restore ${card.id}: ${mismatches.join(', ')}`);
				}
			}
			return {count, applyMs, restoreMs, ids: cards.map(card => card.id), tags, originals, referenceTargetID: referenceTarget.id};
		},
	};
};

declare global {
	interface Window {
		PERF_HARNESS: {
			navigateAndRead: () => void,
			startEditingContent: () => void,
			finishEditing: () => void,
			dirtyEditingBody: (marker : string) => void,
			commitEditing: () => void,
			openFind: (query : string) => void,
			signInAsAdmin: (uid : string) => Promise<{uid : string, isAnonymous : boolean}>,
			activeRawCard: () => {id : string, body : string, modificationError : string},
			prepareBulkTag: (count : number) => {tag: string, ids: string[]},
			startPreparedBulkTag: (ids : string[], tag : string, adding : boolean) => Promise<void>,
			bulkTagRoundTrip: (count : number) => Promise<{
				tag: string,
				ids: string[],
				originals: {[id : string]: {body: string, title: string, tags: string[], references: object}},
				addMs: number,
				removeMs: number,
			}>,
			durableMultiEditRoundTrip: (count : number) => Promise<{
				count: number,
				applyMs: number,
				restoreMs: number,
				ids: string[],
				tags: string[],
				originals: {[id : string]: {
					body: string,
					title: string,
					tags: string[],
					references: object,
					references_info: object,
					auto_todo_overrides: object,
					published: boolean,
				}},
				referenceTargetID: string,
			}>,
		};
	}
}
