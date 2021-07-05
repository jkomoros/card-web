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
	ALL_FILTER_NAME,
	UNION_FILTER_DELIMITER,
	EXCLUDE_FILTER_NAME,
	COMBINE_FILTER_NAME,
	URL_PART_DATE_SECTION,
	URL_PART_SUB_FILTER,
	BETWEEN_FILTER_NAME
} from '../filters.js';

import {
	DELETE_FOREVER_ICON,
	PLUS_ICON
} from './my-icons.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

const splitCompoundFilter = (fullFilterName) => {
	const filterParts = fullFilterName.split('/');
	const firstFilterPart = filterParts[0];
	const restFilter = filterParts.slice(1).join('/');
	return [firstFilterPart, restFilter];
};

const splitUnionFilter = (unionFilter) => {
	const [firstPart] = splitCompoundFilter(unionFilter);
	return firstPart.split(UNION_FILTER_DELIMITER);
};

const piecesForConfigurableFilter = (fullFilterName) => {
	//TODO: it's kind of weird that this bespoke logic is here, instead of fully
	//being driven by constant configuration from filters.js
	const [filterName, rest] = splitCompoundFilter(fullFilterName);
	if (!rest) {
		console.warn('Unexpectedly no rest');
		return [];
	}
	const config = CONFIGURABLE_FILTER_INFO[filterName];
	if (!config) {
		console.warn('Unexpectedly no config');
		return [];
	}
	const pieces = rest.split('/');
	const result = [];
	let pieceIndex = 0;
	for (const controlType of config.arguments) {
		if (pieceIndex >= pieces.length) {
			console.warn('Ran out of pieces');
			continue;
		}
		switch (controlType) {
		case URL_PART_DATE_SECTION:
			const subPieces = [pieces.slice(pieceIndex, 2)];
			pieceIndex += 2;
			if (subPieces[0] == BETWEEN_FILTER_NAME) {
				//one more
				subPieces.push(pieces[pieceIndex]);
				pieceIndex++;
			}
			result.push({
				controlType,
				value: subPieces.join('/')
			});
			break;
		case URL_PART_SUB_FILTER:
			//consume all remaining pieces
			result.push({
				controlType,
				value: pieces.slice(pieceIndex).join('/')
			});
			break;
		default:
			//The majority of filters are one piece for one argument.
			result.push({
				controlType,
				value: pieces[pieceIndex],
			});
			pieceIndex++;
		}
	}
	return result;
};

class ConfigureCollectionDialog extends connect(store)(DialogElement) {
	innerRender() {
		return html`
			${HelpStyles}
			<style>
				.help {
					font-size:0.75em;
				}
			</style>
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
		const [firstFilterPart, restFilter] = splitCompoundFilter(filterName);
		//TODO: handle combined normal filters e.g. `working-notes+content`
		const unionFilterPieces = splitUnionFilter(firstFilterPart);
		const isConfigurableFilter = CONFIGURABLE_FILTER_INFO[firstFilterPart] != undefined;
		const configurableFilterPieces = restFilter.split('/');
		return html`${index > 0 ? html`<li><em>AND</em></li>` : ''}
		<li>
			${unionFilterPieces.map((filterPiece, i) => html`${i > 0 ? html` <em>OR</em> ` : ''}<select @change=${this._handleModifyFilterChanged} .index=${index} .subIndex=${i}>${this._filterOptions(filterPiece, unionFilterPieces.length <= 1)}</select>${help(this._filterDescriptions[filterPiece])}<button class='small' .index=${index} .subIndex=${i} @click=${this._handleRemoveFilterClicked}>${DELETE_FOREVER_ICON}</button>`)}
			${isConfigurableFilter ? 
		configurableFilterPieces.map((piece, i) => this._configurableFilterPart(firstFilterPart,index, i, piece)): 
		html`<button class='small' .index=${index} @click=${this._handleAddUnionFilterClicked} title='Add new filter to OR with previous filters in this row'>${PLUS_ICON}</button>`
}
		</li>`;
	}

	_configurableFilterPart(filterName, index, subIndex, text) {
		return html`<input type='text' .index=${index} .subIndex=${subIndex} @change=${this._handleModifyFilterRestChanged} .value=${text}>`;
	}

	_filterOptions(selectedOptionName, showConfigurable) {
		//TODO: cache?
		const entries = Object.entries(this._filterDescriptions).filter(entry => entry[0] != EXCLUDE_FILTER_NAME && entry[0] != COMBINE_FILTER_NAME);
		//I'd rather have the current value selected in the <select>, but that wasn't working, so have the options select themselves.
		return repeat(entries, entry => entry[0], entry => html`<option .value=${entry[0]} .title=${entry[1]} .selected=${selectedOptionName == entry[0]} .disabled=${!showConfigurable && CONFIGURABLE_FILTER_INFO[entry[0]]}>${entry[0] + (CONFIGURABLE_FILTER_INFO[entry[0]] ? '*' : '')}</option>`);
	}

	_handleAddUnionFilterClicked(e) {
		//The event likely happened on the svg but we want the button
		let ele = null;
		for (const possibleEle of e.composedPath()) {
			if (possibleEle.tagName == 'BUTTON') {
				ele = possibleEle;
				break;
			}
		}
		if (!ele) {
			console.warn('Couldn\'t find ele');
			return;
		}
		const index = ele.index;
		const fullFilterText = this._collectionDescription.filters[index] + UNION_FILTER_DELIMITER + ALL_FILTER_NAME;
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterModified(this._collectionDescription, index, fullFilterText)));
	}

	_handleRemoveFilterClicked(e) {
		//The event likely happened on the svg but we want the button
		let ele = null;
		for (const possibleEle of e.composedPath()) {
			if (possibleEle.tagName == 'BUTTON') {
				ele = possibleEle;
				break;
			}
		}
		if (!ele) {
			console.warn('Couldn\'t find ele');
			return;
		}
		const index = ele.index;
		const filterPieces = splitUnionFilter(this._collectionDescription.filters[index]);
		if (filterPieces.length > 1) {
			filterPieces.splice(ele.subIndex, 1);
			store.dispatch(navigateToCollection(collectionDescriptionWithFilterModified(this._collectionDescription, index, filterPieces.join(UNION_FILTER_DELIMITER))));
			return;
		}
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterRemoved(this._collectionDescription, index)));
	}

	_handleAddFilterClicked() {
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterAppended(this._collectionDescription, ALL_FILTER_NAME)));
	}

	_handleModifyFilterRestChanged(e) {
		const ele = e.composedPath()[0];
		const index = ele.index;
		const subIndex = ele.subIndex;
		const oldText = this._collectionDescription.filters[index];
		const [firstPart, rest] = splitCompoundFilter(oldText);
		const restPieces = rest.split('/');
		restPieces[subIndex] = ele.value;
		const newText = firstPart + '/' + restPieces.join('/');
		store.dispatch(navigateToCollection(collectionDescriptionWithFilterModified(this._collectionDescription, index, newText)));
	}

	_handleModifyFilterChanged(e) {
		const ele = e.composedPath()[0];
		const index = ele.index;
		const subIndex = ele.subIndex;
		const fullFilterText = this._collectionDescription.filters[index];
		const unionPieces = splitUnionFilter(fullFilterText);
		const firstPart = ele.value;
		unionPieces[subIndex] = firstPart;
		const configurableInfo = CONFIGURABLE_FILTER_INFO[firstPart];
		const fullText = configurableInfo ? firstPart + '/' + configurableInfo.defaultsFactory() : unionPieces.join(UNION_FILTER_DELIMITER);
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
