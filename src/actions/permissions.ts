import {
	ThunkSomeAction,
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
} from '../type_constants.js';

import {
	db,
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

import {
	onSnapshot,
	collection,
	setDoc,
	updateDoc,
	deleteDoc,
	doc,
	deleteField
} from 'firebase/firestore';

import {
	CardID,
	PermissionType,
	State,
	Uid,
	UserPermissionsMap
} from '../types.js';

import {
	PERMISSIONS_RESET_ADD_CARD,
	PERMISSIONS_START_ADD_CARD,
	PERMISSIONS_UPDATE_PERMISSIONS,
	SomeAction
} from '../actions.js';

export const setCardToAddPermissionTo = (cardID : CardID) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const permissionType = selectPermissionsPendingPermissionType(state);
	const uid = selectPermissionsPendingUid(state);
	dispatch(addUserPermissionToCard(cardID, permissionType, uid));
	dispatch({
		type: PERMISSIONS_RESET_ADD_CARD,
	});
};

export const selectCardToAddPermissionTo = (permissionType : PermissionType, uid : Uid) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type:PERMISSIONS_START_ADD_CARD,
		permissionType,
		uid 
	});
	dispatch(findCardToPermission());
};

const addUserPermissionToCard = (cardID : CardID, permissionType : PermissionType, uid : Uid) : ThunkSomeAction => (dispatch, getState) => {
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

export const removeUserPermissionFromCard = (cardID : CardID, permissionType : PermissionType, uid : Uid) : ThunkSomeAction => (dispatch, getState) => {
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
	if (!selectUserMayEditPermissions(store.getState() as State)) return;
	onSnapshot(collection(db, PERMISSIONS_COLLECTION), snapshot => {

		const permissionsToAdd : UserPermissionsMap = {};
		const permissionsToRemove : {[user : Uid] : true} = {};

		snapshot.docChanges().forEach(change => {
			const doc = change.doc;
			const id = doc.id;
			if (change.type === 'removed') {
				permissionsToRemove[id] = true;
				return;
			}
			const permission = doc.data();
			permission.id = id;
			permissionsToAdd[id] = permission;
		});

		store.dispatch(updatePermissions(permissionsToAdd, permissionsToRemove));

	});
};

const updatePermissions = (permissionsToAdd : UserPermissionsMap, permissionsToRemove : {[user : Uid]: true}) : SomeAction => {
	return {
		type:PERMISSIONS_UPDATE_PERMISSIONS,
		permissionsToAdd,
		permissionsToRemove
	};
};

export const addPermissionsObjectForUser = (uid : Uid) : ThunkSomeAction => () => {
	setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {}, {merge: true});
};

export const deletePermissionsObjectForUser = (uid : Uid) : ThunkSomeAction => () => {
	deleteDoc(doc(db, PERMISSIONS_COLLECTION, uid));
};

export const updateUserNote = (uid : Uid, note : string) : ThunkSomeAction => () => {
	updateDoc(doc(db, PERMISSIONS_COLLECTION, uid), {notes:note});
};

export const addEnabledPermission = (uid: Uid, key : PermissionType) : ThunkSomeAction => () => {
	setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {[key]: true}, {merge: true});
};

export const clearPermission = (uid : Uid, key : PermissionType) : ThunkSomeAction => () => {
	setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {[key]: deleteField()}, {merge: true});
};