import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	selectImageBrowserDialogOpen,
} from '../selectors.js';

import {
	closeImageBrowserDialog,
	addImageWithURL,
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
			<input type='file' id='file' accept='image/png, image/jpeg' @input=${this._handleFileInput}></input>
			<div class='buttons'>
				<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
			</div>
		`;
	}

	constructor() {
		super();
		this.title = 'Choose Image';
	}

	_handleDoneClicked() {
		const url = this.shadowRoot.querySelector('#src').value;
		if (url) store.dispatch(addImageWithURL(url));
		store.dispatch(closeImageBrowserDialog());
	}

	_shouldClose() {
		store.dispatch(closeImageBrowserDialog());
	}

	_handleFileInput() {
		console.log('File selected');
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectImageBrowserDialogOpen(state);
	}

}

window.customElements.define('image-browser-dialog', ImageBrowserDialog);
