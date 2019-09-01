
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';
import { selectUserReads, selectCards } from '../selectors.js';

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

				a:visited {
					color: var(--app-primary-color-light);
				}

				a.card.exists {
					color: var(--app-secondary-color);
				}

				a.card.exists:visited, a.card.exists.read {
					color: var(--app-secondary-color-light);
				}

				a {
					cursor: var(--card-link-cursor, pointer);
				}
			</style>
			<a @mousemove=${this._handleMouseMove} title='' class='${this.card ? 'card' : ''} ${this._read ? 'read' : ''} ${this._cardExists ? 'exists' : 'does-not-exist'}' href='${this._computedHref}' target='${this._computedTarget}'>${this._inner}</a>`;
	}

	static get properties() {
		return {
			card: { type: String },
			href: { type: String},
			auto: { type: String},
			_reads: {type: Object},
			_cards: { type: Object},
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
	}

	get _cardObj() {
		if (!this.card) return null;
		if (!this._cards) return null;
		return this._cards[this.card];
	}

	get _cardExists() {
		return this._cardObj ? true : false;
	}

	get _read() {
		if (!this.card) return false;
		if (!this._reads) return false;
		return this._reads[this.card] || false;
	}

	get _computedHref() {
		return this.card ? '/c/' + this.card : this.href;
	}

	get _computedTarget() {
		return this.card ? '' : '_blank';
	}

}

window.customElements.define('card-link', CardLink);
