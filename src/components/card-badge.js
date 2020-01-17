import { LitElement, html } from '@polymer/lit-element';

import { SharedStyles } from './shared-styles.js';

export class CardBadge extends LitElement {
	render() {
		return html`
		${SharedStyles}
		<style>
			:host {
				display:block;
				font-size:0.8em;
			}

			div {
				display:flex;
				flex-direction:row;
				align-items:center;
				color: var(--app-dark-text-color-light);
			}

			div.light {
				color: var(--app-light-text-color);
			}

			div.highlighted {
				color: var(--app-primary-color-subtle);
			}

			div.light.highlighted {
				color: var(--app-primary-color-light);
			}

			svg {
				height: 1em;
				width: 1em;
				fill: var(--app-dark-text-color-light);
			}

			div.light svg {
				fill: var(--app-light-text-color);
			}

			div.highlighted svg {
				fill: var(--app-primary-color-subtle);
			}

			div.highlighted.light {
				fill: var(--app-primary-color-light);
			}
		</style>
		<div ?hidden='${!this.doShow}' class='${this.highlighted ? 'highlighted' : ''} ${this.light ? 'light' : ''}'>${this.innerRender()}</div>
		`;
	}

	innerRender() {
		return html`<span>#${this.count}</span>`;
	}

	get doShow() {
		return this.visible || (this.count && this.count > 0);
	}

	static get properties() {
		return {
			count: { type: Number },
			visible: { type: Boolean},
			highlighted: { type: Boolean},
			light: { type:Boolean }
		};
	}
}

window.customElements.define('card-badge', CardBadge);
