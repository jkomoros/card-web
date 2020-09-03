import {
	PERMISSIONS_UPDATE_PERMISSIONS
} from '../actions/permissions.js';

const INITIAL_STATE = {
	permissions: {}
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case PERMISSIONS_UPDATE_PERMISSIONS:
		return {...state, permissions:Object.fromEntries(Object.entries({...state.permissions, ...action.permissionsToAdd}).filter(entry => !action.permissionsToRemove[entry[0]]))};
	default:
		return state;
	}
};

export default app;