/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

import { LitElement, html } from '@polymer/lit-element';
import { setPassiveTouchGestures } from '@polymer/polymer/lib/utils/settings.js';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { installOfflineWatcher } from 'pwa-helpers/network.js';
import { installRouter } from 'pwa-helpers/router.js';
import { updateMetadata } from 'pwa-helpers/metadata.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// We are lazy loading its reducer.
import data from '../reducers/data.js';
import editor from '../reducers/editor.js';
store.addReducers({
  data,
  editor
});

import { 
  connectLiveCards,
  connectLiveSections,
  doImport
} from '../actions/database.js';

// These are the actions needed by this element.
import {
  navigated,
  navigateToNextCard,
  navigateToPreviousCard,
  updateOffline,
} from '../actions/app.js';

// These are the elements needed by this element.
import './snack-bar.js';
import './user-chip.js';

class CompendiumApp extends connect(store)(LitElement) {
  render() {
    // Anything that's related to rendering should be done in here.
    return html`
    <style>
      :host {
        --app-drawer-width: 256px;
        display: block;

        --app-primary-color: #5e2b97;
        --app-secondary-color: #009688;
        --app-dark-text-color: #7f7f7f;
        --app-light-text-color: white;
        --app-section-even-color: #f7f7f7;
        --app-section-odd-color: white;

        --card-color: #FCFCFC;
        --card-shadow: 0 2px 6px #CCC;

        --app-header-background-color: white;
        --app-header-text-color: var(--app-dark-text-color);
        --app-header-selected-color: var(--app-primary-color);

        --app-drawer-background-color: var(--app-secondary-color);
        --app-drawer-text-color: var(--app-light-text-color);
        --app-drawer-selected-color: #78909C;
      }

      .container {
        height:100vh;
        width: 100vw;
        display:flex;
        flex-direction:column;
      }

      .header {
        padding: 0 1em;
        box-sizing:border-box;
        display:flex;
        flex-direction:row;
        align-items: center;
        width: 100%;
        text-align: center;
        background-color: var(--app-header-background-color);
        color: var(--app-header-text-color);
        border-bottom: 1px solid #eee;
      }

      .spacer {
        flex-grow:1;
      }

      .toolbar-list {
        align-self: flex-end;
      }

      .dev {
        font-size: 18px;
        color: red;
        font-weight:bold;
      }

      .toolbar-top {
        background-color: var(--app-header-background-color);
      }

      [main-title] {
        font-family: 'Raleway';
        font-weight:bold;
        font-size: 30px;
      }

      .toolbar-list > a {
        display: inline-block;
        color: var(--app-header-text-color);
        text-decoration: none;
        line-height: 30px;
        padding: 4px 24px;
      }

      .toolbar-list > a[selected] {
        color: var(--app-header-selected-color);
        border-bottom: 4px solid var(--app-header-selected-color);
      }

      /* Workaround for IE11 displaying <main> as inline */
      main {
        display: block;
      }

      .main-content {
        flex-grow:1;
        overflow:hidden;
      }

      .page {
        display: none;
      }

      .page[active] {
        display: block;
      }
    </style>

    <div class='container'>
      <!-- Header -->
      <div class='header'>
        <div main-title>${this.appTitle}</div>
        <div class='spacer'></div>
        <nav class="toolbar-list">
          <a ?selected="${this._page === 'c'}" href="/c">Explore</a>
        </nav>
        <div class='spacer dev'>
          ${this._devMode ? html`DEVMODE` : ""}
        </div>
        <user-chip></user-chip>
      </div>

      <!-- Main content -->
      <main role="main" class="main-content">
        <card-view class="page" ?active="${this._page === 'c'}"></card-view>
        <my-view404 class="page" ?active="${this._page === 'view404'}"></my-view404>
      </main>
    </div>
    <snack-bar ?active="${this._snackbarOpened}">
        You are now ${this._offline ? 'offline' : 'online'}.</snack-bar>
    `;
  }

  static get properties() {
    return {
      appTitle: { type: String },
      _page: { type: String },
      _snackbarOpened: { type: Boolean },
      _offline: { type: Boolean },
      _editing: { type: Boolean },
      _devMode: { type: Boolean },
    }
  }

  constructor() {
    super();
    // To force all event listeners for gestures to be passive.
    // See https://www.polymer-project.org/3.0/docs/devguide/settings#setting-passive-touch-gestures
    setPassiveTouchGestures(true);
  }

  firstUpdated() {
    installRouter((location) => store.dispatch(navigated(decodeURIComponent(location.pathname))));
    installOfflineWatcher((offline) => store.dispatch(updateOffline(offline)));
    window.addEventListener('keyup', e => this._handleKeyPressed(e));
    connectLiveCards(store);
    connectLiveSections(store);

    //Temporary, do import on boot
    //doImport();
  }

  _handleKeyPressed(e) {
    //Don't move the slide selection when editing!
    if (this._editing) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
      case " ":
        e.stopPropagation();
        e.preventDefault();
        store.dispatch(navigateToNextCard());
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.stopPropagation();
        e.preventDefault();
        store.dispatch(navigateToPreviousCard());
        break;
    }
  }

  updated(changedProps) {
    if (changedProps.has('_page')) {
      const pageTitle = this.appTitle + ' - ' + this._page;
      updateMetadata({
        title: pageTitle,
        description: pageTitle
        // This object also takes an image property, that points to an img src.
      });
    }
  }

  _menuButtonClicked() {
    store.dispatch(updateDrawerState(true));
  }

  _drawerOpenedChanged(e) {
    store.dispatch(updateDrawerState(e.target.opened));
  }

  stateChanged(state) {
    this._page = state.app.page;
    this._offline = state.app.offline;
    this._snackbarOpened = state.app.snackbarOpened;
    this._editing = state.editor.editing;
    this._devMode = DEV_MODE;
  }
}

window.customElements.define('compendium-app', CompendiumApp);
