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
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

// We are lazy loading its reducer.
import data from '../reducers/data.js';
import editor from '../reducers/editor.js';
import collection from '../reducers/collection.js';
import prompt from '../reducers/prompt.js';
import comments from '../reducers/comments.js';
store.addReducers({
	data,
	editor,
	collection,
	prompt,
	comments
});

import {
	DEV_MODE,
	useServiceWorker,
} from '../actions/database.js';

import {
	getDefaultCardIdForSection
} from '../reducers/data.js';

import {
	selectActiveCard,
	selectActiveSectionId,
	selectRecentTabSelected,
	selectActivePreviewCard,
	selectPreviewCardX,
	selectPreviewCardY
} from '../selectors.js';

import {
	keyboardNavigates
} from '../reducers/app.js';

import { 
	connectLiveCards,
	connectLiveSections,
	connectLiveTags,
	connectLiveAuthors,
	connectLiveThreads,
	connectLiveMessages,
} from '../actions/database.js';

import {
	openFindDialog
} from '../actions/find.js';

import {
	FORCE_COLLECTION_URL_PARAM
} from '../actions/collection.js';

// These are the actions needed by this element.
import {
	navigated,
	navigateToNextCard,
	navigateToPreviousCard,
	updateOffline,
	urlForCard,
	turnMobileMode,
	hoveredCardMouseMoved,
	updateHoveredCard
} from '../actions/app.js';

// These are the elements needed by this element.
import './snack-bar.js';
import './user-chip.js';
import './find-dialog.js';
import './compose-dialog.js';
import './card-preview.js';
import { 
	CARD_WIDTH_IN_EMS,
	CARD_HEIGHT_IN_EMS
} from './base-card';

class CompendiumApp extends connect(store)(LitElement) {
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

			.container {
				height:100vh;
				width: 100vw;
				display:flex;
				flex-direction:column;
			}

			.header {
				padding: 0 1em;
				box-sizing:border-box;

				width: 100%;
				text-align: center;
				background-color: var(--app-header-background-color);
				color: var(--app-header-text-color);
				border-bottom: 1px solid var(--app-divider-color);
			}

			.header > .inner {
				/* bug in many browsers with nested flexboxes; splitting like this fixes it. See issue #25 */
				display:flex;
				flex-direction:row;
				align-items: center; 
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
				font-family: var(--app-header-font-family);
				font-weight:bold;
				font-size: 26px;
				color: var(--app-dark-text-color-light);
			}

			[main-title] span {
				color: var(--app-primary-color);
			}

			.toolbar-list > a {
				display: inline-block;
				color: var(--app-header-text-color);
				text-decoration: none;
				line-height: 30px;
				padding: 4px 16px;
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
				position:relative;
			}

			.page {
				display: none;
			}

			.page[active] {
				display: block;
			}
		</style>

		<div @mousemove=${this._handleMouseMove} class='container'>
			<find-dialog></find-dialog>
			<compose-dialog></compose-dialog>
			<card-preview .card=${this._activePreviewCard} .x=${this._previewCardX} .y=${this._previewCardY} .stars=${this._stars} .reads=${this._reads}></card-preview>
			<!-- Header -->
			<div class='header' ?hidden=${!this._headerPanelOpen}>
				<div class='inner'>
					<div main-title>The <span>Compendium</span></div>
					<div class='spacer'></div>
					<nav class="toolbar-list">
						${this._sections && Object.keys(this._sections).length > 0 ? 
		html`${repeat(Object.values(this._sections), (item) => item.id, (item) => html`
							<a ?selected=${this._page === 'c' && item.id == this._activeSectionId} href='${urlForCard(getDefaultCardIdForSection(item))}?${FORCE_COLLECTION_URL_PARAM}'>${item.title}</a>
							`)}` :
		html`<a ?selected="${this._page === 'c'}" href="/c"><em>Loading...</em></a>`
}
						<a ?selected=${this._recentTabSelected} href="/c/has-content/sort/recent/_">Recent</a>
					</nav>
					<div class='spacer dev'>
						${this._devMode ? html`DEVMODE` : ''}
					</div>
					<user-chip></user-chip>
				</div>
			</div>

