import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	DELETE_FOREVER_ICON,
	PLUS_ICON
} from './my-icons.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import {
	CONFIGURABLE_FILTER_INFO,
	EXCLUDE_FILTER_NAME,
	COMBINE_FILTER_NAME,
	UNION_FILTER_DELIMITER,
	ALL_FILTER_NAME,
	splitUnionFilter,
	splitCompoundFilter,
	piecesForConfigurableFilter,
} from '../filters.js';

// This element is *not* connected to the Redux store.
class ConfigureCollectionFilter extends LitElement {
	render() {
		const [firstFilterPart] = splitCompoundFilter(this.value);
		//TODO: handle combined normal filters e.g. `working-notes+content`
		const unionFilterPieces = splitUnionFilter(firstFilterPart);
		const isConfigurableFilter = CONFIGURABLE_FILTER_INFO[firstFilterPart] != undefined;
		return html`
			${ ButtonSharedStyles }
			${ HelpStyles }

			${this.index > 0 ? html`<li><em>AND</em></li>` : ''}
		<li>
			${unionFilterPieces.map((filterPiece, i) => html`${i > 0 ? html` <em>OR</em> ` : ''}<select @change=${this._handleModifyFilterChanged} .subIndex=${i}>${this._filterOptions(filterPiece, unionFilterPieces.length <= 1)}</select>${help(this.filterDescriptions[filterPiece])}<button class='small' .subIndex=${i} @click=${this._handleRemoveFilterClicked}>${DELETE_FOREVER_ICON}</button>`)}
			${isConfigurableFilter ? 
		piecesForConfigurableFilter(this.value).map((piece, i) => this._configurableFilterPart(piece, i)): 
		html`<button class='small' @click=${this._handleAddUnionFilterClicked} title='Add new filter to OR with previous filters in this row'>${PLUS_ICON}</button>`
}
		</li>
		`;
	}

	_configurableFilterPart(piece, subIndex) {
		//piece is obj with controlType and value
		return html`<input type='text' .subIndex=${subIndex} @change=${this._handleModifyFilterRestChanged} .value=${piece.value}>`;
	}

	_filterOptions(selectedOptionName, showConfigurable) {
		//TODO: cache?
		const entries = Object.entries(this.filterDescriptions).filter(entry => entry[0] != EXCLUDE_FILTER_NAME && entry[0] != COMBINE_FILTER_NAME);
		//I'd rather have the current value selected in the <select>, but that wasn't working, so have the options select themselves.
		return repeat(entries, entry => entry[0], entry => html`<option .value=${entry[0]} .title=${entry[1]} .selected=${selectedOptionName == entry[0]} .disabled=${!showConfigurable && CONFIGURABLE_FILTER_INFO[entry[0]]}>${entry[0] + (CONFIGURABLE_FILTER_INFO[entry[0]] ? '*' : '')}</option>`);
	}

	_handleModifyFilterRestChanged(e) {
		const ele = e.composedPath()[0];
		const subIndex = ele.subIndex;
		const oldText = this.value;
		const [firstPart] = splitCompoundFilter(oldText);
		const pieces = piecesForConfigurableFilter(oldText);
		pieces[subIndex].value = ele.value;
		const newText = firstPart + '/' + pieces.map(piece => piece.value).join('/');
		this.dispatchEvent(new CustomEvent('filter-modified', {composed: true, detail: {value: newText, index: this.index}}));
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
		const fullFilterText = this.value + UNION_FILTER_DELIMITER + ALL_FILTER_NAME;
		this.dispatchEvent(new CustomEvent('filter-modified', {composed: true, detail: {value: fullFilterText, index: this.index}}));
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
		const filterPieces = splitUnionFilter(this.value);
		if (filterPieces.length > 1) {
			filterPieces.splice(ele.subIndex, 1);
			this.dispatchEvent(new CustomEvent('filter-modified', {composed: true, detail: {value: filterPieces.join(UNION_FILTER_DELIMITER), index: this.index}}));
			return;
		}
		this.dispatchEvent(new CustomEvent('filter-removed', {composed: true, detail: {index:this.index}}));
	}

	_handleModifyFilterChanged(e) {
		const ele = e.composedPath()[0];
		const subIndex = ele.subIndex;
		const fullFilterText = this.value;
		const unionPieces = splitUnionFilter(fullFilterText);
		const firstPart = ele.value;
		unionPieces[subIndex] = firstPart;
		const configurableInfo = CONFIGURABLE_FILTER_INFO[firstPart];
		const fullText = configurableInfo ? firstPart + '/' + configurableInfo.defaultsFactory() : unionPieces.join(UNION_FILTER_DELIMITER);
		this.dispatchEvent(new CustomEvent('filter-modified', {composed: true, detail: {value: fullText, index: this.index}}));
	}

	static get properties() {
		return {
			index: { type: Number },
			value: { type: String },
			filterDescriptions: {type:Object},
		};
	}
}

window.customElements.define('configure-collection-filter', ConfigureCollectionFilter);
