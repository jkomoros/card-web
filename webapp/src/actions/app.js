/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

export const UPDATE_PAGE = 'UPDATE_PAGE';
export const UPDATE_OFFLINE = 'UPDATE_OFFLINE';
export const UPDATE_DRAWER_STATE = 'UPDATE_DRAWER_STATE';
export const OPEN_SNACKBAR = 'OPEN_SNACKBAR';
export const CLOSE_SNACKBAR = 'CLOSE_SNACKBAR';

//if silent is true, then just passively updates the URL to reflect what it should be.
export const navigatePathTo = (path, silent) => (dispatch) => {
    if (silent) {
      window.history.replaceState({}, '', path);
      return;
    }
    window.history.pushState({}, '', path);
    dispatch(navigated(decodeURIComponent(path)));
}

export const navigateToNextCard = () => (dispatch, getState) => {
  const state = getState();
  let index = state.data.activeCardIndex;
  index++;
  const collection = state.data.collection;
  let newId = collection[index];
  if (!newId) return;
  dispatch(navigateToCard(newId));
}

export const navigateToPreviousCard = () => (dipsatch, getState) => {
  const state = getState();
  let index = state.data.activeCardIndex;
  index--;
  const collection = state.data.collection;
  let newId = collection[index];
  if (!newId) return;
  dispatch(navigateToCard(newId));
}

export const navigateToCard = (cardOrId, silent) => (dispatch) => {
  let id = cardOrId
  if (typeof cardOrId === 'object') {
    id = cardOrId.name;
  }
  dispatch(navigatePathTo('/c/' + id, silent));
}

export const navigated = (path) => (dispatch) => {

  // Extract the page name from path.
  const page = path === '/' ? 'c' : path.slice(1);

  // Any other info you might want to extract from the path (like page type),
  // you can do here
  dispatch(loadPage(page));

  // Close the drawer - in case the *path* change came from a link in the drawer.
  dispatch(updateDrawerState(false));
};

const loadPage = (pathname) => (dispatch) => {

  //pathname is the whole path minus starting '/', like 'c/VIEW_ID'
  let pieces = pathname.split("/")

  let page = pieces[0];
  let pageExtra = pieces.length < 2 ? '' : pieces.slice(1).join("/");

  switch(page) {
    case 'c':
      import('../components/card-view.js').then((module) => {
        // Put code in here that you want to run every time when
        // navigating to view1 after my-view1.js is loaded.
      });
      break;
    case 'view2':
      import('../components/my-view2.js');
      break;
    case 'view3':
      import('../components/my-view3.js');
      break;
    default:
      page = 'view404';
      import('../components/my-view404.js');
  }

  dispatch(updatePage(pathname, page, pageExtra));
};

const updatePage = (location, page, pageExtra) => {
  return {
    type: UPDATE_PAGE,
    location,
    page,
    pageExtra
  };
};

let snackbarTimer;

export const showSnackbar = () => (dispatch) => {
  dispatch({
    type: OPEN_SNACKBAR
  });
  window.clearTimeout(snackbarTimer);
  snackbarTimer = window.setTimeout(() =>
    dispatch({ type: CLOSE_SNACKBAR }), 3000);
};

export const updateOffline = (offline) => (dispatch, getState) => {
  // Show the snackbar only if offline status changes.
  if (offline !== getState().app.offline) {
    dispatch(showSnackbar());
  }
  dispatch({
    type: UPDATE_OFFLINE,
    offline
  });
};

export const updateDrawerState = (opened) => {
  return {
    type: UPDATE_DRAWER_STATE,
    opened
  };
};
