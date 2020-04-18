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
import { installMediaQueryWatcher } from 'pwa-helpers/media-query.js';
import { installRouter } from 'pwa-helpers/router.js';
import { updateMetadata } from 'pwa-helpers/metadata.js';

import { APP_TITLE } from '../../config.GENERATED.SECRET.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// These are the actions needed by this element.
import {
	navigated,
	updateOffline,
	turnMobileMode,
	PAGE_BASIC_CARD,
} from '../actions/app.js';

// These are the elements needed by this element.
import './snack-bar.js';
import { pageRequiresMainView } from '../util.js';

import {
	selectActiveCard
} from '../selectors.js';

class CardsWebApp extends connect(store)(LitElement) {
	render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<style>
			:host {
				--app-drawer-width: 256px;
				display: block;

				--app-primary-color: #5e2b97;
				--app-primary-color-light: #bc9ae2;
				--app-primary-color-subtle: #7e57c2;
				--app-secondary-color: #009688;
				--app-secondary-color-light: #00dac6;
				--app-warning-color: #CC0000;
				--app-warning-color-light: #EE0000;

				--app-dark-text-color: #7f7f7f;
				--app-light-text-color: white;
				--app-section-even-color: #f7f7f7;
				--app-section-odd-color: white;

				--app-dark-text-color-light: #AAA;
				--app-dark-text-color-subtle: #CCC;
				--app-divider-color: #eee;

				--app-header-font-family: 'Raleway';
				--app-default-font-family: 'Source Sans Pro';

				--card-color: #FCFCFC;
				--shadow-color: #CCC;
				--unpublished-card-color: #EEE;
				--card-shadow-first-part: 0 2px 6px;
				--card-shadow: var(--card-shadow-first-part) var(--shadow-color);

				--canvas-color: ${this._devMode ? html`#bc9ae233` : html`var(--app-divider-color)`};

				--app-header-background-color: white;
				--app-header-text-color: var(--app-dark-text-color);
				--app-header-selected-color: var(--app-primary-color);

				--app-drawer-background-color: var(--app-secondary-color);
				--app-drawer-text-color: var(--app-light-text-color);
				--app-drawer-selected-color: #78909C;

				--transition-fade: 0.25s linear;
			}
		</style>

		<main-view ?active=${pageRequiresMainView(this._page)}></main-view>
		<basic-card-view ?active=${this._page == PAGE_BASIC_CARD}></basic-card-view>
		<snack-bar ?active="${this._snackbarOpened}">
				You are now ${this._offline ? 'offline' : 'online'}.</snack-bar>
		`;
	}

	static get properties() {
		return {
			_card: { type: Object },
			_page: { type: String },
			_snackbarOpened: { type: Boolean },
			_offline: { type: Boolean },
		};
	}

	get appTitle() {
		return APP_TITLE;
	}

	constructor() {
		super();
		// To force all event listeners for gestures to be passive.
		// See https://www.polymer-project.org/3.0/docs/devguide/settings#setting-passive-touch-gestures
		setPassiveTouchGestures(true);
	}

	firstUpdated() {
		installRouter((location) => store.dispatch(navigated(decodeURIComponent(location.pathname), decodeURIComponent(location.search))));
		installOfflineWatcher((offline) => store.dispatch(updateOffline(offline)));
		installMediaQueryWatcher('(max-width: 900px)',(isMobile) => {
			store.dispatch(turnMobileMode(isMobile));
		});
	}

	updated(changedProps) {
		if (changedProps.has('_card') && this._card) {
			const pageTitle = (this._card.title ? this._card.title + ' - ' : '') + this.appTitle ;
			updateMetadata({
				title: pageTitle,
				description: pageTitle
				// This object also takes an image property, that points to an img src.
			});
		}
	}

	stateChanged(state) {
		this._card = selectActiveCard(state);
		this._page = state.app.page;
		this._offline = state.app.offline;
		this._snackbarOpened = state.app.snackbarOpened;
	}
}

window.customElements.define('cards-web-app', CardsWebApp);
