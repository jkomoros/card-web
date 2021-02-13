
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import {
	selectEditingCard
} from '../selectors.js';

import {
	IMAGE_CARD_TYPES
} from '../card_fields.js';

class CardImagesEditor extends connect(store)(LitElement) {
	render() {

		if (!IMAGE_CARD_TYPES[this._effectiveCard.card_type]) return html`<em>This card type does not support images.</em>`;

		return html`
			<em>Images not yet supported</em>
		`;
	}

	get _effectiveCard() {
		return this._card || {};
	}

	static get properties() {
		return {
			_card: { type: Object },
		};
	}

	stateChanged(state) {
		this._card = selectEditingCard(state);
	}
}

window.customElements.define('card-images-editor', CardImagesEditor);
