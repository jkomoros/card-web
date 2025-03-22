
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';
import { 
	selectUserReads,
	selectCards,
	selectUserReadingListMap,
	selectPage,
	selectCtrlKeyPressed
} from '../selectors.js';

import { toggleOnReadingList } from '../actions/user.js';

import {
	PAGE_DEFAULT, 
	PAGE_BASIC_CARD
} from '../actions/app.js';

import {
	CARD_TYPE_CONFIGURATION
} from '../../shared/card_fields.js';

import * as icons from '../../shared/icons.js';

import {
	CardBooleanMap,
	CardFieldTypeEditable,
	CardID,
	Cards,
	FilterMap,
	State,
	IconName
} from '../types.js';

import {
	makeCardHoveredEvent
} from '../events.js';

@customElement('card-link')
class CardLink extends connect(store)(LitElement) {
	
	@property({ type : String })
		card: CardID;

	@property({ type : String })
		href: string;
	
	@property({ type : String})
		auto: CardFieldTypeEditable;

	@property({ type : Boolean })
		strong: boolean;

	@property({ type : Boolean })
		noNavigate: boolean;

	@property({ type: String })
		iconName? : IconName;

	@property({ type: Boolean })
		subtle = false;

	@state()
		_reads: FilterMap;

	@state()
		_cards: Cards;

	@state()
		_readingListMap: CardBooleanMap;

	@state()
		_page: string;

	@state()
		_ctrlKeyPressed: boolean;

	static override styles = [
		css`
			:host {
				display:inline;
			}

			/* cards that do not exist are likely unpublished and invisible to this user*/
			a.card.does-not-exist {
				color: inherit;
				fill: inherit;
				text-decoration: none;
				cursor:inherit;
			}

			a {
				color: var(--app-primary-color);
				cursor: var(--card-link-cursor, pointer);
				transition: text-decoration-color var(--transition-fade);
			}

			a svg{
				height: 0.9em;
				width: 0.9em;
			}

			a.strong {
				/* It's a bit weird to have styling passed as a property on
				the link, but for some reason the linter was complaining
				about the ways of passing style in card-info-panel so
				whatever.
				*/
				font-weight:bold;
			}

			a.card.reading-list {
				text-decoration-style: double;
			}

			a:visited {
				color: var(--app-primary-color-light);
				fill: var(--app-primary-color-light);
			}

			a.card.exists {
				color: var(--app-secondary-color);
				fill: var(--app-secondary-color);
			}

			a.no-navigate {
				cursor: default;
			}

			a.card.exists:visited, a.card.exists.read, a.card.no-navigate {
				color: var(--app-secondary-color-light);
				fill: var(--app-secondary-color-light);
			}

			a.card.exists.unpublished {
				color: var(--app-warning-color);
				fill: var(--app-warning-color);
			}

			a.card.exists.unpublished:visited, a.card.exists.read.unpublished {
				color: var(--app-warning-color-light);
				fill: var(--app-warning-color-light);
			}

			a.add-reading-list {
				cursor: var(--card-link-cursor, copy);
			}

			a.not-content {
				font-style: italic;
			}

			a.subtle {
				/* TODO: consider having more styles change in subtle mode */
				text-decoration-color: transparent;
				font-style: revert;
			}

			a.subtle:hover {
				text-decoration-color: currentColor;
			}

		`
	];
	
	override render() {

		return html`
			<a @mousemove=${this._handleMouseMove} @click=${this._handleMouseClick} title='' class='${this.card ? 'card' : ''} ${this._read ? 'read' : ''} ${this._cardExists ? 'exists' : 'does-not-exist'} ${this._cardIsUnpublished ? 'unpublished' : ''} ${this._inReadingList ? 'reading-list' : ''} ${this.strong ? 'strong' : ''} ${this._cardIsNotContent ? 'not-content' : ''} ${this._ctrlKeyPressed ? 'add-reading-list' : ''} ${this.noNavigate ? 'no-navigate' : ''} ${this.subtle ? 'subtle' : ''}' href='${this._computedHref}' target='${this._computedTarget}'>${this._inner}</a>`;
	}

	get _inner() {
		const icon = this._icon;
		if (this.auto) {
			const card = this._cardObj;
			if (card) {
				const val = card[this.auto];
				if (val) {
					return html`${icon} ${val}`;
				}
			}
		}
		return icon ? html`${icon} <slot></slot>` : html`<slot></slot>`;
	}

	_handleMouseClick(e : MouseEvent) {
		//If the user ctrl- or cmd-clicks, we should toggle reading list,
		//otherwise we should return and allow default action.
		if (!this.card || !this._cardObj) return;
		if (this.noNavigate) {
			e.preventDefault();
			return;
		}
		if (!e.ctrlKey && !e.metaKey) return;
		store.dispatch(toggleOnReadingList(this._cardObj.id));
		e.preventDefault();
	}

	_handleMouseMove(e : MouseEvent) {
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		e.stopPropagation();
		//cards-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(makeCardHoveredEvent(this.card, e.clientX, e.clientY));
	}

	override stateChanged(state : State) {
		this._reads = selectUserReads(state);
		this._cards = selectCards(state);
		this._readingListMap = selectUserReadingListMap(state);
		this._page = selectPage(state);
		this._ctrlKeyPressed = selectCtrlKeyPressed(state);
	}

	get _cardObj() {
		if (!this.card) return null;
		if (!this._cards) return null;
		return this._cards[this.card];
	}

	get _iconName() : IconName | '' {
		if (this.iconName) return this.iconName;
		if (!this._cardObj) return '';
		const cardTypeConfig = CARD_TYPE_CONFIGURATION[this._cardObj.card_type];
		if (!cardTypeConfig) return '';
		if (!cardTypeConfig.iconName) return '';
		return cardTypeConfig.iconName;
	}

	get _icon() {
		if (this.subtle) return '';
		const iconName = this._iconName;
		if (!iconName) return '';
		return icons[iconName] || '';
	}

	get _inReadingList() {
		return this._readingListMap ? this._readingListMap[this.card] : false;
	}

	get _cardExists() {
		return this._cardObj ? true : false;
	}

	get _cardIsUnpublished() {
		return this._cardObj ? !this._cardObj.published : false;
	}

	get _read() {
		if (!this.card) return false;
		if (!this._reads) return false;
		return this._reads[this.card] || false;
	}

	get _cardIsNotContent() {
		return this._cardObj ? this._cardObj.card_type != 'content' : false;
	}

	get _computedHref() {
		//If it's a card link, only have it do something if it links to a card
		//that we know to exist. The first part of the URL should be 'c'
		//(default) unless we're in 'basic-card' mode, in which case we should
		//stay in 'basic-card' when the user hits the link.
		const page = this._page == PAGE_BASIC_CARD ? PAGE_BASIC_CARD : PAGE_DEFAULT;
		return this.card ? (this._cardExists ? '/' + page + '/' + this.card : 'javascript:void(0)'): this.href;
	}

	get _computedTarget() {
		return this.card ? '' : '_blank';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'card-link': CardLink;
	}
}
