import { 
	UPDATE_EXECUTED_MAINTENANCE_TASKS,
	UPDATE_MAINTENANCE_TASK_ACTIVE
} from '../actions.js';

import {
	MaintenanceState
} from '../types.js';

import {
	SomeAction
} from '../actions.js';

const INITIAL_STATE : MaintenanceState = {
	executedTasks: {},
	taskActive: false,
};

const app = (state : MaintenanceState = INITIAL_STATE, action : SomeAction) : MaintenanceState => {
	switch (action.type) {
	case UPDATE_EXECUTED_MAINTENANCE_TASKS: 
		return {
			...state,
			executedTasks: {...state.executedTasks, ...action.executedTasks}
		};
	case UPDATE_MAINTENANCE_TASK_ACTIVE:
		return {
			...state,
			taskActive: action.active,
		};
	default:
		return state;
	}
};

export default app;