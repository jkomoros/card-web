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
  OPEN_COMMENTS_PANEL,
  CLOSE_COMMENTS_PANEL,
  OPEN_CARD_INFO_PANEL,
  CLOSE_CARD_INFO_PANEL,
  OPEN_CARDS_DRAWER_PANEL,
  CLOSE_CARDS_DRAWER_PANEL,
  ENABLE_PRESENTATION_MODE,
  DISABLE_PRESENTATION_MODE
} from '../actions/app.js';

const COMMENTS_PANEL_DEFAULT_VALUE = true;
const CARD_INFO_PANEL_DEFAULT_VALUE = false;
const CARDS_DRAWER_PANEL_DEFAULT_VALUE = true;

const INITIAL_STATE = {
  location: '',
  page: '',
  pageExtra: '',
  offline: false,
  snackbarOpened: false,
  commentsPanelOpen: COMMENTS_PANEL_DEFAULT_VALUE,
  cardInfoPanelOpen: CARD_INFO_PANEL_DEFAULT_VALUE,
  cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
  presentationMode: false
};

const app = (state = INITIAL_STATE, action) => {
  switch (action.type) {
    case UPDATE_PAGE:
      return {
        ...state,
        location: action.location,
        page: action.page,
        pageExtra: action.pageExtra
      };
    case UPDATE_OFFLINE:
      return {
        ...state,
        offline: action.offline
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
    case OPEN_COMMENTS_PANEL:
      //Only one of cardInfo and comments panels can be open at a time.
      return {
        ...state,
        commentsPanelOpen: true,
        cardInfoPanelOpen: false
      }
    case CLOSE_COMMENTS_PANEL:
      return {
        ...state,
        commentsPanelOpen: false
      }
    case OPEN_CARD_INFO_PANEL:
      //Only one of cardInfo and comments panels can be open at a time.
      return {
        ...state,
        cardInfoPanelOpen: true,
        commentsPanelOpen: false
      }
    case CLOSE_CARD_INFO_PANEL:
      return {
        ...state,
        cardInfoPanelOpen: false
      }
    case OPEN_CARDS_DRAWER_PANEL:
      return {
        ...state,
        cardsDrawerPanelOpen: true
      }
    case CLOSE_CARDS_DRAWER_PANEL: 
      return {
        ...state,
        cardsDrawerPanelOpen: false
      }
    case ENABLE_PRESENTATION_MODE:
      return {
        ...state,
        cardsDrawerPanelOpen: false,
        cardInfoPanelOpen: false,
        commentsPanelOpen: false,
        presentationMode: true
      }
    case DISABLE_PRESENTATION_MODE:
      return {
        ...state,
        cardsDrawerPanelOpen: CARDS_DRAWER_PANEL_DEFAULT_VALUE,
        commentsPanelOpen: COMMENTS_PANEL_DEFAULT_VALUE,
        cardInfoPanelOpen: CARD_INFO_PANEL_DEFAULT_VALUE,
        presentationMode:false
      }
    default:
      return state;
  }
};

export default app;
