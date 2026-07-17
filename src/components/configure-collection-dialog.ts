import { html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectConfigureCollectionDialogOpen,
	selectFilterDescriptions,
	selectAuthorAndCollaboratorUserIDs,
	selectTagInfosForCards,
	selectSnapshotCollectionDescription,
	selectCardsSelected,
	selectUid
} from '../selectors.js';

import {
	askForPathToNavigateTo,
	closeConfigureCollectionDialog,
	navigateToCollection,
} from '../actions/app.js';

import {
	updateCollectionConfigurationSnapshot,
} from '../actions/collection.js';

import {
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithSortReversed,
	collectionDescriptionWithFilterRemoved,
	collectionDescriptionWithFilterModified,
	collectionDescriptionWithFilterAppended,
	CollectionDescription
} from '../collection_description.js';

import {
	SET_INFOS,
	SORTS,
	ALL_FILTER_NAME,
} from '../filters.js';

import {
	LINK_ICON,
	PLUS_ICON
} from '../../shared/icons.js';

import './configure-collection-filter.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	SetName,
	SortName
} from '../../shared/types.js';

import {
	TagInfos,
	State,
	Uid
} from '../types.js';

import {
	FilterModifiedEvent
} from '../events.js';

import {
	collectionComposerEnabled,
} from '../collection-composer-mode.js';

import {
	CollectionComposerSuggestion,
	collectionComposerSuggestions,
	readableCollectionExpression,
} from '../collection-composer-suggestions.js';

import {
	readRecentCollections,
} from '../collection-composer-history.js';

@customElement('configure-collection-dialog')
class ConfigureCollectionDialog extends connect(store)(DialogElement) {

	@state()
		_collectionDescription: CollectionDescription;

	@state()
		_filterDescriptions: {[filterName : string]: string};

	@state()
		_userIDs: Uid[];

	@state()
		_cardTagInfos: TagInfos;

	@state()
		_composerInput = '';

	@state()
		_highlightedSuggestion = 0;

	@state()
		_builderExpanded = false;

	@state()
		_cardsSelected = false;

