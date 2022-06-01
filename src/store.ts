import {
	createStore,
	compose,
	applyMiddleware,
	combineReducers,
	Store,
	Reducer
} from 'redux';
import thunk from 'redux-thunk';
import { lazyReducerEnhancer } from 'pwa-helpers/lazy-reducer-enhancer.js';

import app from './reducers/app.js';
import data from './reducers/data.js';

// Sets up a Chrome extension for time travel debugging.
// See https://github.com/zalmoxisus/redux-devtools-extension for more information.
const devCompose = window['__REDUX_DEVTOOLS_EXTENSION_COMPOSE__'] || compose;

interface LazyStore extends Store {
	addReducers(reducers : {[name : string]: Reducer})
}

// Initializes the Redux store with a lazyReducerEnhancer (so that you can
// lazily add reducers after the store has been created) and redux-thunk (so
// that you can dispatch async actions). See the "Redux and state management"
// section of the wiki for more details:
// https://github.com/Polymer/pwa-starter-kit/wiki/4.-Redux-and-state-management
export const store : LazyStore = createStore(
	state => state,
	devCompose(
		lazyReducerEnhancer(combineReducers),
		applyMiddleware(thunk))
);

// Initially loaded reducers.
store.addReducers({
	app,
	data,
});

//Stash this here so it's easy to get access to it via console.
window['DEBUG_STORE'] = store;

//Connect it up so the reselect-tools extension will show the selector graph.
//https://github.com/skortchmark9/reselect-tools for how to install the
//extension
import * as selectors from './selectors.js';
//TODO: why can I not use the basic import? The es build output doesn't have any
//export keywords, maybe it's configured wrong?
import {
	getStateWith,
	registerSelectors,
} from 'reselect-tools/src';
getStateWith(() => store.getState());  // allows you to get selector inputs and outputs
registerSelectors(selectors); // register string names for selectors
