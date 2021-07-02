import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectConfigureCollectionDialogOpen,
	selectActiveCollectionDescription
} from '../selectors.js';

import {
	closeConfigureCollectionDialog
} from '../actions/app.js';

import {
	SET_INFOS
} from '../filters.js';

class ConfigureCollectionDialog extends connect(store)(DialogElement) {
	innerRender() {
		return html`
			<h2>Set</h2>
			<select disabled>
				${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
			</select>
			<em>${this._collectionDescription.set}</em>
			<h2>Filters</h2>
			<ul>
				${this._collectionDescription.filters.map(filter => html`<li><em>${filter}</em></li>`)}
			</ul>
			<h2>Sort</h2>
			<em>${this._collectionDescription.sort} ${this._collectionDescription.sortReversed ? html`<strong>Reversed</strong>` : ''}</em>
		`;
	}

	constructor() {
		super();
		this.title = 'Configure Collection';
	}

	_handleDoneClicked() {
		store.dispatch(closeConfigureCollectionDialog());
	}

	_shouldClose() {
		//Override base class.
		store.dispatch(closeConfigureCollectionDialog());
	}

	static get properties() {
		return {
			_collectionDescription: {type: Object},
		};
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectConfigureCollectionDialogOpen(state);
		this._collectionDescription = selectActiveCollectionDescription(state);
	}

}

window.customElements.define('configure-collection-dialog', ConfigureCollectionDialog);
