import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	selectImageBrowserDialogOpen,
	selectImageBrowserDialogIndex
} from '../selectors.js';

import {
	closeImageBrowserDialog,
	addImageWithURL,
	addImageWithFile,
} from '../actions/editor.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

class ImageBrowserDialog extends connect(store)(DialogElement) {
	innerRender() {
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
			<label>Fully qualified src (e.g. including https://)</label>
			<input type='text' id='src'></input>
			<label>or...</label>
			<input type='file' id='file' accept='image/png, image/jpeg, image/gif' @input=${this._handleFileInput}></input>
			<div class='buttons'>
				<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
			</div>
		`;
	}

	constructor() {
		super();
		this.title = 'Choose Image';
	}

	static get properties() {
		return {
			_index: {type: Number},
		};
	}

	_handleDoneClicked() {
		const url = this.shadowRoot.querySelector('#src').value;
		if (url) store.dispatch(addImageWithURL(url, this._index));
		store.dispatch(closeImageBrowserDialog());
	}

	_shouldClose() {
		store.dispatch(closeImageBrowserDialog());
	}

	_handleFileInput() {
		const ele = this.shadowRoot.querySelector('#file');
		store.dispatch(addImageWithFile(ele.files[0], this._index));
		store.dispatch(closeImageBrowserDialog());
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectImageBrowserDialogOpen(state);
		this._index = selectImageBrowserDialogIndex(state);
	}

}

window.customElements.define('image-browser-dialog', ImageBrowserDialog);
