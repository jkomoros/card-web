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
	db
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