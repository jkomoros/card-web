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
import {auth, signInWithCustomToken} from './firebase.js';
import {EDITING_FINISH} from './actions.js';

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
		};
	}
}
