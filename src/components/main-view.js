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

import { APP_TITLE } from '../../config.GENERATED.SECRET.js';

// We are lazy loading its reducer.
import editor from '../reducers/editor.js';
import collection from '../reducers/collection.js';
import prompt from '../reducers/prompt.js';
import comments from '../reducers/comments.js';
store.addReducers({
	editor,
	collection,
	prompt,
	comments
});

import {
	DEV_MODE,
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
	selectUserReadingListCount,
	selectUserMayViewUnpublished,
	selectUserMayViewApp,
	selectUserPermissionsFinal,
} from '../selectors.js';

import {
	keyboardNavigates
} from '../reducers/app.js';

import { 
	connectLivePublishedCards,
	connectLiveUnpublishedCards,
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
	updateHoveredCard,
	PAGE_DEFAULT,
	PAGE_COMMENT,
	PAGE_MAINTENANCE,
	PAGE_404
} from '../actions/app.js';

// These are the elements needed by this element.
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

			#may-view-warning {
				display:none;
				flex-direction:column;
				justify-content:center;
				align-items: center;
			}

			#may-view-warning div {
				max-width:50%;
				text-align:center;
			}

			#may-view-warning h3 {
				font-style:italic;
				font-size:3.0em;
				color: var(--app-dark-text-color-subtle);
			}

			.may-not-view #may-view-warning {
				position:absolute;
				height: 100%;
				width: 100%;
				top: 0;
				left: 0;
				background-color: white;
				display:flex;
				/* This is a hack to ensure the message shows up over the action
				buttons, see the note in card-stage for their style and why it's
				set. */
				z-index:2;
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

			[hidden] {
				display:none;
			}

		</style>

		<div @mousemove=${this._handleMouseMove} class='container ${this._mayViewApp ? '' : 'may-not-view'}'>
			<find-dialog></find-dialog>
			<compose-dialog></compose-dialog>
			<card-preview .card=${this._activePreviewCard} .x=${this._previewCardX} .y=${this._previewCardY}></card-preview>
			<!-- Header -->
			<div class='header' ?hidden=${!this._headerPanelOpen}>
				<div class='inner'>
					<div main-title>${this._appTitleFirstPart}<span>${this._appTitleSecondPart}</span></div>
					<div class='spacer'></div>
					<nav class="toolbar-list">
						${this._sections && Object.keys(this._sections).length > 0 ? 
		html`${repeat(Object.values(this._sections), (item) => item.id, (item) => html`
							<a ?selected=${this._page === PAGE_DEFAULT && item.id == this._activeSectionId} href='${urlForCard(getDefaultCardIdForSection(item))}?${FORCE_COLLECTION_URL_PARAM}'>${item.title}</a>
							`)}` :
		html`<a ?selected="${this._page === PAGE_DEFAULT}" href=${'/' + PAGE_DEFAULT}><em>Loading...</em></a>`
}
						<a ?selected=${this._recentTabSelected} href=${'/' + PAGE_DEFAULT + '/has-content/sort/recent/'}>Recent</a>
						<a class='icon-item' title='Your reading list' ?selected=${this._readingListTabSelected} href=${'/' + PAGE_DEFAULT + '/reading-list/'}>${playlistPlayIcon}<span>${this._userReadingListCount}</span></a>
						<a class='icon-item' title='Your stars' ?selected=${this._starsTabSelected} href=${'/' + PAGE_DEFAULT + '/starred/'}>${starIcon}<span>${this._userStarsCount}</span></a>
						<a class='icon-item' title="Cards you haven't read yet" ?selected=${this._unreadTabSelected} href=${'/' + PAGE_DEFAULT + '/unread/'}>${visibilityIcon}<span>${this._userUnreadCount}</span></a>
					</nav>
					<div class='spacer dev'>
						${this._devMode ? html`DEVMODE` : ''}
					</div>
					<user-chip></user-chip>
				</div>
			</div>

			<!-- Main content -->
			<main role="main" class="main-content">
				<card-view class="page" ?active="${this._page === PAGE_DEFAULT}"></card-view>
				<comment-redirect-view class='page' ?active="${this._page === PAGE_COMMENT}"></comment-redirect-view>
				<my-view404 class="page" ?active="${this._page === PAGE_404}"></my-view404>
				<maintenance-view class='page' ?active="${this._page === PAGE_MAINTENANCE}"></maintenance-view>
				<div id='may-view-warning'>
					<div ?hidden=${!this._userPermissionsFinal}> 
						<h2>Log in required</h2>
						<p>You don't have access to this web app.</p>
						<p>Try signing in with a Google account that does.</p>
						<p>(Using the button in the upper right corner.)</p>
					</div>
					<div ?hidden=${this._userPermissionsFinal}>
						<h3>Loading...</h3>
					</div>
				</div>
			</main>
		</div>
		`;
	}

	static get properties() {
		return {
			_page: { type: String },
			_headerPanelOpen: {type: Boolean },
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
			_mayViewUnpublished : { type:Boolean },
			_mayViewApp: { type:Boolean },
			_userPermissionsFinal: { type:Boolean },
		};
	}

	get appTitle() {
		return APP_TITLE;
	}

	get _appTitleFirstPart() {
		return this.appTitle.startsWith('The ') ? 'The ' : '';
	}

	get _appTitleSecondPart() {
		return this.appTitle.substring(this._appTitleFirstPart.length);
	}

	firstUpdated() {
		window.addEventListener('resize', () => this._updatePreviewSize());
		this._updatePreviewSize();
		window.addEventListener('keydown', e => this._handleKeyPressed(e));
		this.addEventListener('card-hovered', e => this._handleCardHovered(e));
	}

	_connectViewAppData() {
		connectLivePublishedCards(store);
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

	stateChanged(state) {
		this._card = selectActiveCard(state) || {};
		this._headerPanelOpen = state.app.headerPanelOpen;
		this._page = state.app.page;
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
		this._mayViewUnpublished = selectUserMayViewUnpublished(state);
		this._mayViewApp = selectUserMayViewApp(state);
		this._userPermissionsFinal = selectUserPermissionsFinal(state);
	}

	updated(changedProps) {
		if (changedProps.has('_mayViewUnpublished')) {
			if (this._mayViewUnpublished) {
				connectLiveUnpublishedCards(store);
			} else {
				//TODO: disconnectLiveUnpublishedCards here.
			}
		}
		if (changedProps.has('_mayViewApp')) {
			if (this._mayViewApp) {
				//We must have not been able to view the app by default but our user
				//says we are now.
				this._connectViewAppData();
			} else {
				//TODO: disconnet all live data here
			}
		}
	}
}

window.customElements.define('main-view', MainView);
