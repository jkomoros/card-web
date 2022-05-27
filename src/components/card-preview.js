import { LitElement, html } from 'lit';

import {
	cardBadges,
	cardBadgesStyles
} from './card-badges.js';

import { 
	CARD_WIDTH_IN_EMS,
	CARD_HEIGHT_IN_EMS
} from './card-renderer.js';

class CardPreview extends LitElement {

	static styles = [
		cardBadgesStyles
	];

	render() {
		const cardWidthInPixels = CARD_WIDTH_IN_EMS * this.previewSize;
		const cardHeightInPixels = CARD_HEIGHT_IN_EMS * this.previewSize;
		const positionLeft = (this.x + cardWidthInPixels) > window.innerWidth;
		const positionUp = (this.y + cardHeightInPixels) > window.innerHeight;

		return html`
		<style>
			:host {
				position:absolute;
				left: ${positionLeft ? html`${this.x - cardWidthInPixels - this.cardOffset}` : html`${this.x + this.cardOffset}`}px;
				top: ${positionUp ? html`${this.y - cardHeightInPixels - this.cardOffset}` : html`${this.y + this.cardOffset}`}px;

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
		<card-renderer .card=${this.card} .expandedReferenceBlocks=${this.expandedReferenceBlocks}></card-renderer>
		${cardBadges(false, this.card, this.badgeMap)}
      </div>
    `;
	}
	
	constructor() {
		super();
		this.previewSize = 10.0;
		this.cardOffset = 10.0;
	}

	static get properties() { 
		return {
			card: {type: Object},
			badgeMap: { type:Object },
			x: { type: Number },
			y: { type: Number },
			expandedReferenceBlocks: { type: Array},
			/* size of font for card in px*/
			previewSize: { type: Number },
			/* offset from the cursor in pixels */
			cardOffset : { type: Number },
		};
	}


}

window.customElements.define('card-preview', CardPreview);
