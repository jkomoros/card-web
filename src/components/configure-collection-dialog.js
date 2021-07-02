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
	closeConfigureCollectionDialog,
	navigateToCollection
} from '../actions/app.js';

import {
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithSortReversed,
	collectionDescriptionWithFilterRemoved
} from '../collection_description.js';

import {
	SET_INFOS,
	SORTS
} from '../filters.js';

class ConfigureCollectionDialog extends connect(store)(DialogElement) {
	innerRender() {
		return html`
			<h2>Set</h2>
			<select @change=${this._handleSetSelectChanged} .value=${this._collectionDescription.set}>
				${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
			</select>
			<h2>Filters</h2>
			<ul>
				${this._collectionDescription.filters.map((filterName, index) => this._templateForFilter(filterName, index))}
			</ul>
			<h2>Sort</h2>
			<input type='checkbox' @change=${this._handleSortReversedCheckboxChanged} id='reversed' .checked=${this._collectionDescription.sortReversed}><label for='reversed'>Reversed</label>
			<select @change=${this._handleSortSelectChanged} .value=${this._collectionDescription.sort}>
				${Object.entries(SORTS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
			</select>
		`;
	}

	constructor() {
		super();
		this.title = 'Configure Collection';
	}

	_templateForFilter(filterName, index) {
		return html`<li><em>${filterName}</em><button .index=${index} @click=${this._handleRemoveFilterClicked}>X</button></li>`;
	}

	_handleRemoveFilterClicked(e) {
		const ele = e.composedPath()[0];
		const index = ele.index;
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterRemoved(this._collectionDescription, index)));
	}

	_handleSetSelectChanged(e) {
		const ele = e.composedPath()[0];
		const set = ele.value;
		store.dispatch(navigateToCollection(collectionDescriptionWithSet(this._collectionDescription, set)));
	}

	_handleSortSelectChanged(e) {
		const ele = e.composedPath()[0];
		const sort = ele.value;
		store.dispatch(navigateToCollection(collectionDescriptionWithSort(this._collectionDescription, sort)));
	}

	_handleSortReversedCheckboxChanged(e) {
		const ele = e.composedPath()[0];
		const sortReversed = ele.checked;
		store.dispatch(navigateToCollection(collectionDescriptionWithSortReversed(this._collectionDescription, sortReversed)));
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
