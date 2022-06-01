import { 
	UPDATE_EXECUTED_MAINTENANCE_TASKS,
	UPDATE_MAINTENANCE_TASK_ACTIVE
} from '../actions/maintenance.js';

import {
	MaintenanceTaskID,
	MaintenanceTask
} from '../types.js';

type MaintenanceState = {
	executedTasks: {[id : MaintenanceTaskID]: MaintenanceTask},
	taskActive: false,
}

const INITIAL_STATE : MaintenanceState = {
	executedTasks: {},
	taskActive: false,
};

const app = (state : MaintenanceState = INITIAL_STATE, action) : MaintenanceState => {
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