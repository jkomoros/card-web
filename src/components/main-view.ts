import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	APP_TITLE,
	USER_DOMAIN
} from '../config.GENERATED.SECRET.js';

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
	selectActiveCard,
	selectActivePreviewCard,
	selectExpandedTabConfig,
	selectActiveCollectionDescription,
	selectCountsForTabs,
	selectPreviewCardX,
	selectPreviewCardY,
	selectUserMayViewUnpublished,
	selectUserMayViewApp,
	selectUserPermissionsFinal,
	selectKeyboardNavigates,
	selectUid,
	selectBadgeMap,
	selectExpandedPrimaryReferenceBlocksForPreviewCard
} from '../selectors.js';

import {
	connectLivePublishedCards,
	connectLiveUnpublishedCards,
	connectLiveSections,
	connectLiveTags,
	connectLiveAuthors,
	connectLiveThreads,
	connectLiveMessages,
	connectLiveUnpublishedCardsForUser,
} from '../actions/database.js';

import {
	DEV_MODE
} from '../firebase.js';

import {
	openFindDialog
} from '../actions/find.js';

// These are the actions needed by this element.
import {
	navigateToNextCard,
	navigateToPreviousCard,
	hoveredCardMouseMoved,
	updateHoveredCard,
	doCommit,
	PAGE_DEFAULT,
	PAGE_COMMENT,
	PAGE_MAINTENANCE,
	PAGE_404,
	PAGE_PERMISSIONS
} from '../actions/app.js';

// These are the elements needed by this element.
import './user-chip.js';
import './find-dialog.js';
import './compose-dialog.js';
import './configure-collection-dialog.js';
import './card-preview.js';
import './multi-edit-dialog.js';
import { 
	CARD_WIDTH_IN_EMS,
	CARD_HEIGHT_IN_EMS
} from './card-renderer.js';

import {
	BadgeMap,
	Card,
	State,
	Uid,
	ExpandedTabConfig,
} from '../types.js';

import {
	CollectionDescription
} from '../collection_description.js';

import {
	ExpandedReferenceBlocks
} from '../reference_blocks.js';

import { PageViewElement } from './page-view-element.js';

import {
	CardHoveredEvent,
	CARD_HOVERED_EVENT_NAME
} from '../events.js';

@customElement('main-view')
class MainView extends connect(store)(PageViewElement) {

	@state()
	_page: string;

	@state()
	_headerPanelOpen: boolean;

	@state()
	_editing: boolean;

	@state()
	_devMode: boolean;

	@state()
	_card: Card;

	@state()
	_collectionDescription: CollectionDescription;

	@state()
	_tabs: ExpandedTabConfig;

	@state()
	_countsForTabs : {[serializedCollectionDescription : string] : number }

	@state()
	_keyboardNavigates: boolean;

	@state()
	_activePreviewCard: Card;

	@state()
	_previewCardX : number;

	@state()
	_previewCardY : number;

	@state()
	_previewCardReferenceBlocks: ExpandedReferenceBlocks;

	@state()
	_mayViewUnpublished : boolean;

	@state()
	_mayViewApp: boolean;

	@state()
	_userPermissionsFinal: boolean;

	@state()
	_uid : Uid;

	@state()
	_badgeMap: BadgeMap;

	static override styles = [
		css`
			.container {
				height:100vh;
				width: 100vw;
				display:flex;
				flex-direction:column;
				background-color: var(--app-light-text-color);
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

			[data-main-title] {
				font-family: var(--app-header-font-family);
				font-weight:bold;
				font-size: 26px;
				color: var(--app-dark-text-color-light);
			}

			[data-main-title] span {
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

			.toolbar-list > a[data-selected] {
				color: var(--app-header-selected-color);
				border-bottom: 4px solid var(--app-header-selected-color);
			}

			.toolbar-list > a > svg {
				fill: var(--app-header-text-color);
			}

			.toolbar-list > a[data-selected] > svg {
				fill: var(--app-header-selected-color);
			}

			.toolbar-list > a:hover > svg {
				fill: var(--app-header-selected-color);
			}

			.toolbar-list > a:hover {
				color: var(--app-header-selected-color);
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
			div [role=main] {
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
				display:none !important;
			}
		`
	];

	override render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<div @mousemove=${this._handleMouseMove} class='container ${this._mayViewApp ? '' : 'may-not-view'}'>
			<multi-edit-dialog></multi-edit-dialog>
			<find-dialog></find-dialog>
			<compose-dialog></compose-dialog>
			<configure-collection-dialog></configure-collection-dialog>
			<card-preview .card=${this._activePreviewCard} .x=${this._previewCardX} .y=${this._previewCardY} .badgeMap=${this._badgeMap} .expandedReferenceBlocks=${this._previewCardReferenceBlocks}></card-preview>
			<!-- Header -->
			<div class='header' ?hidden=${!this._headerPanelOpen}>
				<div class='inner'>
					<div data-main-title>${this._appTitleFirstPart}<span>${this._appTitleSecondPart}</span></div>
					<div class='spacer'></div>
					<nav class="toolbar-list">
						${this._tabs.map(tab => html`<a class='${tab.icon ? 'icon-item' : ''}' title='${tab.display_name}' ?data-selected=${tab.expandedCollection && tab.expandedCollection.equivalent(this._collectionDescription)} href='${tab.href ? tab.href : '/' + PAGE_DEFAULT + '/' + tab.expandedCollection.serializeShort()}' target=${tab.href ? '_blank': ''} ?hidden=${tab.hide || (tab.hideIfEmpty && this._countsForTabs[tab.expandedCollection.serialize()] === 0)}>${tab.icon ? html`${tab.icon} ${tab.count ? html`<span>${this._countsForTabs[tab.expandedCollection.serialize()]}</span>` : ''}` : tab.italics ? html`<em>${tab.display_name}</em>` : html`${tab.display_name}`}</a>`)}
					</nav>
					<div class='spacer dev'>
						${this._devMode ? html`DEVMODE` : ''}
					</div>
					<user-chip></user-chip>
				</div>
			</div>

