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
	openImageBrowserDialog,
	moveImageAtIndex
} from '../actions/editor.js';

import {
	getImagesFromCard,
	LEGAL_IMAGE_POSITIONS,
} from '../images.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON,
	EDIT_ICON,
	ARROW_BACK_ICON,
	ARROW_FORWARD_ICON,
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
				.row {
					display:flex;
					flex-direction:row;
				}
				.row > div {
					display: flex;
					flex-direction: column;
					flex-grow: 1;
					margin:0.25em;
				}
			</style>
			${img.uploadPath ? 
		html`<label>Upload Path</label><em>${img.uploadPath || ''}<button class='small' title='Edit image' @click=${this._handleEditImage}>${EDIT_ICON}</button></em>` :
		html`<label>Src</label><em>${img.src}<button class='small' title='Edit image' @click=${this._handleEditImage}>${EDIT_ICON}</button></em>`
}
			<div class='row'>
				<div>
					<label>Size</label><input type='number' min='0.5' max='30.0' step='0.5' .property=${'emSize'} .value=${img.emSize} @input=${this._handleTextInput}></input>
				</div>
				<div>
					<label>Margin</label><input type='number' min='0.0' max='10.0' step='0.25' .property=${'margin'} .value=${img.margin} @input=${this._handleTextInput}></input>
				</div>
				<div>
					<label>Position</label>
					<select @change=${this._handleTextInput} .value=${img.position} .property=${'position'}>
						${Object.keys(LEGAL_IMAGE_POSITIONS).map(item => html`<option value=${item} ?selected=${item == img.position}>${item}</option>`)}
					</select>
				</div>
				<div>
					<label>Move Image</label>
					<div>
						<button class='small' title='Move image left' .disabled=${this._index < 1} @click=${this._handleLeftClicked}>${ARROW_BACK_ICON}</button>
						<button class='small' title='Move image right' .disabled=${this._index >= images.length - 1} @click=${this._handleRightClicked}>${ARROW_FORWARD_ICON}</button>
					</div>
				</div>
				<div>
					<label>Height x Width</label><em>${img.height || 'Unknown'} x ${img.width || 'Unknown'}</em>
				</div>
			</div>
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

	_handleLeftClicked() {
		store.dispatch(moveImageAtIndex(this._index, false));
	}

	_handleRightClicked() {
		store.dispatch(moveImageAtIndex(this._index, true));
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
