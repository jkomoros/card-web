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
			<em>Not yet implemented</em>
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
		store.dispatch(closeImageBrowserDialog());
	}

	_shouldClose() {
		store.dispatch(closeImageBrowserDialog());
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectImageBrowserDialogOpen(state);
	}

}

window.customElements.define('image-browser-dialog', ImageBrowserDialog);