	@state()
		_userScope = '';

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`
			.help {
				font-size:0.75em;
			}

			.row {
				display: flex;
				flex-direction: row;
				justify-content: space-between;
			}

			.row > div {
				display: flex;
				flex-direction: column;
			}

			.expression {
				font-size: 1.05em;
				line-height: 1.55;
				padding: 0.75em 0;
				color: var(--app-dark-text-color);
			}

			.expression strong {
				color: var(--app-primary-color);
				font-weight: 500;
			}

			.composer-input {
				border: 0;
				border-bottom: 1px solid var(--app-dark-text-color);
				font: inherit;
				font-size: 1.05em;
				padding: 0.6em 0.2em;
				width: 100%;
				box-sizing: border-box;
			}

			.composer-input:focus {
				border-bottom-color: var(--app-primary-color);
				outline: none;
			}

			.suggestion-heading {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
				margin-top: 1.2em;
				text-transform: uppercase;
			}

			.suggestions {
				list-style: none;
				margin: 0.25em 0 0;
				padding: 0;
			}

			.suggestion {
				border-top: 1px solid var(--app-divider-color);
				margin: 0;
			}

			.suggestion button {
				background: transparent;
				box-shadow: none;
				color: var(--app-dark-text-color);
				display: block;
				margin: 0;
				padding: 0.65em 0.5em;
				text-align: left;
				width: 100%;
			}

			.suggestion button:hover,
			.suggestion button[data-highlighted] {
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			.suggestion button[data-highlighted] {
				border-left: 3px solid var(--app-primary-color);
				padding-left: calc(0.5em - 3px);
			}

			.suggestion-detail,
			.key-hints,
			.no-suggestions {
				color: var(--app-dark-text-color-light);
				font-size: 0.78em;
				margin-top: 0.2em;
			}

			.builder-toggle {
				border-top: 1px solid var(--app-divider-color);
				margin-top: 0.75em;
				padding-top: 0.5em;
			}

			.builder-toggle button.small {
				color: var(--app-primary-color);
				margin: 0;
				padding: 0.35em 0;
			}

			.builder {
				margin-top: 0.5em;
			}
		`
	];

	override innerRender() {
		if (collectionComposerEnabled()) return this._composerRender();
		return this._builderRender();
	}

	_builderRender() {
		return html`
			<label>Filters</label>
			<ul>
				${this._collectionDescription.filters.map((filterName, index) => html`
					<configure-collection-filter
						.value=${filterName}
						.index=${index}
						.filterDescriptions=${this._filterDescriptions}
						.cardTagInfos=${this._cardTagInfos}
						.userIDs=${this._userIDs}
						@filter-modified=${this._handleFilterModified}
						@filter-removed=${this._handleFilterRemoved}>
					</configure-collection-filter>`)}
				<li>
					<button
						class='small'
						@click=${this._handleAddFilterClicked}
						title='Add a new filter (ANDed with other filters)'
					>
						${PLUS_ICON}
					</button>
				</li>
			</ul>
			<div class='row'>
				<div>
					<label>Set</label>
					<select @change=${this._handleSetSelectChanged} .value=${this._collectionDescription.set}>
						${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
					</select>
				</div>
				<div>
					<label>Sort</label>
					<select @change=${this._handleSortSelectChanged} .value=${this._collectionDescription.sort}>
						${Object.entries(SORTS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
					</select>
				</div>
				<div>
					<label for='reversed'>Sort Reversed</label>
					<input type='checkbox' @change=${this._handleSortReversedCheckboxChanged} id='reversed' .checked=${this._collectionDescription.sortReversed}>
				</div>
				<div>
					<label for='modify-path'>Manually modify path</label>
					<button class='small' id='modify-path' @click=${this._handleModifyPath}>${LINK_ICON}</button>
				</div>
			</div>
		`;
	}

	_composerRender() {
		if (!this._collectionDescription) return html``;
		const suggestions = this._composerSuggestions;
		const recentSuggestions = suggestions.filter(suggestion => suggestion.kind === 'recent');
		const refinementSuggestions = suggestions.filter(suggestion => suggestion.kind !== 'recent');
		return html`
			<div class='expression' aria-label='Current collection expression'>
				<strong>${readableCollectionExpression(this._collectionDescription)}</strong>
				 AND
			</div>
			<input
				class='composer-input'
				id='collection-composer-input'
				type='text'
				role='combobox'
				aria-autocomplete='list'
				aria-controls='collection-composer-suggestions'
				aria-expanded=${suggestions.length > 0}
				aria-activedescendant=${suggestions[this._highlightedSuggestion] ? `collection-suggestion-${this._highlightedSuggestion}` : ''}
				placeholder='Type a filter, value, or collection source…'
				.value=${this._composerInput}
				@input=${this._handleComposerInput}
				@keydown=${this._handleComposerKeyDown}
			>
			${suggestions.length ? html`
				<div class='suggestions' id='collection-composer-suggestions' role='listbox'>
					${recentSuggestions.length ? html`
						<div class='suggestion-heading'>Continue</div>
						${recentSuggestions.map(suggestion => this._suggestionRow(suggestion, suggestions.indexOf(suggestion)))}
					` : ''}
					${refinementSuggestions.length ? html`
						<div class='suggestion-heading'>${this._composerInput ? 'Interpretations' : 'Refine this collection'}</div>
						${refinementSuggestions.map(suggestion => this._suggestionRow(suggestion, suggestions.indexOf(suggestion)))}
					` : ''}
				</div>
			` : html`
				<div class='suggestion-heading'>${this._composerInput ? 'Interpretations' : 'Refine this collection'}</div>
				<div class='no-suggestions'>No complete interpretation yet. Keep typing or browse all filters.</div>
			`}
			<div class='key-hints'>↑↓ choose · Tab adds and keeps composing · Enter opens</div>
			<div class='builder-toggle'>
				<button class='small' @click=${this._handleBuilderToggle}>${this._builderExpanded ? 'Hide visual builder' : 'Browse all filters'}</button>
			</div>
			${this._builderExpanded ? html`<div class='builder'>${this._builderRender()}</div>` : ''}
		`;
	}

	_suggestionRow(suggestion : CollectionComposerSuggestion, index : number) {
		return html`
						<div class='suggestion' role='option' aria-selected=${index === this._highlightedSuggestion}>
							<button
								id='collection-suggestion-${index}'
								data-index=${index}
								?data-highlighted=${index === this._highlightedSuggestion}
								@mouseenter=${this._handleSuggestionHovered}
								@click=${this._handleSuggestionClicked}
							>
								<div>${suggestion.label}</div>
								<div class='suggestion-detail'>${suggestion.detail}</div>
							</button>
						</div>
		`;
	}

	get _composerSuggestions() : CollectionComposerSuggestion[] {
		if (!this._collectionDescription) return [];
		const recentCollections = readRecentCollections(this._userScope).map(entry => ({
			description: CollectionDescription.deserialize(entry.authoring),
			visits: entry.visits,
		}));
		return collectionComposerSuggestions(
			this._collectionDescription,
			this._composerInput,
			this._filterDescriptions || {},
			{cardsSelected: this._cardsSelected, recentCollections}
		);
	}

	constructor() {
		super();
		this.title = collectionComposerEnabled() ? 'Compose a collection' : 'Configure Collection';
	}

	_handleComposerInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLInputElement)) throw new Error('not input element');
		this._composerInput = input.value;
		this._highlightedSuggestion = 0;
	}

	_handleComposerKeyDown(e : KeyboardEvent) {
		const suggestions = this._composerSuggestions;
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (!suggestions.length) return;
			e.preventDefault();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			this._highlightedSuggestion = (this._highlightedSuggestion + direction + suggestions.length) % suggestions.length;
			return;
		}
		if (e.key === 'Tab' && suggestions.length) {
			e.preventDefault();
			this._applyComposerSuggestion(suggestions[this._highlightedSuggestion], false);
			return;
		}
		if (e.key === 'Enter' && suggestions.length) {
			e.preventDefault();
			this._applyComposerSuggestion(suggestions[this._highlightedSuggestion], true);
		}
	}

	_handleSuggestionHovered(e : MouseEvent) {
		const button = e.currentTarget;
		if (!(button instanceof HTMLButtonElement)) return;
		this._highlightedSuggestion = parseInt(button.dataset.index || '0');
	}

	_handleSuggestionClicked(e : MouseEvent) {
		const button = e.currentTarget;
		if (!(button instanceof HTMLButtonElement)) return;
		const suggestion = this._composerSuggestions[parseInt(button.dataset.index || '0')];
		if (suggestion) this._applyComposerSuggestion(suggestion, true);
	}

	_applyComposerSuggestion(suggestion : CollectionComposerSuggestion, open : boolean) {
		if (open) {
			store.dispatch(closeConfigureCollectionDialog());
			store.dispatch(navigateToCollection(suggestion.description));
			return;
		}
		store.dispatch(updateCollectionConfigurationSnapshot(suggestion.description));
		this._composerInput = '';
		this._highlightedSuggestion = 0;
	}

	_handleBuilderToggle() {
		this._builderExpanded = !this._builderExpanded;
	}

	_handleModifyPath() {
		store.dispatch(askForPathToNavigateTo());
	}

	_handleFilterModified(e : FilterModifiedEvent) {
		store.dispatch(updateCollectionConfigurationSnapshot(collectionDescriptionWithFilterModified(this._collectionDescription, e.detail.index, e.detail.value)));
	}

	_handleFilterRemoved(e : FilterModifiedEvent) {
		store.dispatch(updateCollectionConfigurationSnapshot(collectionDescriptionWithFilterRemoved(this._collectionDescription, e.detail.index)));
	}

	_handleAddFilterClicked() {
		store.dispatch(updateCollectionConfigurationSnapshot(collectionDescriptionWithFilterAppended(this._collectionDescription, ALL_FILTER_NAME)));
	}

	_handleSetSelectChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const set = ele.value as SetName;
		store.dispatch(updateCollectionConfigurationSnapshot(collectionDescriptionWithSet(this._collectionDescription, set)));
	}

	_handleSortSelectChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const sort = ele.value as SortName;
		store.dispatch(updateCollectionConfigurationSnapshot(collectionDescriptionWithSort(this._collectionDescription, sort)));
	}

	_handleSortReversedCheckboxChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLInputElement)) throw new Error('not input element');
		const sortReversed = ele.checked;
		store.dispatch(updateCollectionConfigurationSnapshot(collectionDescriptionWithSortReversed(this._collectionDescription, sortReversed)));
	}

	_handleDoneClicked() {
		store.dispatch(closeConfigureCollectionDialog());
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(closeConfigureCollectionDialog());
	}

	override updated(changedProps : PropertyValues<this>) {
		super.updated(changedProps);
		if (changedProps.has('open') && this.open) {
			this._composerInput = '';
			this._highlightedSuggestion = 0;
			this._builderExpanded = false;
		}
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectConfigureCollectionDialogOpen(state);
		this.mobile = state.app ? state.app.mobileMode : false;
		this._collectionDescription = selectSnapshotCollectionDescription(state);
		this._filterDescriptions = selectFilterDescriptions(state);
		this._userIDs = selectAuthorAndCollaboratorUserIDs(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._cardsSelected = selectCardsSelected(state);
		this._userScope = selectUid(state);
		this.title = collectionComposerEnabled() ? 'Compose a collection' : 'Configure Collection';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-dialog': ConfigureCollectionDialog;
	}
}
