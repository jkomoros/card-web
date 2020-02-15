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
import { connect } from 'pwa-helpers/connect-mixin.js';
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
	selectPreviewCardY,
	selectReadingListTabSelected,
	selectStarsTabSelected,
	selectUnreadTabSelected,
	selectUserStarsCount,
	selectUserUnreadCount,
	selectUserReadingListCount
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
	navigateToNextCard,
	navigateToPreviousCard,
	urlForCard,
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

import {
	playlistPlayIcon,
	starIcon,
	visibilityIcon
} from './my-icons';

class MainView extends connect(store)(LitElement) {
	render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<style>
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

			.toolbar-list {
				display:flex;
			}

			.toolbar-list > a {
				display: inline-block;
				color: var(--app-header-text-color);
				text-decoration: none;
				line-height: 30px;
				padding: 4px 8px;
				font-size: 14px;
				/* make it so that when it's selected and there's a border there's no jump */
				border-bottom: 4px solid transparent;
			}

			 .toolbar-list > a.icon-item {
				display:inline-flex;
				flex-direction: column;
				justify-content: center;
				position:relative;	
			}

			.toolbar-list > a.icon-item span {
				position:absolute;
				display:inline-block;
				bottom:-0.75em;
				right:0.25em;
				font-size:12px;
			}

			.toolbar-list > a[selected] {
				color: var(--app-header-selected-color);
				border-bottom: 4px solid var(--app-header-selected-color);
			}

			.toolbar-list > a > svg {
				fill: var(--app-header-text-color);
			}

			.toolbar-list > a[selected] > svg {
				fill: var(--app-header-selected-color);
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
			<card-preview .card=${this._activePreviewCard} .x=${this._previewCardX} .y=${this._previewCardY}></card-preview>
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
						<a ?selected=${this._recentTabSelected} href="/c/has-content/sort/recent/">Recent</a>
						<a class='icon-item' title='Your reading list' ?selected=${this._readingListTabSelected} href="/c/reading-list/">${playlistPlayIcon}<span>${this._userReadingListCount}</span></a>
						<a class='icon-item' title='Your stars' ?selected=${this._starsTabSelected} href="/c/starred/">${starIcon}<span>${this._userStarsCount}</span></a>
						<a class='icon-item' title="Cards you haven't read yet" ?selected=${this._unreadTabSelected} href="/c/unread/">${visibilityIcon}<span>${this._userUnreadCount}</span></a>
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
			_readingListTabSelected: {type: Boolean},
			_starsTabSelected: {type:Boolean},
			_userStarsCount: {type:Number},
			_userReadingListCount: {type:Number},
			_userUnreadCount: {type:Number},
			_unreadTabSelected: {type:Boolean},
			_activePreviewCard: { type:Object },
			_previewCardX : { type:Number },
			_previewCardY : { type:Number },
		};
	}

	firstUpdated() {
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
		this._readingListTabSelected = selectReadingListTabSelected(state);
		this._starsTabSelected = selectStarsTabSelected(state);
		this._userStarsCount = selectUserStarsCount(state);
		this._userUnreadCount = selectUserUnreadCount(state);
		this._userReadingListCount = selectUserReadingListCount(state);
		this._unreadTabSelected = selectUnreadTabSelected(state);
		this._activePreviewCard = selectActivePreviewCard(state);
		this._previewCardX = selectPreviewCardX(state);
		this._previewCardY = selectPreviewCardY(state);
	}
}

window.customElements.define('main-view', MainView);
