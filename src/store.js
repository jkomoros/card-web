/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

import {
	createStore,
	compose,
	applyMiddleware,
	combineReducers
} from 'redux';
import thunk from 'redux-thunk';
import { lazyReducerEnhancer } from 'pwa-helpers/lazy-reducer-enhancer.js';

import app from './reducers/app.js';
import data from './reducers/data.js';

// Sets up a Chrome extension for time travel debugging.
// See https://github.com/zalmoxisus/redux-devtools-extension for more information.
const devCompose = window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ || compose;

// Initializes the Redux store with a lazyReducerEnhancer (so that you can
// lazily add reducers after the store has been created) and redux-thunk (so
// that you can dispatch async actions). See the "Redux and state management"
// section of the wiki for more details:
// https://github.com/Polymer/pwa-starter-kit/wiki/4.-Redux-and-state-management
export const store = createStore(
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
