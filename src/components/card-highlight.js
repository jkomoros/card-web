
import { LitElement, html } from '@polymer/lit-element';

import {
	urlForCard
} from '../actions/app.js';

class CardHighlight extends LitElement {
	render() {

		return html`<style>
				:host {
					display:inline;
					margin:0;
					padding:0;
				}

				a {
					text-decoration: none;
					color: var(--app-dark-text-color);
					background-color: var(--app-secondary-color-light-very-transparent);
				}

				a:hover {
					background-color: var(--app-secondary-color-light-somewhat-transparent);
				}
				/* the following is all on one line to avoid extra whitespace that would lead to gaps between the text and punctuation */
			</style><a @mousemove=${this._handleMouseMove} href=${this._href}><slot></slot></span>`;
	}

	static get properties() {
		return {
			card: { type: String },
		};
	}

	get _href() {
		return urlForCard(this.card) || 'javascript:void(0)';
	}

	_handleMouseMove(e) {
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		e.stopPropagation();
		//cards-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: this.card, x: e.clientX, y: e.clientY}}));
	}

}

window.customElements.define('card-highlight', CardHighlight);
