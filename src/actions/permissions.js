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
	db.collection(PERMISSIONS_COLLECTION).doc(uid).set({[key]: deleteField()}, {merge: true});
};