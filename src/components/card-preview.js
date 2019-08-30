import { LitElement, html } from '@polymer/lit-element';

import './card-renderer.js';

const DEFAULT_CARD_OFFSET = 10;

class CardPreview extends LitElement {
	render() {
		return html`
		<style>
			:host {
				position:absolute;
				${this._positionLeft ? html`right: ${this.x + DEFAULT_CARD_OFFSET}px;` : html`left: ${this.x + DEFAULT_CARD_OFFSET}px;`}
				${this._positionUp ? html`bottom: ${this.y + DEFAULT_CARD_OFFSET}px;` : html`top: ${this.y + DEFAULT_CARD_OFFSET}px;`}

				/* TODO: this z-index ia a bit of a hack to make sure it shows up
				above e.g. dialogs, which are 1000 */
				z-index: 10001;
			}

			card-renderer {
				/* font-size is the primary way to affect the size of a card-renderer */
				font-size: 10px;
			}

      </style>
      <div ?hidden='${!this.card}'>
        <card-renderer .card=${this.card}></card-renderer>
      </div>
    `;
	}

	static get properties() { 
		return {
			card: {type: Object},
			x: { type: Number },
			y: { type: Number },
			_positionUp: { type:Boolean },
			_positionLeft: { type: Boolean}
		};
	}
  
	_updatePosition() {
		const ele = this.shadowRoot.querySelector('card-renderer');
		if (!ele) return;
		const previewBounds = ele.getBounds();
		if (!previewBounds) return;
		this._positionLeft = (this.x + previewBounds.width) > window.innerWidth;
		this._positionUp = (this.y + previewBounds.height) > window.innerHeight;
	}

	updated(changedProps) {
		if (changedProps.has('x') || changedProps.has('y')) {
			this._updatePosition();      
		}
	}
  

}

window.customElements.define('card-preview', CardPreview);
