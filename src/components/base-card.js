import { LitElement, html } from '@polymer/lit-element';
import {GestureEventListeners} from '@polymer/polymer/lib/mixins/gesture-event-listeners.js';
import * as Gestures from '@polymer/polymer/lib/utils/gestures.js';

import { SharedStyles } from './shared-styles.js';

import {
	badgeStyles,
	starBadge
} from './card-badges.js';

export const CARD_WIDTH_IN_EMS = 43.63;
export const CARD_HEIGHT_IN_EMS = 24.54;
export const CARD_VERTICAL_PADDING_IN_EMS = 1.0;
export const CARD_HORIZONTAL_PADDING_IN_EMS = 1.45;

//Number of pixels until a track is considered a swipe
const SWIPE_DX = 15.0;

// This element is *not* connected to the Redux store.
export class BaseCard extends GestureEventListeners(LitElement) {
	render() {
		return html`
			${SharedStyles}
			${badgeStyles}
			<style>
				:host {
					display:block;
					background-color: var(--card-color);
					
					width: ${CARD_WIDTH_IN_EMS}em;
					height: ${CARD_HEIGHT_IN_EMS}em;
					

					box-shadow: var(--card-shadow);
					box-sizing: border-box;
					line-height:1.4;
					position:relative;
				}

				.container {
					height:100%;
					width:100%;
					padding: ${CARD_VERTICAL_PADDING_IN_EMS}em ${CARD_HORIZONTAL_PADDING_IN_EMS}em;
					box-sizing:border-box;
				}

				.container.unpublished {
					background-color: var(--unpublished-card-color);
				}

				.container.editing > *{
					opacity:0.7;
				}

				.container.editing card-link[card] {
					--card-link-cursor:not-allowed;
				}

				h1, h2, h3{
					font-family: 'Raleway', sans-serif;
					font-weight:bold;
					margin-top:0;
				}

				h1 {
					color: var(--app-primary-color);
					font-size: 1.4em;
				}

				h2 {
					color: var(--app-dark-text-color);
					font-size: 1.2em;
				}

				h3 {
					color: var(--app-dark-text-color);
					font-size: 1.1em;
				}

				h1 strong, h2 strong, h3 strong {
					color: var(--app-primary-color);
				}

				section {
					font-family: 'Source Sans Pro', sans-serif;
					font-size: 1em;
					color: var(--app-dark-text-color);
					background-color:transparent;
				}

				section.full-bleed {
					top:0;
					left:0;
					height:100%;
					width:100%;
					position:absolute;
					display:flex;
					flex-direction:column;
					justify-content:center;
					align-items:center;
				}

				.small {
					font-size:0.72em;
				}
				.loading {
					font-style:italic;
					opacity: 0.5;
				}

				.star-count {
					position:absolute;
					top:0.5em;
					right:0.5em;
				}

			</style>
			<div class="container ${this.editing ? 'editing' : ''} ${this.published ? 'published' : 'unpublished'}">
				${this.innerRender()}
				${starBadge(this.starCount)}
			</div>
		`;
	}

	innerRender() {
		//Subclasess override this
		return '';
	}

	static get properties() {
		return {
			editing : { type:Boolean },
			starCount: { type:Number },
			published: { type: Boolean }
		};
	}

	_handleClick(e) {
		//We only cancel link following if editing is true
		if (!this.editing) return;
		let ele = e.composedPath()[0];
		if (ele.localName != 'a') return;
		//Links that will open a new tab are fine
		if (ele.target == '_blank') return;
		e.preventDefault();

	}

	_handleTrack(e) {
		//Wait until the track ends, and they lift their finger
		if (e.detail.state != 'end') return;
		if (e.detail.dx > SWIPE_DX) {
			this.dispatchEvent(new CustomEvent('card-swiped', {composed:true, detail: {direction:'right'}}));
		}
		if (e.detail.dx < - 1 *SWIPE_DX) {
			this.dispatchEvent(new CustomEvent('card-swiped', {composed:true, detail: {direction:'left'}}));
		}
	}

	firstUpdated() {
		this.addEventListener('click', e => this._handleClick(e));
		Gestures.addListener(this, 'track', e => this._handleTrack(e));
	}

}

window.customElements.define('base-card', BaseCard);
