import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	selectImagePropertiesDialogOpen,
	selectImagePropertiesDialogIndex,
	selectEditingCard
} from '../selectors.js';

import {
	closeImagePropertiesDialog,
	changeImagePropertyAtIndex,
	openImageBrowserDialog
} from '../actions/editor.js';

import {
	getImagesFromCard
} from '../images.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON,
	EDIT_ICON
} from './my-icons.js';

class ImagePropertiesDialog extends connect(store)(DialogElement) {
	innerRender() {
		const images = getImagesFromCard(this._card);
		const img = images[this._index] || {};
		return html`
			${ButtonSharedStyles}
			<style>
				textarea {
					flex-grow:1;
					width:100%;
				}
				.buttons {
					display:flex;
					flex-direction: row;
					justify-content:flex-end;
				}
				h3 {
					font-weight:normal;
				}
			</style>
			<label>Src</label><em>${img.src}<button class='small' title='Edit image' @click=${this._handleEditImage}>${EDIT_ICON}</button></em>
			<label>Upload Path</label><em>${img.uploadPath || ''}<button class='small' title='Edit image' @click=${this._handleEditImage}>${EDIT_ICON}</button></em>
			<label>Height</label><em>${img.height || 'Unknown'}</em>
			<label>Width</label><em>${img.width || 'Unknown'}</em>
			<label>Size</label><input type='number' min='0.5' max='30.0' step='0.5' .property=${'emSize'} .value=${img.emSize} @input=${this._handleTextInput}></input>
			<label>Alt Text</label> <input type='text' .property=${'alt'} .value=${img.alt} @input=${this._handleTextInput}></input>
			<label>Original Location</label> <input type='text' .property=${'original'} .value=${img.original} @input=${this._handleTextInput}></input>
			<div class='buttons'>
				<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
			</div>
		`;
	}

	constructor() {
		super();
		this.title = 'Image Properties';
	}

	_handleTextInput(e) {
		const ele = e.composedPath()[0];
		store.dispatch(changeImagePropertyAtIndex(this._index, ele.property, ele.value));
	}

	_handleDoneClicked() {
		store.dispatch(closeImagePropertiesDialog());
	}

	_handleEditImage() {
		store.dispatch(openImageBrowserDialog(this._index));
	}

	_shouldClose() {
		store.dispatch(closeImagePropertiesDialog());
	}

	static get properties() {
		return {
			_index: {type: Number},
			_card: {type:Object},
		};
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectImagePropertiesDialogOpen(state);
		this._index = selectImagePropertiesDialogIndex(state);
		this._card = selectEditingCard(state);
	}

}

window.customElements.define('image-properties-dialog', ImagePropertiesDialog);
