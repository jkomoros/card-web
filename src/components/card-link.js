
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';
import { 
	selectUserReads,
	selectCards,
	selectUserReadingListMap
} from '../selectors.js';

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
			</style>
			<a @mousemove=${this._handleMouseMove} title='' class='${this.card ? 'card' : ''} ${this._read ? 'read' : ''} ${this._cardExists ? 'exists' : 'does-not-exist'} ${this._cardIsUnpublished ? 'unpublished' : ''} ${this._inReadingList ? 'reading-list' : ''}' href='${this._computedHref}' target='${this._computedTarget}'>${this._inner}</a>`;
	}

	static get properties() {
		return {
			card: { type: String },
			href: { type: String},
			auto: { type: String},
			_reads: {type: Object},
			_cards: { type: Object},
			_readingListMap: { type: Object},
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

	_handleMouseMove(e) {
		e.stopPropagation();
		//compendium-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: this.card, x: e.clientX, y: e.clientY}}));
	}

	stateChanged(state) {
		this._reads = selectUserReads(state);
		this._cards = selectCards(state);
		this._readingListMap = selectUserReadingListMap(state);
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

	get _computedHref() {
		//If it's a card link, only have it do something if it links to a card that we know to exist.
		return this.card ? (this._cardExists ? '/c/' + this.card : 'javascript:void(0)'): this.href;
	}

	get _computedTarget() {
		return this.card ? '' : '_blank';
	}

}

window.customElements.define('card-link', CardLink);
