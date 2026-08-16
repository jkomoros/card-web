//A tiny leaf module (no app imports) providing a Redux middleware that taps
//every dispatched concrete action and hands it to an optionally-registered
//listener. Used by the corpus bridge to forward whitelisted user-state
//actions to the worker without creating an import cycle between store.ts and
//the bridge.

import {
	Middleware
} from 'redux';

type ActionListener = (action : unknown) => void;

let listener : ActionListener | null = null;

export const setActionListener = (newListener : ActionListener | null) : void => {
	listener = newListener;
};

export const actionForwarderMiddleware : Middleware = () => next => action => {
	if (listener && action && typeof action === 'object' && 'type' in (action as object)) {
		listener(action);
	}
	return next(action);
};
