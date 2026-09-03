import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { live } from 'lit/directives/live.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	DELETE_FOREVER_ICON,
	PLUS_ICON
} from '../../shared/icons.js';

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
} from '../../shared/card_fields.js';

import {
	collectionFilterDescription,
	collectionFilterDisplayName
} from '../collection-composer-suggestions.js';

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

	//Returns whether focus actually landed, so a caller can fall back to
	//something else rather than leaving the user's focus behind the editor it
	//just opened. The nested branch used to report `true` for merely HAVING a
	//nested control, whether or not that control found anything to focus — so
	//the one case that most needed a fallback was the one that claimed success.
	focusPrimaryControl() : boolean {
		const nestedControl = this.shadowRoot?.querySelector<HTMLElement & {focusPrimaryControl?: () => boolean}>(
			'.pieces configure-collection-date, .pieces configure-collection-key-card, .pieces configure-collection-multiple-cards'
		);
		if (nestedControl?.focusPrimaryControl) {
			return nestedControl.focusPrimaryControl();
		}
		const configurableControl = this.shadowRoot?.querySelector<HTMLElement>('.pieces select, .pieces input, .pieces button');
		const control = configurableControl || (this.lockFilterFamily ? null : this.shadowRoot?.querySelector<HTMLElement>('select, input, button'));
		control?.focus();
		return Boolean(control);
	}

	@property({ type : Number })
		index: number;

	@property({ type : String })
		value: string;

	@property({ type : Object })
		filterDescriptions: {[name : string] : string};

	@property({ type : Array })
		userIDs: Uid[];

	@property({ type : Object })
		userInfos: TagInfos;

	@property({ type : Object })
		cardTagInfos: TagInfos;

	// Focused composer editors already name the selected family. Locking it
	// removes the legacy all-filters dropdown and exposes only its useful values.
	@property({ type : Boolean })
		lockFilterFamily = false;

	@property({ type : Boolean })
		allowRemove = true;

	//The app has ONE breakpoint and it is not a CSS media query (§4.6): it lives
	//in installMediaQueryWatcher and is threaded down as a property. This
	//component sits inside another component's shadow root, so the dialog's own
	//`.mobile` rules cannot reach it — the property comes down the same way the
	//dialog gets it from the store, and reflects so :host([mobile]) can key off
	//it.
	@property({ type : Boolean, reflect : true })
		mobile = false;

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
				flex-wrap: wrap;
				gap: 0.5em;
			}
			.piece {
				display: flex;
				flex-direction: column;
				min-width: 0;
				max-width: 100%;
			}

			.locked {
				display: flex;
				flex-direction: column;
				gap: 0.75em;
			}

			/* The only text-bearing button in this component. ButtonSharedStyles'
			   base button is --app-light-text-color on --app-dark-text-color and
			   .small clears only the BACKGROUND, so without a colour here this
			   read as white text on the editor's white surface. Same fix the
			   composer's .verb rule makes for its own eleven; a shadow root
			   cannot share that rule, and one invisible button is not reason
			   enough to add a sixth variant to the app's button vocabulary. */
			.locked .remove-filter {
				align-self: flex-start;
				color: var(--app-primary-color);
				min-height: 44px;
			}

			select,
			input {
				max-width: 100%;
			}

			:host([mobile]) li {
				margin: 0.5em 0;
				padding-left: 0.5em;
			}

			:host([mobile]) button,
			:host([mobile]) select,
			:host([mobile]) input {
				min-height: 44px;
			}

		`
	];

	override render() {
		const [firstFilterPart] = splitCompoundFilter(this.value);
		//TODO: handle combined normal filters e.g. `working-notes+content`
		const unionFilterPieces = splitUnionFilter(firstFilterPart);
		const isConfigurableFilter = CONFIGURABLE_FILTER_INFO[firstFilterPart] != undefined;
		if (this.lockFilterFamily) return html`
			<div class='main locked'>
				${isConfigurableFilter ? this._argumentEditors() : html`<div>This filter has no additional settings.</div>`}
				${this.allowRemove ? html`<button class='small remove-filter' @click=${this._handleRemoveWholeFilterClicked}>Remove filter</button>` : ''}
			</div>
		`;
		return html`
			${this.index > 0 ? html`<li><em>AND</em></li>` : ''}
		<li class='main'>
			<!-- A filter's URL spelling is an internal identifier (§1.4), and an
			     accessible name is user-facing copy like any other. Both names
			     go through the one function that maps a clause to the word the
			     product uses for it, so a screen reader hears "Working Notes"
			     where the select shows the same clause. -->
			${unionFilterPieces.map((filterPiece, i) => html`${i > 0 ? html` <em>OR</em> ` : ''}<select aria-label=${`Filter ${i + 1}: ${collectionFilterDisplayName(filterPiece)}`} @change=${this._handleModifyFilterChanged} data-sub-index=${i}>${this._filterOptions(filterPiece, unionFilterPieces.length <= 1)}</select>${help(collectionFilterDescription(filterPiece, this.filterDescriptions))}<button class='small' title='Remove this filter' aria-label=${`Remove the ${collectionFilterDisplayName(filterPiece)} filter`} data-sub-index=${i} @click=${this._handleRemoveFilterClicked}>${DELETE_FOREVER_ICON}</button>`)}
			${isConfigurableFilter ? this._argumentEditors() :
		html`<button class='small' aria-label='Add an OR filter' @click=${this._handleAddUnionFilterClicked} title='Add new filter to OR with previous filters in this row'>${PLUS_ICON}</button>`
}
		</li>
		`;
	}

	//The help badge is OUTSIDE the <label>, beside it. Inside, its aria-label
	//would be read as part of the control's own name — the badge is a tab stop
	//with role='note' precisely so a touch user can reach the explanation, and
	//folding it into the label would say the whole sentence every time the
	//control takes focus. The filter-family select one level up already places
	//its help() the same way.
	_argumentEditors() {
		return html`<div class='pieces'>${piecesForConfigurableFilter(this.value).map((piece, i) => html`<label class='piece'><span>${piece.description}</span>${this._configurableFilterPart(piece, i)}</label>${piece.help ? help(piece.help) : ''}`)}</div>`;
	}

	_handleRemoveWholeFilterClicked() {
		this.dispatchEvent(makeFilterRemovedEvent(this.index));
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
		//The options select themselves, for the same reason _filterOptions does:
		//a `.value` binding on the <select> commits before the child part that
		//renders the <option>s, so it lands on an empty select and is silently
		//dropped. The control then displays its first option while the filter
		//says something else.
		case 'user-id':
			return html`<select aria-label=${piece.description} data-sub-index=${subIndex} @change=${this._handleModifyFilterRestChanged}>${[ME_AUTHOR_ID,...this.userIDs].map(item => html`<option value=${item.toLowerCase()} .selected=${live(item.toLowerCase() === piece.value)}>${item === ME_AUTHOR_ID ? 'Me' : (this.userInfos?.[item]?.title || item)}</option>`)}</select>`;
		case 'reference-type':
			return html`<select aria-label=${piece.description} data-sub-index=${subIndex} @change=${this._handleModifyFilterRestChanged}>${Object.entries(REFERENCE_TYPES).map(entry => html`<option value=${entry[0]} .title=${entry[1].description} .selected=${live(entry[0] === piece.value)}>${entry[1].name}</option>`)}</select>`;
		default:
			return html`<input aria-label=${piece.description} type=${piece.controlType == 'int' ? 'number' : 'text'} min='0' step=${piece.controlType == 'float' ? 0.0001 : 1} data-sub-index=${subIndex} @change=${this._handleModifyFilterRestChanged} .value=${piece.value}>`;
		}
	}

	_filterOptions(selectedOptionName : string, showConfigurable : boolean) : unknown {
		//TODO: cache?
		const entries = Object.entries(this.filterDescriptions).filter(entry => entry[0] != EXCLUDE_FILTER_NAME && entry[0] != COMBINE_FILTER_NAME);
		//I'd rather have the current value selected in the <select>, but that wasn't working, so have the options select themselves.
		//live() keeps that honest even when a change event does not move the
		//value: without it Lit's dirty check would skip the re-assignment and
		//leave the control displaying the user's pick rather than the filter.
		//The TITLE goes through the one function that decides a filter's
		//description, so the synthesized 'Inverse of <internal id>' cannot reach
		//a tooltip here while the catalog and the suggestion list two surfaces
		//away both say something honest (HS-1.4).
		return repeat(entries, entry => entry[0], entry => html`<option .value=${entry[0]} .title=${collectionFilterDescription(entry[0], this.filterDescriptions)} .selected=${live(selectedOptionName == entry[0])} .disabled=${!showConfigurable && CONFIGURABLE_FILTER_INFO[entry[0]] != undefined}>${entry[0] + (CONFIGURABLE_FILTER_INFO[entry[0]] ? '*' : '')}</option>`);
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
		if (!(ele instanceof HTMLSelectElement) && !(ele instanceof HTMLInputElement)) throw new Error('not input or select element');
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
