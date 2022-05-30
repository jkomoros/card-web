import { LitElement, html, css } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';

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
		cardBadgesStyles,
		css`
			:host {
				position:absolute;
				/* TODO: this z-index ia a bit of a hack to make sure it shows up
				above e.g. dialogs, which are 1000 */
				z-index: 10001;
			}
		`
	];

	render() {
		const cardWidthInPixels = CARD_WIDTH_IN_EMS * this.previewSize;
		const cardHeightInPixels = CARD_HEIGHT_IN_EMS * this.previewSize;
		const positionLeft = (this.x + cardWidthInPixels) > window.innerWidth;
		const positionUp = (this.y + cardHeightInPixels) > window.innerHeight;

		const cardRendererStyles = {
			// font-size is the primary way to affect the size of a card-renderer
			fontSize: this.previewSize + 'px',
		};

		//TODO: is it weird to have render() affect the inline styles of the parent?
		this.style.left = (positionLeft ? (this.x - cardWidthInPixels - this.cardOffset) : (this.x + this.cardOffset)) + 'px';
		this.style.top = (positionUp ? (this.y - cardHeightInPixels - this.cardOffset) : (this.y + this.cardOffset)) + 'px';

		return html`
      <div ?hidden='${!this.card}'>
		<card-renderer .card=${this.card} .expandedReferenceBlocks=${this.expandedReferenceBlocks} style=${styleMap(cardRendererStyles)}></card-renderer>
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
