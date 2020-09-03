export const PERMISSIONS_UPDATE_PERMISSIONS = 'PERMISSIONS_UPDATE_PERMISSIONS';

import {
	store
} from '../store.js';

import {
	selectUserMayEditPermissions
} from '../selectors.js';

import {
	PERMISSIONS_COLLECTION
} from './database.js';

import {
	db,
	deleteField
} from '../firebase.js';

export const connectLivePermissions = () => {
	if (!selectUserMayEditPermissions(store.getState())) return;
	db.collection(PERMISSIONS_COLLECTION).onSnapshot(snapshot => {

		let permissions = {};

		snapshot.docChanges().forEach(change => {
			if (change.type === 'removed') return;
			let doc = change.doc;
			let id = doc.id;
			let permission = doc.data();
			permission.id = id;
			permissions[id] = permission;
		});

		store.dispatch(updatePermissions(permissions));

	});
};

const updatePermissions = (permissions) => {
	return {
		type:PERMISSIONS_UPDATE_PERMISSIONS,
		permissions
	};
};

export const addPermissionsObjectForUser = (uid) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({}, {merge: true});
};

export const updateUserNote = (uid, note) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).update({notes:note});
};

export const addEnabledPermission = (uid, key) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[key]: true}, {merge: true});
};

export const addDisabledPermission = (uid, key) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[key]: false}, {merge: true});
};

export const clearPermission = (uid, key) => () => {
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[key]: deleteField()}, {merge: true});
};