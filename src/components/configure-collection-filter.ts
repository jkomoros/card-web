import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

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
	ME_AUTHOR_ID,
} from '../filters.js';

import {
	REFERENCE_TYPES
} from '../card_fields.js';

import './configure-collection-key-card.js';
import './configure-collection-multiple-cards.js';
import './configure-collection-date.js';

import {
	TagInfos,
	Uid,
	ConfigurableFilterControlPiece
} from '../types.js';

import {
	FilterModifiedEvent,
	makeFilterModifiedEvent,
	makeFilterRemovedEvent
} from '../events.js';

@customElement('configure-collection-filter')
class ConfigureCollectionFilter extends LitElement {

	@property({ type : Number })
		index: number;

	@property({ type : String })
		value: string;

	@property({ type : Object })
		filterDescriptions: {[name : string] : string};

	@property({ type : Array })
		userIDs: Uid[];

	@property({ type : Object })
		cardTagInfos: TagInfos;

	static override styles = [
		ButtonSharedStyles,
		HelpStyles,
		css`
			li {
				padding-left: 1em;
				margin: 1em;
			}

			li.main {
				border-left: 1px solid var(--app-divider-color);
			}

			.pieces {
				display: flex;
				flex-direction: row;
			}
			.piece {
				display: flex;
				flex-direction: column;
			}

		`
	];

	override render() {
		const [firstFilterPart] = splitCompoundFilter(this.value);
		//TODO: handle combined normal filters e.g. `working-notes+content`
		const unionFilterPieces = splitUnionFilter(firstFilterPart);
		const isConfigurableFilter = CONFIGURABLE_FILTER_INFO[firstFilterPart] != undefined;
		return html`
			${this.index > 0 ? html`<li><em>AND</em></li>` : ''}
		<li class='main'>
			${unionFilterPieces.map((filterPiece, i) => html`${i > 0 ? html` <em>OR</em> ` : ''}<select @change=${this._handleModifyFilterChanged} data-sub-index=${i}>${this._filterOptions(filterPiece, unionFilterPieces.length <= 1)}</select>${help(this.filterDescriptions[filterPiece])}<button class='small' data-sub-index=${i} @click=${this._handleRemoveFilterClicked}>${DELETE_FOREVER_ICON}</button>`)}
			${isConfigurableFilter ? 
		html`<div class='pieces'>${piecesForConfigurableFilter(this.value).map((piece, i) => html`<div class='piece'><label>${piece.description}</label> ${this._configurableFilterPart(piece, i)}</div>`)}</div>`: 
		html`<button class='small' @click=${this._handleAddUnionFilterClicked} title='Add new filter to OR with previous filters in this row'>${PLUS_ICON}</button>`
}
		</li>
		`;
	}

	_configurableFilterPart(piece : ConfigurableFilterControlPiece, subIndex : number) : TemplateResult {
		//piece is obj with controlType, description, and value
		switch (piece.controlType) {
		case 'date':
			return html`<configure-collection-date .value=${piece.value} @filter-modified-complex=${this._handleModifyFilterRestChangedComplex} data-sub-index=${subIndex}></configure-collection-date>`;
		case 'multiple-cards':
			return html`<configure-collection-multiple-cards .value=${piece.value} .cardTagInfos=${this.cardTagInfos} @filter-modified-complex=${this._handleModifyFilterRestChangedComplex} data-sub-index=${subIndex}></configure-collection-multiple-cards>`;
		case 'key-card':
			return html`<configure-collection-key-card .value=${piece.value} .cardTagInfos=${this.cardTagInfos} @filter-modified-complex=${this._handleModifyFilterRestChangedComplex} data-sub-index=${subIndex}></configure-collection-key-card>`;
		case 'user-id':
			return html`<select data-sub-index=${subIndex} @change=${this._handleModifyFilterRestChanged} .value=${piece.value}>${[ME_AUTHOR_ID,...this.userIDs].map(item => html`<option .value=${item.toLowerCase()}>${item.toLowerCase()}</option>`)}</select>`;
		case 'reference-type':
			return html`<select data-sub-index=${subIndex} @change=${this._handleModifyFilterRestChanged} .value=${piece.value}>${Object.entries(REFERENCE_TYPES).map(entry => html`<option .value=${entry[0]} .title=${entry[1].description}>${entry[0]}</option>`)}</select>`;
		default:
			return html`<input type=${piece.controlType == 'int' ? 'number' : 'text'} min='0' step=${piece.controlType == 'float' ? 0.0001 : 1} data-sub-index=${subIndex} @change=${this._handleModifyFilterRestChanged} .value=${piece.value}>`;
		}
	}

