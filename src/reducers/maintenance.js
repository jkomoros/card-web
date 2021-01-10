import { 
	UPDATE_EXECUTED_MAINTENANCE_TASKS
} from '../actions/maintenance.js';

const INITIAL_STATE = {
	executedTasks: {},
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case UPDATE_EXECUTED_MAINTENANCE_TASKS: 
		return {
			...state,
			executedTasks: {...state.executedTasks, ...action.executedTasks}
		};
	default:
		return state;
	}
};

export default app;