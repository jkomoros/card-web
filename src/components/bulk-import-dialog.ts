import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	closeAIDialog,
} from '../actions/ai.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON,
} from './my-icons.js';

import {
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
		_active: boolean;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`
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
			<h1>Hello, world!</h1>
			<div class='buttons'>
				<button
					class='round'
					@click='${this._handleDoneClicked}'
				>
					${CHECK_CIRCLE_OUTLINE_ICON}
				</button>
			</div>
		</div>`;
	}

	_handleDoneClicked() {
		store.dispatch(closeAIDialog(true));
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(closeAIDialog(false));
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectBulkImportDialogOpen(state);
		this.title = 'Bulk Import';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'bulk-import-dialog': BulkImportDialog;
	}
}