	_filterOptions(selectedOptionName : string, showConfigurable : boolean) : unknown {
		//TODO: cache?
		const entries = Object.entries(this.filterDescriptions).filter(entry => entry[0] != EXCLUDE_FILTER_NAME && entry[0] != COMBINE_FILTER_NAME);
		//I'd rather have the current value selected in the <select>, but that wasn't working, so have the options select themselves.
		return repeat(entries, entry => entry[0], entry => html`<option .value=${entry[0]} .title=${entry[1]} .selected=${selectedOptionName == entry[0]} .disabled=${!showConfigurable && CONFIGURABLE_FILTER_INFO[entry[0]] != undefined}>${entry[0] + (CONFIGURABLE_FILTER_INFO[entry[0]] ? '*' : '')}</option>`);
	}


	_modifyFilterChanged(subIndex : number, newValue : string) {
		const oldText = this.value;
		const [firstPart] = splitCompoundFilter(oldText);
		const pieces = piecesForConfigurableFilter(oldText);
		pieces[subIndex].value = newValue;
		const newText = firstPart + '/' + pieces.map(piece => piece.value).join('/');
		this.dispatchEvent(makeFilterModifiedEvent(newText, this.index));
	}

	_handleModifyFilterRestChangedComplex(e : FilterModifiedEvent) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) throw new Error('not html element');
		this._modifyFilterChanged(parseInt(ele.dataset.subIndex || '0'), e.detail.value);
	}

	_handleModifyFilterRestChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		this._modifyFilterChanged(parseInt(ele.dataset.subIndex || '0'), ele.value);
	}

	_handleAddUnionFilterClicked(e : MouseEvent) {
		//The event likely happened on the svg but we want the button
		let ele = null;
		for (const possibleEle of e.composedPath()) {
			if (!(possibleEle instanceof HTMLElement)) continue;
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
		this.dispatchEvent(makeFilterModifiedEvent(fullFilterText, this.index));
	}

	_handleRemoveFilterClicked(e : MouseEvent) {
		//The event likely happened on the svg but we want the button
		let ele = null;
		for (const possibleEle of e.composedPath()) {
			if (!(possibleEle instanceof HTMLElement)) continue;
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
			filterPieces.splice(parseInt(ele.dataset.subIndex || '0'), 1);
			this.dispatchEvent(makeFilterModifiedEvent(filterPieces.join(UNION_FILTER_DELIMITER), this.index));
			return;
		}
		this.dispatchEvent(makeFilterRemovedEvent(this.index));
	}

	_handleModifyFilterChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const subIndex = parseInt(ele.dataset.subIndex || '0');
		const fullFilterText = this.value;
		const unionPieces = splitUnionFilter(fullFilterText);
		const firstPart = ele.value;
		unionPieces[subIndex] = firstPart;
		const configurableInfo = CONFIGURABLE_FILTER_INFO[firstPart];
		const fullText = configurableInfo ? firstPart + '/' + configurableInfo.arguments.map(arg => arg.default).join('/') : unionPieces.join(UNION_FILTER_DELIMITER);
		this.dispatchEvent(makeFilterModifiedEvent(fullText, this.index));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-filter': ConfigureCollectionFilter;
	}
}
