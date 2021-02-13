
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

import './tag-list.js';

class CardImagesEditor extends connect(store)(LitElement) {
	render() {

		if (!IMAGE_CARD_TYPES[this._effectiveCard.card_type]) return html`<em>This card type does not support images.</em>`;

		const images = this._effectiveCard.images || [];

		const imgTagNames = [];
		const tagInfos = {};
		for (let i = 0; i < images.length; i++) {
			const key = '' + i;
			imgTagNames.push(key);
			tagInfos[key] = {
				id: key,
				title: images[i].src
			};
		}
		return html`
			<tag-list .tags=${imgTagNames} .tagInfos=${tagInfos} .editing=${true} .overrideTypeName=${'Image'}></tag-list>
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
