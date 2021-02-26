import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import multiedit from '../reducers/multiedit.js';
store.addReducers({
	multiedit
});

import {
	closeMultiEditDialog,
} from '../actions/multiedit.js';

import {
	selectMultiEditDialogOpen,
} from '../selectors.js';

class MultiEditDialog extends connect(store)(DialogElement) {
	innerRender() {

		return html`
		<div><em>TODO: implement</em></div>
	`;
	}

	constructor() {
		super();
		this.title = 'Edit Multiple Cards';
	}

	_shouldClose() {
		//Override base class.
		store.dispatch(closeMultiEditDialog());
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectMultiEditDialogOpen(state);
	}

}

window.customElements.define('multi-edit-dialog', MultiEditDialog);
