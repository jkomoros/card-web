
import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import {
	selectEditingCard
} from '../selectors.js';

import {
	IMAGE_CARD_TYPES
} from '../../shared/card-fields.js';

import {
	EMPTY_CARD
} from '../card_fields.js';

import {
	removeImageAtIndex,
	openImagePropertiesDialog,
	openImageBrowserDialog
} from '../actions/editor.js';

import {
	getImagesFromCard
} from '../images.js';

import {
	Card,
	State,
	TagInfos
} from '../types.js';

import {
	COLORS
} from '../../shared/card-fields.js';

import {
	TagEvent
} from '../events.js';

import './tag-list.js';
import './image-properties-dialog.js';
import './image-browser-dialog.js';

@customElement('card-images-editor')
class CardImagesEditor extends connect(store)(LitElement) {


	@state()
		_card: Card | null;

	override render() {

		//This is safe to throw now because the place where it was defined would have thrown too.
		if (!IMAGE_CARD_TYPES) throw new Error('no image card types');

		if (!IMAGE_CARD_TYPES[this._effectiveCard.card_type]) return html`<em>This card type does not support images.</em>`;

		const images = getImagesFromCard(this._card);

		const invalidColor = COLORS.FIRE_BRICK;
		const loadedColor = COLORS.DARK_GREEN;

		const imgTagNames = [];
		const tagInfos : TagInfos = {};
		for (let i = 0; i < images.length; i++) {
			const key = '' + i;
			const img = images[i];
			imgTagNames.push(key);
			let title = img.src;
			if (img.uploadPath) {
				const parts = img.uploadPath.split('/');
				title = parts[parts.length - 1];
			}
			tagInfos[key] = {
				id: key,
				title,
				color: img.height !== undefined && img.width !== undefined ? loadedColor : invalidColor,
			};
		}
		return html`
			<tag-list .tags=${imgTagNames} .disableSelect=${true} .tagInfos=${tagInfos} .editing=${true} .overrideTypeName=${'Image'} .tapEvents=${true} @tag-tapped=${this._handleTagTapped} @tag-new=${this._handleNewTag} @tag-removed=${this._handleRemoveTag}></tag-list>
			<image-properties-dialog></image-properties-dialog>
			<image-browser-dialog></image-browser-dialog>
		`;
	}

	_handleTagTapped(e : TagEvent) {
		const index = parseInt(e.detail.tag);
		store.dispatch(openImagePropertiesDialog(index));
	}

	_handleRemoveTag(e : TagEvent) {
		const index = parseInt(e.detail.tag);
		store.dispatch(removeImageAtIndex(index));
	}

	_handleNewTag() {
		store.dispatch(openImageBrowserDialog());
	}

	get _effectiveCard() {
		return this._card || EMPTY_CARD;
	}

	override stateChanged(state : State) {
		this._card = selectEditingCard(state);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'card-images-editor': CardImagesEditor;
	}
}
