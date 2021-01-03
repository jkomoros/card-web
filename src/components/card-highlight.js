
import { LitElement, html } from '@polymer/lit-element';

class CardHighlight extends LitElement {
	render() {

		return html`<style>
				:host {
					display:inline;
					margin:0;
					padding:0;
				}

				span {
					color: var(--app-secondary-color);
					/* kind of looks like a little book I guess */
					cursor: context-menu;
				}
				/* the following is all on one line to avoid extra whitespace that would lead to gaps between the text and punctuation */
			</style><span @mousemove=${this._handleMouseMove}><slot></slot></span>`;
	}

	static get properties() {
		return {
			card: { type: String },
		};
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
