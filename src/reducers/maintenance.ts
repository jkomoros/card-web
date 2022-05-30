import { 
	UPDATE_EXECUTED_MAINTENANCE_TASKS,
	UPDATE_MAINTENANCE_TASK_ACTIVE
} from '../actions/maintenance.js';

const INITIAL_STATE = {
	executedTasks: {},
	taskActive: false,
};

const app = (state = INITIAL_STATE, action) => {
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