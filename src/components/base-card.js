import { LitElement, html } from '@polymer/lit-element';

import { SharedStyles } from './shared-styles.js';

import './star-count.js';

export const CARD_WIDTH_IN_EMS = 43.63;
export const CARD_HEIGHT_IN_EMS = 24.54;
export const CARD_VERTICAL_PADDING_IN_EMS = 1.0;
export const CARD_HORIZONTAL_PADDING_IN_EMS = 1.45;

// This element is *not* connected to the Redux store.
export class BaseCard extends LitElement {
	render() {
		return html`
			${SharedStyles}
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

				star-count {
					position:absolute;
					top:0.5em;
					right:0.5em;
				}

			</style>
			<div class="container ${this.editing ? 'editing' : ''} ${this.published ? 'published' : 'unpublished'}">
				${this.innerRender()}
				<star-count .count=${this.starCount}></star-count>
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

	firstUpdated() {
		this.addEventListener('click', e => this._handleClick(e));
	}

}

window.customElements.define('base-card', BaseCard);
