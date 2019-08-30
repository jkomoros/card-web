import { LitElement, html } from '@polymer/lit-element';

import './card-renderer.js';
import { 
	CARD_WIDTH_IN_EMS,
	CARD_HEIGHT_IN_EMS
} from './base-card.js';

const DEFAULT_CARD_OFFSET = 10;

class CardPreview extends LitElement {
	render() {
		const positionLeft = (this.x + CARD_WIDTH_IN_EMS * this.previewSize) > window.innerWidth;
		const positionUp = (this.y + CARD_HEIGHT_IN_EMS * this.previewSize) > window.innerHeight;     
		return html`
		<style>
			:host {
				position:absolute;
				${positionLeft ? html`right: ${this.x + DEFAULT_CARD_OFFSET}px;` : html`left: ${this.x + DEFAULT_CARD_OFFSET}px;`}
				${positionUp ? html`bottom: ${this.y + DEFAULT_CARD_OFFSET}px;` : html`top: ${this.y + DEFAULT_CARD_OFFSET}px;`}

				/* TODO: this z-index ia a bit of a hack to make sure it shows up
				above e.g. dialogs, which are 1000 */
				z-index: 10001;
			}

			card-renderer {
				/* font-size is the primary way to affect the size of a card-renderer */
				font-size: ${this.previewSize}px;
			}

      </style>
      <div ?hidden='${!this.card}'>
        <card-renderer .card=${this.card}></card-renderer>
      </div>
    `;
	}
	
	constructor() {
		super();
		this.previewSize = 10.0;
	}

	static get properties() { 
		return {
			card: {type: Object},
			x: { type: Number },
			y: { type: Number },
			/* size of font for card in px*/
			previewSize: { type: Number },
		};
	}


}

window.customElements.define('card-preview', CardPreview);
