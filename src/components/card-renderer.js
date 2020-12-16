import { LitElement, html } from '@polymer/lit-element';

import './base-card.js';

// This element is *not* connected to the Redux store.
export class CardRenderer extends LitElement {
	render() {
		return html`<base-card id='card' .dataIsFullyLoaded=${this.dataIsFullyLoaded} .updatedFromContentEditable=${this.updatedFromContentEditable} .editing=${this.editing} .card=${this.card}></base-card>`;
	}

	static get properties() {
		return {
			editing : { type:Boolean },
			card: { type: Object },
			updatedFromContentEditable: {type:Object},
			dataIsFullyLoaded: {type:Boolean},
		};
	}

	get activeCardEle () {
		return this.shadowRoot.querySelector('#card');
	}
}

window.customElements.define('card-renderer', CardRenderer);
