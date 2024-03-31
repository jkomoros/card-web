import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	closeBulkImportDialog, commitBulkImport, processBulkImportContent
} from '../actions/bulk-import.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON,
} from './my-icons.js';

import {
	selectBulkImportDialogBodies,
	selectBulkImportDialogOpen
} from '../selectors.js';

import {
	State,
} from '../types.js';

import bulkImport from '../reducers/bulk-import.js';
store.addReducers({
	bulkImport
});

@customElement('bulk-import-dialog')
class BulkImportDialog extends connect(store)(DialogElement) {

	@state()
		_bodies: string[];

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`

			textarea {
				flex-grow:1;
				width:100%;
				height:5em;
			}

			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}
		`
	];

	override innerRender() {
		if (!this.open) return html``;
		return html`<div>
			${this._bodies.length ?
		html`<p>Verify these bodies are ones you want to create!</p>
			${this._bodies.map((body) => html`<textarea disabled .value=${body}></textarea>`)}` :
		html`<p>Paste Google Docs bullets here to import them</p>
			<textarea
				id='input'
				@paste=${this._handleRawPaste}
				placeholder='Paste html here'></textarea>`
}
			<div class='buttons'>
				<button
					class='round'
					?disabled=${!this._bodies.length}
					@click='${this._handleDoneClicked}'
				>
					${CHECK_CIRCLE_OUTLINE_ICON}
				</button>
			</div>
		</div>`;
	}

	_handleRawPaste(e : ClipboardEvent) {
		e.preventDefault();
		const clipboardData = e.clipboardData;
		if (!clipboardData) throw new Error('No clipboardData');
		const pastedData = clipboardData.getData('text/html');
		const target = e.target;
		if (!target) throw new Error('No target');
		if (!(target instanceof HTMLTextAreaElement)) throw new Error('target not textarea');
		store.dispatch(processBulkImportContent(pastedData));
	}

	_handleDoneClicked() {
		store.dispatch(commitBulkImport());
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(closeBulkImportDialog());
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectBulkImportDialogOpen(state);
		this._bodies = selectBulkImportDialogBodies(state);
		this.title = 'Bulk Import';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'bulk-import-dialog': BulkImportDialog;
	}
}
