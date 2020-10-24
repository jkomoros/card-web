
import { LitElement, html } from '@polymer/lit-element';
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
	CARD_TYPE_CONTENT
} from '../card_fields.js';

class CardLink extends connect(store)(LitElement) {
	render() {

		return html`
			<style>
				:host {
					display:inline;
				}

				/* cards that do not exist are likely unpublished and invisible to this user*/
				a.card.does-not-exist {
					color: inherit;
					text-decoration: none;
					cursor:inherit;
				}

				a {
					color: var(--app-primary-color);
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
				}

				a.card.exists {
					color: var(--app-secondary-color);
				}

				a.card.exists:visited, a.card.exists.read {
					color: var(--app-secondary-color-light);
				}

				a.card.exists.unpublished {
					color: var(--app-warning-color);
				}

				a.card.exists.unpublished:visited, a.card.exists.read.unpublished {
					color: var(--app-warning-color-light);
				}

				a {
					cursor: var(--card-link-cursor, pointer);
				}

				a.add-reading-list {
					cursor: var(--card-link-cursor, copy);
				}

				a.not-content {
					font-style: italic;
				}

			</style>
			<a @mousemove=${this._handleMouseMove} @click=${this._handleMouseClick} title='' class='${this.card ? 'card' : ''} ${this._read ? 'read' : ''} ${this._cardExists ? 'exists' : 'does-not-exist'} ${this._cardIsUnpublished ? 'unpublished' : ''} ${this._inReadingList ? 'reading-list' : ''} ${this.strong ? 'strong' : ''} ${this._cardIsNotContent ? 'not-content' : ''} ${this._ctrlKeyPressed ? 'add-reading-list' : ''}' href='${this._computedHref}' target='${this._computedTarget}'>${this._inner}</a>`;
	}

	static get properties() {
		return {
			card: { type: String },
			href: { type: String},
			auto: { type: String},
			strong: { type: Boolean},
			_reads: {type: Object},
			_cards: { type: Object},
			_readingListMap: { type: Object},
			_page: { type: String },
			_ctrlKeyPressed: { type: Boolean},
		};
	}

	get _inner() {
		if (this.auto) {
			let card = this._cardObj;
			if (card) {
				let val = card[this.auto];
				if (val) return val;
			}
		}
		return html`<slot></slot>`;
	}

	_handleMouseClick(e) {
		//If the user ctrl- or cmd-clicks, we should toggle reading list,
		//otherwise we should return and allow default action.
		if (!this.card) return;
		if (!e.ctrlKey && !e.metaKey) return;
		store.dispatch(toggleOnReadingList(this._cardObj));
		e.preventDefault();
	}

	_handleMouseMove(e) {
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		e.stopPropagation();
		//cards-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: this.card, x: e.clientX, y: e.clientY}}));
	}

	stateChanged(state) {
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
		return this._cardObj ? this._cardObj.card_type != CARD_TYPE_CONTENT : false;
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

window.customElements.define('card-link', CardLink);
