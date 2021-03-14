
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

				span {
					cursor: pointer;
					background-color: var(--app-secondary-color-light-very-transparent);
				}

				span.alternate {
					background-color: var(--app-primary-color-light-very-transparent);
				}

				span.disabled {
					cursor: auto;
				}

				span.enabled:hover {
					background-color: var(--app-secondary-color-light-somewhat-transparent);
				}

				span.enabled.alternate:hover {
					background-color: var(--app-primary-color-light-somewhat-transparent);
				}

				a {
					text-decoration: none;
					color: var(--app-dark-text-color);
				}
				/* the following is all on one line to avoid extra whitespace that would lead to gaps between the text and punctuation */
			</style><span class='${this.disabled ? 'disabled' : 'enabled'} ${this.alternate ? 'alternate' : ''}' @mousemove=${this._handleMouseMove}>${this.disabled ? html`<slot></slot>` : html`<a href=${this._href}><slot></slot></a>`}</span>`;
	}

	static get properties() {
		return {
			card: { type: String },
			//If disabled, then won't navigate to the card, and also won't light
			//up on hover.
			disabled: {type:Boolean },
			//If true, will render in an alternate color
			alternate: {type:Boolean },
		};
	}

	get _href() {
		return this.disabled ? '' : urlForCard(this.card);
	}

	_handleMouseMove(e) {
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		if (this.disabled) return;
		e.stopPropagation();
		//cards-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: this.card, x: e.clientX, y: e.clientY}}));
	}

}

window.customElements.define('card-highlight', CardHighlight);
