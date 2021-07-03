import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectConfigureCollectionDialogOpen,
	selectActiveCollectionDescription,
	selectFilterDescriptions
} from '../selectors.js';

import {
	closeConfigureCollectionDialog,
	navigateToCollection
} from '../actions/app.js';

import {
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithSortReversed,
	collectionDescriptionWithFilterRemoved,
	collectionDescriptionWithFilterModified,
	collectionDescriptionWithFilterAppended
} from '../collection_description.js';

import {
	SET_INFOS,
	SORTS,
	CONFIGURABLE_FILTER_INFO,
	ALL_FILTER_NAME
} from '../filters.js';

import {
	DELETE_FOREVER_ICON,
	PLUS_ICON
} from './my-icons.js';

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
				<li><button class='small' @click=${this._handleAddFilterClicked} title='Add a new filter (ANDed with other filters)'>${PLUS_ICON}</button></li>
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
		const filterParts = filterName.split('/');
		const firstFilterPart = filterParts[0];
		const restFilter = filterParts.slice(1).join('/');
		//TODO: handle combined normal filters e.g. `working-notes+content`
		return html`<select @change=${this._handleModifyFilterChanged} .index=${index}>${this._filterOptions(firstFilterPart)}</select>${restFilter.length || CONFIGURABLE_FILTER_INFO[firstFilterPart] ? html`<input type='text' disabled .value=${restFilter}>` : '' }<button class='small' .index=${index} @click=${this._handleRemoveFilterClicked}>${DELETE_FOREVER_ICON}</button>`;
	}

	_filterOptions(selectedOptionName) {
		//TODO: cache?
		//I'd rather have the current value selected in the <select>, but that wasn't working, so have the options select themselves.
		return repeat(Object.entries(this._filterDescriptions), entry => entry[0], entry => html`<option .value=${entry[0]} .title=${entry[1]} .selected=${selectedOptionName == entry[0]}>${entry[0]} - ${entry[1]}</option>`);
	}

	_handleRemoveFilterClicked(e) {
		const ele = e.composedPath()[0];
		const index = ele.index;
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterRemoved(this._collectionDescription, index)));
	}

	_handleAddFilterClicked() {
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterAppended(this._collectionDescription, ALL_FILTER_NAME)));
	}

	_handleModifyFilterChanged(e) {
		const ele = e.composedPath()[0];
		const index = ele.index;
		const firstPart = ele.value;
		const freeTextEle = ele.parentElement.querySelector('input[type=text]');
		const fullText = freeTextEle ? firstPart + '/' + freeTextEle.value : firstPart;
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterModified(this._collectionDescription, index, fullText)));
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
			_filterDescriptions: {type: Object},
		};
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectConfigureCollectionDialogOpen(state);
		this._collectionDescription = selectActiveCollectionDescription(state);
		this._filterDescriptions = selectFilterDescriptions(state);
	}

}

window.customElements.define('configure-collection-dialog', ConfigureCollectionDialog);
