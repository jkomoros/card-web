import {
	PERMISSIONS_UPDATE_PERMISSIONS,
	PERMISSIONS_START_ADD_CARD,
	PERMISSIONS_RESET_ADD_CARD,
	SomeAction
} from '../actions.js';

import {
	PermissionsState,
	UserPermissionsMap,
	Uid
} from '../types.js';

const INITIAL_STATE : PermissionsState = {
	permissions: {},
	pendingUid : '',
	pendingPermissionType: ''
};

const updatedPermissions = (currentPermissions : UserPermissionsMap, permissionsToAdd : UserPermissionsMap, permissionsToRemove : {[uid : Uid] : true}) => {
	return Object.fromEntries(Object.entries({...currentPermissions, ...permissionsToAdd}).filter(entry => !permissionsToRemove[entry[0]]));
};

const app = (state : PermissionsState = INITIAL_STATE, action : SomeAction) : PermissionsState => {
	switch (action.type) {
	case PERMISSIONS_UPDATE_PERMISSIONS:
		return {...state, permissions:updatedPermissions(state.permissions, action.permissionsToAdd, action.permissionsToRemove)};
	case PERMISSIONS_START_ADD_CARD:
		return {
			...state,
			pendingUid: action.uid,
			pendingPermissionType: action.permissionType
		};
	case PERMISSIONS_RESET_ADD_CARD:
		return {
			...state,
			pendingUid: '',
			pendingPermissionType: ''
		};
	default:
		return state;
	}
};

export default app;