export const PERMISSIONS_UPDATE_PERMISSIONS = 'PERMISSIONS_UPDATE_PERMISSIONS';
export const PERMISSIONS_START_ADD_CARD = 'PERMISSIONS_START_ADD_CARD';
export const PERMISSIONS_RESET_ADD_CARD = 'PERMISSIONS_RESET_ADD_CARD';

import {
	store
} from '../store.js';

import {
	selectUserMayEditPermissions,
	getCardById,
	selectPermissionsPendingPermissionType,
	selectPermissionsPendingUid
} from '../selectors.js';

import {
	PERMISSIONS_COLLECTION
} from './database.js';

import {
	db,
	deleteSentinel
} from '../firebase.js';

import {
	modifyCard
} from './data.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	findCardToPermission
} from './find.js';

export const setCardToAddPermissionTo = (cardID) => (dispatch, getState) => {
	const state = getState();
	const permissionType = selectPermissionsPendingPermissionType(state);
	const uid = selectPermissionsPendingUid(state);
	dispatch(addUserPermissionToCard(cardID, permissionType, uid));
	dispatch({
		type: PERMISSIONS_RESET_ADD_CARD,
	});
};

export const selectCardToAddPermissionTo = (permissionType, uid) => (dispatch) => {
	dispatch({
		type:PERMISSIONS_START_ADD_CARD,
		permissionType,
		uid 
	});
	dispatch(findCardToPermission());
};

const addUserPermissionToCard = (cardID, permissionType, uid) => (dispatch, getState) => {
	if (permissionType != PERMISSION_EDIT_CARD) {
		console.warn('Illegal permission type');
		return;
	}
	const state = getState();
	const card = getCardById(state, cardID);
	if (!card) {
		console.warn('No such card');
		return;
	}
	const update = {
		add_editors: [uid],
	};
	dispatch(modifyCard(card, update, false));
};

export const removeUserPermissionFromCard = (cardID, permissionType, uid) => (dispatch, getState) => {
	if (permissionType != PERMISSION_EDIT_CARD) {
		console.warn('Illegal permission type');
		return;
	}
	const state = getState();
	const card = getCardById(state, cardID);
	if (!card) {
		console.warn('No such card');
		return;
	}
	const update = {
		remove_editors: [uid],
	};
	dispatch(modifyCard(card, update, false));
};

export const connectLivePermissions = () => {
	if (!selectUserMayEditPermissions(store.getState())) return;
	db.collection(PERMISSIONS_COLLECTION).onSnapshot(snapshot => {

		let permissionsToAdd = {};
		let permissionsToRemove = {};

		snapshot.docChanges().forEach(change => {
			let doc = change.doc;
			let id = doc.id;
			if (change.type === 'removed') {
				permissionsToRemove[id] = true;
				return;
			}
			let permission = doc.data();
			permission.id = id;
			permissionsToAdd[id] = permission;
		});

		store.dispatch(updatePermissions(permissionsToAdd, permissionsToRemove));

	});
};

const updatePermissions = (permissionsToAdd, permissionsToRemove) => {
	return {
		type:PERMISSIONS_UPDATE_PERMISSIONS,
		permissionsToAdd,
		permissionsToRemove
	};
};

export const addPermissionsObjectForUser = (uid) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({}, {merge: true});
};

export const deletePermissionsObjectForUser = (uid) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).delete();
};

export const updateUserNote = (uid, note) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).update({notes:note});
};

export const addEnabledPermission = (uid, key) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[key]: true}, {merge: true});
};

export const clearPermission = (uid, key) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[key]: deleteSentinel()}, {merge: true});
};