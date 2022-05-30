import {
	PERMISSIONS_UPDATE_PERMISSIONS,
	PERMISSIONS_START_ADD_CARD,
	PERMISSIONS_RESET_ADD_CARD
} from '../actions/permissions.js';

const INITIAL_STATE = {
	permissions: {},
	pendingUid : '',
	pendingPermissionType: ''
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case PERMISSIONS_UPDATE_PERMISSIONS:
		return {...state, permissions:Object.fromEntries(Object.entries({...state.permissions, ...action.permissionsToAdd}).filter(entry => !action.permissionsToRemove[entry[0]]))};
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