			<!-- Main content -->
			<div role="main" class="main-content">
				<card-view class="page" ?active="${this._page === PAGE_DEFAULT}"></card-view>
				<comment-redirect-view class='page' ?active="${this._page === PAGE_COMMENT}"></comment-redirect-view>
				<my-view404 class="page" ?active="${this._page === PAGE_404}"></my-view404>
				<maintenance-view class='page' ?active="${this._page === PAGE_MAINTENANCE}"></maintenance-view>
				<permissions-view class='page' ?active="${this._page === PAGE_PERMISSIONS}"></permissions-view>
				<div id='may-view-warning'>
					<div ?hidden=${!this._userPermissionsFinal}> 
						<h2>Log in required</h2>
						<p>You don't have access to this web app.</p>
						<p>Try signing in with a Google account that does.</p>
						<p>(Using the button in the upper right corner.)</p>
						${USER_DOMAIN ? html`<p>Note: user accounts associated with ${USER_DOMAIN} get special permissions. Try logging in to an account from that domain.</p>`: ''}
					</div>
					<div ?hidden=${this._userPermissionsFinal}>
						<h3>Loading...</h3>
					</div>
				</div>
			</div>
		</div>
		`;
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

	override firstUpdated() {
		window.addEventListener('resize', () => this._handleResize());
		this._handleResize();
		window.addEventListener('keydown', e => this._handleKeyPressed(e));
		this.addEventListener(CARD_HOVERED_EVENT_NAME, (e : CardHoveredEvent) => this._handleCardHovered(e));
	}

	_connectViewAppData() {
		connectLivePublishedCards();
		connectLiveSections();
		connectLiveTags();
		connectLiveAuthors();
		connectLiveThreads();
		connectLiveMessages();
	}

	_handleResize() {
		this._updateInnerHeight();
		this._updatePreviewSize();
	}

	_updateInnerHeight() {
		//Safari sizes 100vh layouts to ignore the address bar and toolbar,
		//which can be HUGE in landscape mode. So set it to innerHeight
		//automatically.  See
		//https://medium.com/@susiekim9/how-to-compensate-for-the-ios-viewport-unit-bug-46e78d54af0d
		const ele = this.shadowRoot.querySelector('.container') as HTMLElement;
		ele.style.height = '' + window.innerHeight + 'px';
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

	_handleKeyPressed(e : KeyboardEvent) {
		if (e.key == 'Enter' && e.metaKey) {
			e.stopPropagation();
			e.preventDefault();
			store.dispatch(doCommit());
			return;
		}
		//Don't move the slide selection when editing!
		if (!this._keyboardNavigates) return;
		switch (e.key) {
		case 'f':
			if (!e.metaKey && !e.ctrlKey) return;
			e.stopPropagation();
			e.preventDefault();
			store.dispatch(openFindDialog());
			break;
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

	_handleCardHovered(e : CardHoveredEvent) {
		store.dispatch(hoveredCardMouseMoved());
		store.dispatch(updateHoveredCard(e.detail.x, e.detail.y, e.detail.card));
	}

	_handleMouseMove() {
		store.dispatch(hoveredCardMouseMoved());
	}

	override stateChanged(state : State) {
		this._card = selectActiveCard(state);
		this._headerPanelOpen = state.app.headerPanelOpen;
		this._page = state.app.page;
		this._editing = state.editor.editing;
		this._devMode = DEV_MODE;
		this._collectionDescription = selectActiveCollectionDescription(state);
		this._tabs = selectExpandedTabConfig(state);
		this._countsForTabs = selectCountsForTabs(state);
		this._keyboardNavigates = selectKeyboardNavigates(state);
		this._activePreviewCard = selectActivePreviewCard(state);
		this._previewCardX = selectPreviewCardX(state);
		this._previewCardY = selectPreviewCardY(state);
		this._previewCardReferenceBlocks = selectExpandedPrimaryReferenceBlocksForPreviewCard(state);
		this._mayViewUnpublished = selectUserMayViewUnpublished(state);
		this._mayViewApp = selectUserMayViewApp(state);
		this._userPermissionsFinal = selectUserPermissionsFinal(state);
		this._uid = selectUid(state);
		this._badgeMap = selectBadgeMap(state);
	}

	override updated(changedProps : Map<string, any>) {
		if (changedProps.has('_mayViewUnpublished')) {
			if (this._mayViewUnpublished) {
				connectLiveUnpublishedCards();
			} else {
				//TODO: disconnectLiveUnpublishedCards here.
			}
		}
		if (changedProps.has('_uid')) {
			connectLiveUnpublishedCardsForUser(this._uid);
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

declare global {
	interface HTMLElementTagNameMap {
	  'main-view': MainView;
	}
}
