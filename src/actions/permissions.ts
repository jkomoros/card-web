export const PERMISSIONS_UPDATE_PERMISSIONS = 'PERMISSIONS_UPDATE_PERMISSIONS';
export const PERMISSIONS_START_ADD_CARD = 'PERMISSIONS_START_ADD_CARD';
export const PERMISSIONS_RESET_ADD_CARD = 'PERMISSIONS_RESET_ADD_CARD';

import {
	AppActionCreator,
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
	AnyAction
} from 'redux';

export const setCardToAddPermissionTo : AppActionCreator = (cardID : CardID) => (dispatch, getState) => {
	const state = getState();
	const permissionType = selectPermissionsPendingPermissionType(state);
	const uid = selectPermissionsPendingUid(state);
	dispatch(addUserPermissionToCard(cardID, permissionType, uid));
	dispatch({
		type: PERMISSIONS_RESET_ADD_CARD,
	});
};

export const selectCardToAddPermissionTo : AppActionCreator = (permissionType : PermissionType, uid : Uid) => (dispatch) => {
	dispatch({
		type:PERMISSIONS_START_ADD_CARD,
		permissionType,
		uid 
	});
	dispatch(findCardToPermission());
};

const addUserPermissionToCard : AppActionCreator = (cardID : CardID, permissionType : PermissionType, uid : Uid) => (dispatch, getState) => {
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

export const removeUserPermissionFromCard : AppActionCreator = (cardID : CardID, permissionType : PermissionType, uid : Uid) => (dispatch, getState) => {
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

const updatePermissions = (permissionsToAdd : UserPermissionsMap, permissionsToRemove : {[user : Uid]: true}) : AnyAction => {
	return {
		type:PERMISSIONS_UPDATE_PERMISSIONS,
		permissionsToAdd,
		permissionsToRemove
	};
};

export const addPermissionsObjectForUser : AppActionCreator = (uid : Uid) => () => {
	setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {}, {merge: true});
};

export const deletePermissionsObjectForUser : AppActionCreator = (uid : Uid) => () => {
	deleteDoc(doc(db, PERMISSIONS_COLLECTION, uid));
};

export const updateUserNote : AppActionCreator = (uid : Uid, note : string) => () => {
	updateDoc(doc(db, PERMISSIONS_COLLECTION, uid), {notes:note});
};

export const addEnabledPermission : AppActionCreator = (uid: Uid, key : PermissionType) => () => {
	setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {[key]: true}, {merge: true});
};

export const clearPermission : AppActionCreator = (uid : Uid, key : PermissionType) => () => {
	setDoc(doc(db, PERMISSIONS_COLLECTION, uid), {[key]: deleteField()}, {merge: true});
};