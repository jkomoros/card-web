
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

import {
	addImageWithURL,
	removeImageAtIndex,
	openImagePropertiesDialog
} from '../actions/editor.js';

import './tag-list.js';
import './image-properties-dialog.js';

class CardImagesEditor extends connect(store)(LitElement) {
	render() {

		if (!IMAGE_CARD_TYPES[this._effectiveCard.card_type]) return html`<em>This card type does not support images.</em>`;

		const images = this._effectiveCard.images || [];

		const invalidColor = '#b22222'; //firebrick
		const loadedColor = '#006400'; //darkgreen

		const imgTagNames = [];
		const tagInfos = {};
		for (let i = 0; i < images.length; i++) {
			const key = '' + i;
			const img = images[i];
			imgTagNames.push(key);
			tagInfos[key] = {
				id: key,
				title: img.src,
				color: img.height !== undefined && img.width !== undefined ? loadedColor : invalidColor,
			};
		}
		return html`
			<tag-list .tags=${imgTagNames} .tagInfos=${tagInfos} .editing=${true} .overrideTypeName=${'Image'} .tapEvents=${true} @tag-tapped=${this._handleTagTapped} @new-tag=${this._handleNewTag} @remove-tag=${this._handleRemoveTag}></tag-list>
			<image-properties-dialog></image-properties-dialog>
		`;
	}

	_handleTagTapped(e) {
		const index = parseInt(e.detail.tag);
		store.dispatch(openImagePropertiesDialog(index));
	}

	_handleRemoveTag(e) {
		const index = parseInt(e.detail.tag);
		store.dispatch(removeImageAtIndex(index));
	}

	_handleNewTag() {
		const url = prompt('What\'s the fully qualified URL to add?');
		if (!url) return;
		store.dispatch(addImageWithURL(url));
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
