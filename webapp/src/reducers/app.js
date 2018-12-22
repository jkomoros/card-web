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
  UPDATE_PAGE,
  UPDATE_OFFLINE,
  OPEN_SNACKBAR,
  CLOSE_SNACKBAR,
  UPDATE_DRAWER_STATE
} from '../actions/app.js';

const card = {
  title: "Collaborative debate is the best tool in complex spaces",
  body: `<p>Adversarial debate is more familiar, but it presumes that the answer is one of two options. That only applies in complicated problem spaces, not complex.</p>
        <p>The fundamental difference with collaborative debate is a <strong>positive-sum </strong>perspective. All participants must be <a card="g487aed6370_0_141">curious</a>, keep an open mind, and seek to understand. The debate should be <a card="g487aed6370_0_171">intellectually but not emotionally intense</a>.</p>
        <p>No single person has the right skill sets, experiences, and perspectives to fully understand a complex problem space. Diversity of perspective (both underlying data and <a card="g487aed6370_0_111">lenses</a>) is the raw material for comprehensive <a card="g487aed6370_0_50">insight</a>.</p>
        <p><strong>The conditions for collaborative debate are not natural occurring and must be </strong><strong><a card="g487aed6370_0_166">actively created</a></strong><em>. See also the essay </em><em><a href="https://medium.com/@komorama/debate-should-be-collaborative-not-combative-185ff37f1d34">Debate should be collaborative, not combative</a></em><em>.</em></p>`
}

const INITIAL_STATE = {
  page: '',
  offline: false,
  drawerOpened: false,
  snackbarOpened: false,
  card: card
};

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case UPDATE_PAGE:
      return {
        ...state,
        page: action.page
      };
    case UPDATE_OFFLINE:
      return {
        ...state,
        offline: action.offline
      };
    case UPDATE_DRAWER_STATE:
      return {
        ...state,
        drawerOpened: action.opened
      };
    case OPEN_SNACKBAR:
      return {
        ...state,
        snackbarOpened: true
      };
    case CLOSE_SNACKBAR:
      return {
        ...state,
        snackbarOpened: false
      };
    default:
      return state;
  }
};

export default app;