			<!-- Main content -->
			<main role="main" class="main-content">
				<card-view class="page" ?active="${this._page === 'c'}"></card-view>
				<comment-redirect-view class='page' ?active="${this._page === 'comment'}"></comment-redirect-view>
				<my-view404 class="page" ?active="${this._page === 'view404'}"></my-view404>
				<maintenance-view class='page' ?active="${this._page === 'maintenance'}"></maintenance-view>
			</main>
		</div>
		<snack-bar ?active="${this._snackbarOpened}">
				You are now ${this._offline ? 'offline' : 'online'}.</snack-bar>
		`;
	}

	static get properties() {
		return {
			_page: { type: String },
			_snackbarOpened: { type: Boolean },
			_headerPanelOpen: {type: Boolean },
			_offline: { type: Boolean },
			_editing: { type: Boolean },
			_devMode: { type: Boolean },
			_card: { type: Object },
			_sections : {type: Object},
			_activeCardSectionId: {type:String},
			_keyboardNavigates: {type:Boolean},
			_swRegistration : {type:Object},
			_recentTabSelected: {type:Boolean},
			_activePreviewCard: { type:Object },
			_previewCardX : { type:Number },
			_previewCardY : { type:Number },
			_reads : { type:Object },
			_stars : { type:Object }
		};
	}

	get appTitle() {
		return 'The Compendium';
	}

	constructor() {
		super();
		// To force all event listeners for gestures to be passive.
		// See https://www.polymer-project.org/3.0/docs/devguide/settings#setting-passive-touch-gestures
		setPassiveTouchGestures(true);
		//Index.html will try calling this, but likely before we're fully
		//booted, so try here too.
		navigator.serviceWorker.getRegistration('/').then(registration => {
			this.serviceWorkerRegistered(registration);
		});
	}

	firstUpdated() {
		installRouter((location) => store.dispatch(navigated(decodeURIComponent(location.pathname), decodeURIComponent(location.search))));
		installOfflineWatcher((offline) => store.dispatch(updateOffline(offline)));
		installMediaQueryWatcher('(max-width: 900px)',(isMobile) => {
			store.dispatch(turnMobileMode(isMobile));
		});
		window.addEventListener('resize', () => this._updatePreviewSize());
		this._updatePreviewSize();
		window.addEventListener('keydown', e => this._handleKeyPressed(e));
		this.addEventListener('card-hovered', e => this._handleCardHovered(e));
		connectLiveCards(store);
		connectLiveSections(store);
		connectLiveTags(store);
		connectLiveAuthors(store);
		connectLiveThreads(store);
		connectLiveMessages(store);
	}

	_updatePreviewSize() {
		const ele = this.shadowRoot.querySelector('card-preview');
		if (!ele) return;

		// The width should never be more than 40% of available size, which also
		// guarantees it can fit (as long as cardOffset isn't too large).
		const targetWidth = window.innerWidth * 0.4;
		const targetHeight = window.innerHeight * 0.4;

		let targetSize = 10.0;

		if (targetWidth / targetHeight > CARD_WIDTH_IN_EMS / CARD_HEIGHT_IN_EMS) {
			//The width is larger than height, meaning height is most constraining.
			targetSize = targetHeight / CARD_HEIGHT_IN_EMS;
		} else {
			//The height is larger than width, meaning width is most constarining
			targetSize = targetWidth / CARD_WIDTH_IN_EMS;
		}
		
		ele.previewSize = Math.round(targetSize);
	}

	_handleKeyPressed(e) {
		//Don't move the slide selection when editing!
		if (!this._keyboardNavigates) return;
		switch (e.key) {
		case 'f':
			if (!e.metaKey && !e.ctrlKey) return;
			e.stopPropagation();
			e.preventDefault();
			store.dispatch(openFindDialog());
		case 'ArrowDown':
		case 'ArrowRight':
		case ' ':
			e.stopPropagation();
			e.preventDefault();
			store.dispatch(navigateToNextCard());
			break;
		case 'ArrowUp':
		case 'ArrowLeft':
			e.stopPropagation();
			e.preventDefault();
			store.dispatch(navigateToPreviousCard());
			break;
		}
	}

	_handleCardHovered(e) {
		store.dispatch(hoveredCardMouseMoved());
		store.dispatch(updateHoveredCard(e.detail.x, e.detail.y, e.detail.card));
	}

	_handleMouseMove() {
		store.dispatch(hoveredCardMouseMoved());
	}

	updated(changedProps) {
		if (changedProps.has('_card')) {
			const pageTitle = this.appTitle + (this._card.title ? ' - ' + this._card.title : '');
			updateMetadata({
				title: pageTitle,
				description: pageTitle
				// This object also takes an image property, that points to an img src.
			});
		}
	}

	serviceWorkerRegistered(registration) {
		//This might be called by index.html, or by our own constructor. We call
		//from both to ensure that no matter which way the race resolves we get
		//called.

		//It's possible this is called twice.
		if (this._swRegistration) return;
		//It's possible we get called via our constructor before it's alive,
		//when it will be null.
		if (!registration) return;
		this._swRegistration = registration;
		useServiceWorker(registration);
	}

	stateChanged(state) {
		this._card = selectActiveCard(state) || {};
		this._headerPanelOpen = state.app.headerPanelOpen;
		this._page = state.app.page;
		this._offline = state.app.offline;
		this._snackbarOpened = state.app.snackbarOpened;
		this._editing = state.editor.editing;
		this._devMode = DEV_MODE;
		this._sections = state.data.sections;
		this._activeSectionId = selectActiveSectionId(state);
		this._keyboardNavigates = keyboardNavigates(state);
		this._recentTabSelected = selectRecentTabSelected(state);
		this._activePreviewCard = selectActivePreviewCard(state);
		this._previewCardX = selectPreviewCardX(state);
		this._previewCardY = selectPreviewCardY(state);
		this._stars = state.user ? state.user.stars : null;
		this._reads = state.user ? state.user.reads : null;
	}
}

window.customElements.define('compendium-app', CompendiumApp);
