import { html, css, PropertyValues } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectConfigureCollectionDialogOpen,
	selectFilterDescriptions,
	selectCollectionComposerCandidates,
	selectAuthorAndCollaboratorUserIDs,
	selectTagInfosForCards,
	selectSnapshotCollectionDescription,
	selectActiveCollectionDescription,
	selectCardsSelected,
	selectUid,
	selectActiveCardID,
	selectActiveCard,
} from '../selectors.js';

import {
	askForPathToNavigateTo,
	cancelConfigureCollectionDialog,
	closeConfigureCollectionDialog,
	navigateToCollectionWithResult,
	showSnackbar,
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
	Uid,
	ProcessedCard,
} from '../types.js';

import {
	FilterModifiedEvent
} from '../events.js';

import {
	collectionComposerEnabled,
	collectionComposerPreviewEnabled,
} from '../collection-composer-mode.js';

import {
	corpusWorkerRunCollection,
} from '../corpus-bridge.js';

import {
	formatCollectionCardCount,
	formatCollectionCountDelta,
	startCollectionComposerPreviews,
} from '../collection-composer-preview.js';

import {
	CollectionComposerSuggestion,
	CollectionComposerCandidate,
	activeCardMetadataCandidates,
	activeCardRelationshipCandidates,
	collectionExpressionParts,
	readableCollectionFilter,
	collectionComposerSuggestions,
	readableCollectionExpression,
} from '../collection-composer-suggestions.js';

import {
	readRecentCollections,
} from '../collection-composer-history.js';

import {
	currentBrowserLocation,
} from '../collection-composer-receipt.js';

@customElement('configure-collection-dialog')
class ConfigureCollectionDialog extends connect(store)(DialogElement) {

	@state()
		_collectionDescription: CollectionDescription;

	@state()
		_filterDescriptions: {[filterName : string]: string};

	@state()
		_composerCandidates: CollectionComposerCandidate[] = [];

	@state()
		_activeCard : ProcessedCard | null = null;

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

	@state()
		_previewCounts: {[suggestionID : string]: number} = {};

	@state()
		_activeCardID = '';

	@state()
		_activationPending = false;

	@state()
		_activationMessage = '';

	@state()
		_selectedClauseIndex = -1;

	@state()
		_draftReceiptMessage = '';

	@state()
		_clauseSelectionMessage = '';

	_draftUndoDescription : CollectionDescription | null = null;
	_cancelPreviews : (() => void) | null = null;
	readonly _draftPreviewID = 'current-draft-preview';
	_draftPreviewCache : {description: string, count: number} | null = null;

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

			.mobile .row {
				flex-wrap: wrap;
				gap: 0.75em;
			}

			.mobile .row > div {
				flex: 1 1 8em;
				min-width: 0;
			}

			.expression {
				align-items: center;
				color: var(--app-dark-text-color);
				display: flex;
				flex-wrap: wrap;
				font-size: 1.05em;
				gap: 0.3em;
				line-height: 1.55;
				overflow-wrap: anywhere;
				padding: 0.75em 0;
			}

			.expression-set {
				color: var(--app-primary-color);
				font-weight: 500;
			}

			.expression-operator,
			.expression-modifiers {
				color: var(--app-dark-text-color-light);
				font-size: 0.8em;
			}

			.expression-clause {
				align-items: stretch;
				border: 1px solid var(--app-divider-color);
				border-radius: 2px;
				display: inline-flex;
				min-width: 0;
			}

			.expression-clause[data-selected] {
				border-color: var(--app-primary-color);
				box-shadow: 0 0 0 1px var(--app-primary-color);
			}

			.expression-clause button {
				background: transparent;
				box-shadow: none;
				color: var(--app-dark-text-color);
				margin: 0;
				min-height: 44px;
			}

			.expression-clause button:hover,
			.expression-clause button:focus-visible {
				background: var(--app-primary-color-light-very-transparent);
				box-shadow: none;
			}

			.expression-clause-label {
				max-width: 18em;
				overflow-wrap: anywhere;
				padding: 0.35em 0.6em;
				text-align: left;
			}

			.expression-clause-remove {
				border-left: 1px solid var(--app-divider-color);
				font-size: 1.2em;
				min-width: 44px;
				padding: 0.35em;
			}

			.composer-input {
				border: 0;
				border-bottom: 1px solid var(--app-dark-text-color);
				box-sizing: border-box;
				flex: 1 1 14em;
				font: inherit;
				padding: 0.6em 0.2em;
				width: auto;
			}

			.composer-input:focus {
				border-bottom-color: var(--app-primary-color);
			}

			.composer-input:focus-visible {
				border-bottom-color: transparent;
				outline: 2px solid var(--app-primary-color);
				outline-offset: 2px;
			}

			.draft-receipt {
				align-items: center;
				color: var(--app-dark-text-color-light);
				display: flex;
				font-size: 0.82em;
				gap: 0.5em;
			}

			.draft-receipt button {
				color: var(--app-primary-color);
				margin: 0;
			}

			.visually-hidden {
				clip: rect(0 0 0 0);
				clip-path: inset(50%);
				height: 1px;
				overflow: hidden;
				position: absolute;
				white-space: nowrap;
				width: 1px;
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
				max-height: min(42vh, 26em);
				overflow-y: auto;
				overscroll-behavior: contain;
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
				overflow-wrap: anywhere;
			}

			.suggestion-count {
				color: var(--app-dark-text-color-light);
				float: right;
				font-size: 0.82em;
				margin-left: 1em;
			}

			.suggestion-action {
				color: var(--app-primary-color);
				float: right;
				font-size: 0.68em;
				letter-spacing: 0.04em;
				margin-left: 0.75em;
				text-transform: uppercase;
			}

			.builder-toggle {
				border-top: 1px solid var(--app-divider-color);
				margin-top: 0.75em;
				padding-top: 0.5em;
			}

			.builder-toggle button.small {
				color: var(--app-primary-color);
				margin: 0;
				min-height: 44px;
				padding: 0.35em 0;
			}

			.builder {
				margin-top: 0.5em;
			}

			.mobile .builder ul {
				padding-left: 1em;
			}

			.mobile .builder select,
			.mobile .builder input,
			.mobile .builder button {
				min-height: 44px;
				max-width: 100%;
			}

			.composer-actions {
				display: flex;
				justify-content: flex-end;
				margin-top: 0.75em;
				padding: 0.5em 0 max(0.25em, env(safe-area-inset-bottom));
			}

			.composer-actions .primary {
				min-height: 44px;
			}

			.activation-message {
				color: var(--app-primary-color);
				font-size: 0.85em;
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
					<label for='collection-set'>Set</label>
					<select id='collection-set' @change=${this._handleSetSelectChanged} .value=${this._collectionDescription.set}>
						${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
					</select>
				</div>
				<div>
					<label for='collection-sort'>Sort</label>
					<select id='collection-sort' @change=${this._handleSortSelectChanged} .value=${this._collectionDescription.sort}>
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
		const highlighted = suggestions[this._highlightedSuggestion];
		const expressionParts = collectionExpressionParts(this._collectionDescription, this._composerFilterLabels);
		const draftCount = this._previewCounts[this._draftPreviewID];
		const recentSuggestions = suggestions.filter(suggestion => suggestion.kind === 'recent');
		const refinementSuggestions = suggestions.filter(suggestion => suggestion.kind !== 'recent');
		return html`
			<div class='visually-hidden' aria-live='polite'>Draft: ${readableCollectionExpression(this._collectionDescription, this._composerFilterLabels)}</div>
			<div class='expression' aria-label='Draft collection clauses'>
				<span class='expression-set'>${expressionParts.set.label}</span>
				${expressionParts.filters.map(filter => html`
					<span class='expression-operator' aria-hidden='true'>AND</span>
					<span class='expression-clause' role='group' aria-label=${`${filter.label} filter`} ?data-selected=${filter.index === this._selectedClauseIndex}>
						<button
							class='expression-clause-label'
							aria-label=${`Edit ${filter.label} filter`}
							@click=${() => this._handleClauseEdit(filter.index)}
						>${filter.label}</button>
						<button
							class='expression-clause-remove'
							aria-label=${`Remove ${filter.label} filter`}
							title=${`Remove ${filter.label} filter`}
							@click=${() => this._removeDraftClause(filter.index)}
						>×</button>
					</span>
				`)}
				${expressionParts.modifiers.length ? html`<span class='expression-modifiers'>· ${expressionParts.modifiers.join(' · ')}</span>` : ''}
				${draftCount === undefined ? '' : html`<span class='expression-count'>· ${formatCollectionCardCount(draftCount)}</span>`}
				<input
					class='composer-input'
					id='collection-composer-input'
					type='text'
					role='combobox'
					aria-label='Compose collection filters'
					aria-autocomplete='list'
					aria-controls='collection-composer-suggestions'
					aria-expanded=${suggestions.length > 0}
					aria-activedescendant=${ifDefined(suggestions[this._highlightedSuggestion] ? `collection-suggestion-${this._highlightedSuggestion}` : undefined)}
					aria-busy=${this._activationPending}
					placeholder='Type another condition…'
					.value=${this._composerInput}
					@input=${this._handleComposerInput}
					@keydown=${this._handleComposerKeyDown}
				>
			</div>
			${this._draftReceiptMessage ? html`
				<div class='draft-receipt' role='status'>
					<span>${this._draftReceiptMessage}</span>
					${this._draftUndoDescription ? html`<button class='small' @click=${this._undoDraftEdit}>Undo</button>` : ''}
				</div>
			` : ''}
			${this._clauseSelectionMessage ? html`<div class='draft-receipt' role='status'>${this._clauseSelectionMessage}</div>` : ''}
			${this._activationPending || this._activationMessage ? html`
				<div class='activation-message' role=${this._activationMessage ? 'alert' : 'status'} aria-live=${this._activationMessage ? 'assertive' : 'polite'}>
					${this._activationMessage || 'Opening collection…'}
				</div>
			` : ''}
			${suggestions.length ? html`
				<div class='suggestions' id='collection-composer-suggestions' role='listbox'>
					${recentSuggestions.length ? html`
						<div role='group' aria-labelledby='recent-suggestion-heading'>
							<div class='suggestion-heading' id='recent-suggestion-heading'>Continue</div>
							${recentSuggestions.map(suggestion => this._suggestionRow(suggestion, suggestions.indexOf(suggestion)))}
						</div>
					` : ''}
					${refinementSuggestions.length ? html`
						<div role='group' aria-labelledby='refinement-suggestion-heading'>
							<div class='suggestion-heading' id='refinement-suggestion-heading'>${this._composerInput ? 'Interpretations' : 'Refine this collection'}</div>
							${refinementSuggestions.map(suggestion => this._suggestionRow(suggestion, suggestions.indexOf(suggestion)))}
						</div>
					` : ''}
				</div>
			` : html`
				<div class='suggestion-heading'>${this._composerInput ? 'Interpretations' : 'Refine this collection'}</div>
				<div class='no-suggestions'>No complete interpretation yet. Keep typing or browse all filters.</div>
			`}
			<div class='key-hints'>${this._selectedClauseIndex >= 0 ?
				'←→ choose clause · Delete removes · type to continue' : highlighted?.action === 'open' ?
				'↑↓ choose · Click or Enter opens' :
				this._composerInput.trim() ? '↑↓ choose · Click or Tab adds · Enter adds and opens' : '↑↓ choose · Click edits · Enter adds and opens'}</div>
			<div class='builder-toggle'>
				<button class='small' @click=${this._handleBuilderToggle}>${this._builderExpanded ? 'Hide visual builder' : 'Browse all filters'}</button>
			</div>
			${this._builderExpanded ? html`<div class='builder'>${this._builderRender()}</div>` : ''}
			<div class='composer-actions'>
				<button class='primary' ?disabled=${this._activationPending} @click=${this._handleOpenCurrentDraft}>${draftCount === undefined ? 'Open this collection' : `Open ${formatCollectionCardCount(draftCount)}`}</button>
			</div>
		`;
	}

	_suggestionRow(suggestion : CollectionComposerSuggestion, index : number) {
		const count = this._previewCounts[suggestion.id];
		const draftCount = this._previewCounts[this._draftPreviewID];
		const countDescription = count === undefined ? '' : `${formatCollectionCardCount(count)}${draftCount === undefined ? '' : ` · ${formatCollectionCountDelta(count, draftCount)}`}`;
		return html`
						<div class='suggestion'>
							<button
								id='collection-suggestion-${index}'
								role='option'
								tabindex='-1'
								aria-selected=${index === this._highlightedSuggestion}
								aria-label=${`${suggestion.action}: ${suggestion.label}. ${suggestion.detail}${countDescription ? `. ${countDescription}` : ''}`}
								data-index=${index}
								?disabled=${this._activationPending}
								?data-highlighted=${index === this._highlightedSuggestion}
								@mouseenter=${() => this._highlightedSuggestion = index}
								@click=${() => this._applyComposerSuggestion(suggestion, suggestion.action === 'open')}
							>
								<div>
									${suggestion.label}
									<span class='suggestion-action'>${suggestion.action}</span>
									${countDescription ? html`<span class='suggestion-count'>${countDescription}</span>` : ''}
								</div>
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
			{
				cardsSelected: this._cardsSelected,
				recentCollections,
				candidates: this._contextualComposerCandidates,
			}
		);
	}

	get _contextualComposerCandidates() : CollectionComposerCandidate[] {
		const activeMetadata = activeCardMetadataCandidates(this._activeCard ? {
			section: this._activeCard.section,
			tags: this._activeCard.tags,
			cardType: this._activeCard.card_type,
			contributors: [this._activeCard.author, ...this._activeCard.collaborators],
		} : null, this._composerCandidates);
		const contextualFilters = new Set(activeMetadata.map(candidate => candidate.filter));
		return [
			...activeMetadata,
			...this._composerCandidates.filter(candidate => !contextualFilters.has(candidate.filter)),
			...activeCardRelationshipCandidates(this._activeCardID),
		];
	}

	get _composerFilterLabels() : Record<string, string> {
		return Object.fromEntries(this._contextualComposerCandidates.map(candidate => [candidate.filter, candidate.clauseLabel || candidate.label]));
	}

	_readableComposerFilter(filter : string) : string {
		return this._composerFilterLabels[filter] || readableCollectionFilter(filter);
	}

	constructor() {
		super();
		this.title = collectionComposerEnabled() ? 'Compose a collection' : 'Configure Collection';
	}

	_handleComposerInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLInputElement)) throw new Error('not input element');
		this._composerInput = input.value;
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		this._highlightedSuggestion = 0;
		this._activationMessage = '';
	}

	_handleComposerKeyDown(e : KeyboardEvent) {
		if (this._activationPending) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		if (e.isComposing || e.keyCode === 229) return;
		const suggestions = this._composerSuggestions;
		if (!this._composerInput && this._collectionDescription.filters.length) {
			if (e.key === 'Backspace') {
				e.preventDefault();
				e.stopPropagation();
				if (this._selectedClauseIndex < 0) {
					this._selectedClauseIndex = this._collectionDescription.filters.length - 1;
					this._clauseSelectionMessage = `${this._readableComposerFilter(this._collectionDescription.filters[this._selectedClauseIndex])} selected · Backspace again to remove`;
				} else {
					this._removeDraftClause(this._selectedClauseIndex);
				}
				return;
			}
			if (e.key === 'Delete' && this._selectedClauseIndex >= 0) {
				e.preventDefault();
				e.stopPropagation();
				this._removeDraftClause(this._selectedClauseIndex);
				return;
			}
			if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
				e.preventDefault();
				e.stopPropagation();
				if (e.key === 'ArrowLeft') {
					this._selectedClauseIndex = this._selectedClauseIndex < 0 ? this._collectionDescription.filters.length - 1 : Math.max(0, this._selectedClauseIndex - 1);
				} else {
					this._selectedClauseIndex = this._selectedClauseIndex < 0 ? 0 : this._selectedClauseIndex + 1;
					if (this._selectedClauseIndex >= this._collectionDescription.filters.length) this._selectedClauseIndex = -1;
				}
				this._clauseSelectionMessage = this._selectedClauseIndex < 0 ? '' : `${this._readableComposerFilter(this._collectionDescription.filters[this._selectedClauseIndex])} selected`;
				return;
			}
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			if (e.isComposing || e.keyCode === 229) return;
			if (!suggestions.length) return;
			e.preventDefault();
			e.stopPropagation();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			this._highlightedSuggestion = (this._highlightedSuggestion + direction + suggestions.length) % suggestions.length;
			return;
		}
		if (e.key === 'Tab' && !e.shiftKey && suggestions.length && this._composerInput.trim() && suggestions[this._highlightedSuggestion].action !== 'open') {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			this._applyComposerSuggestion(suggestions[this._highlightedSuggestion], false);
			return;
		}
		if (e.key === 'Enter' && suggestions.length) {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			this._applyComposerSuggestion(suggestions[this._highlightedSuggestion], true);
		}
	}

	_applyComposerSuggestion(suggestion : CollectionComposerSuggestion, open : boolean) {
		if (open) {
			if (this._activationPending) return;
			const alreadyActive = selectActiveCollectionDescription(store.getState() as State).serialize() === suggestion.description.serialize();
			if (alreadyActive) {
				store.dispatch(cancelConfigureCollectionDialog());
				return;
			}
			this._activationPending = true;
			this._activationMessage = '';
			const result = store.dispatch(navigateToCollectionWithResult(suggestion.description));
			if (result.status === 'blocked-editing') {
				this._activationPending = false;
				this._activationMessage = 'Finish or cancel the current card edit before opening this collection.';
				return;
			}
			if (result.status === 'unchanged') {
				this._activationPending = false;
				store.dispatch(cancelConfigureCollectionDialog());
				return;
			}
			store.dispatch(cancelConfigureCollectionDialog());
			const count = this._previewCounts[suggestion.id];
			const expression = readableCollectionExpression(suggestion.description, this._composerFilterLabels);
			store.dispatch(showSnackbar(
				`Now showing ${expression}${count === undefined ? '' : ` · ${count} ${count === 1 ? 'card' : 'cards'}`}`,
				'back',
				currentBrowserLocation()
			));
			return;
		}
		this._commitDraftEdit(suggestion.description, `${suggestion.action[0].toUpperCase() + suggestion.action.slice(1)}: ${suggestion.label}`, true);
		this._composerInput = '';
		this._highlightedSuggestion = 0;
	}

	_commitDraftEdit(description : CollectionDescription, message : string, focusInput = false) {
		this._draftUndoDescription = this._collectionDescription;
		this._draftReceiptMessage = message;
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		if (focusInput) this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_removeDraftClause(index : number) {
		const filter = this._collectionDescription.filters[index];
		if (filter === undefined) return;
		this._commitDraftEdit(
			collectionDescriptionWithFilterRemoved(this._collectionDescription, index),
			`Removed ${this._readableComposerFilter(filter)}`,
			true
		);
	}

	_undoDraftEdit() {
		if (!this._draftUndoDescription) return;
		const description = this._draftUndoDescription;
		this._draftUndoDescription = null;
		this._draftReceiptMessage = 'Restored previous draft';
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	async _handleClauseEdit(index : number) {
		this._selectedClauseIndex = index;
		this._clauseSelectionMessage = `Editing ${this._readableComposerFilter(this._collectionDescription.filters[index])}`;
		this._builderExpanded = true;
		await this.updateComplete;
		const controls = this.shadowRoot?.querySelectorAll('configure-collection-filter');
		const control = controls?.[index];
		if (control && 'focusPrimaryControl' in control) control.focusPrimaryControl();
	}

	_handleBuilderToggle() {
		this._builderExpanded = !this._builderExpanded;
		if (!this._builderExpanded) {
			this._selectedClauseIndex = -1;
			this._clauseSelectionMessage = '';
			this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
		}
	}

	_handleOpenCurrentDraft() {
		this._applyComposerSuggestion({
			id: 'current-draft',
			kind: 'source',
			action: 'open',
			label: 'Open this collection',
			detail: readableCollectionExpression(this._collectionDescription, this._composerFilterLabels),
			description: this._collectionDescription,
		}, true);
	}

	_handleModifyPath() {
		store.dispatch(askForPathToNavigateTo());
	}

	_handleFilterModified(e : FilterModifiedEvent) {
		this._commitDraftEdit(collectionDescriptionWithFilterModified(this._collectionDescription, e.detail.index, e.detail.value), 'Updated filter');
	}

	_handleFilterRemoved(e : FilterModifiedEvent) {
		this._removeDraftClause(e.detail.index);
	}

	_handleAddFilterClicked() {
		this._commitDraftEdit(collectionDescriptionWithFilterAppended(this._collectionDescription, ALL_FILTER_NAME), 'Added filter');
	}

	_handleSetSelectChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const set = ele.value as SetName;
		this._commitDraftEdit(collectionDescriptionWithSet(this._collectionDescription, set), `Changed base set to ${set}`);
	}

	_handleSortSelectChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const sort = ele.value as SortName;
		this._commitDraftEdit(collectionDescriptionWithSort(this._collectionDescription, sort), `Changed sort to ${sort}`);
	}

	_handleSortReversedCheckboxChanged(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLInputElement)) throw new Error('not input element');
		const sortReversed = ele.checked;
		this._commitDraftEdit(collectionDescriptionWithSortReversed(this._collectionDescription, sortReversed), sortReversed ? 'Reversed sort' : 'Restored normal sort');
	}

	override _handleKeyDown(e : KeyboardEvent) {
		if (this.open && this._builderExpanded && e.key === 'Escape' && !e.defaultPrevented) {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			this._builderExpanded = false;
			this._selectedClauseIndex = -1;
			this._clauseSelectionMessage = '';
			this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
			return;
		}
		super._handleKeyDown(e);
	}

	_handleDoneClicked() {
		store.dispatch(closeConfigureCollectionDialog());
	}

	override _shouldClose() {
		//Override base class.
		if (collectionComposerEnabled()) {
			store.dispatch(cancelConfigureCollectionDialog());
		} else {
			store.dispatch(closeConfigureCollectionDialog());
		}
	}

	override updated(changedProps : PropertyValues<this>) {
		super.updated(changedProps);
		if (changedProps.has('_highlightedSuggestion')) {
			this.shadowRoot?.querySelector(`#collection-suggestion-${this._highlightedSuggestion}`)?.scrollIntoView?.({block: 'nearest'});
		}
		if (changedProps.has('open')) {
			this._activationPending = false;
			this._activationMessage = '';
			if (this.open) {
				this._composerInput = '';
				this._highlightedSuggestion = 0;
				this._builderExpanded = false;
				this._selectedClauseIndex = -1;
				this._draftReceiptMessage = '';
				this._clauseSelectionMessage = '';
				this._draftUndoDescription = null;
			}
		}
		if (
			changedProps.has('open') ||
			changedProps.has('_composerInput') ||
			changedProps.has('_collectionDescription') ||
			changedProps.has('_activeCardID') ||
			changedProps.has('_activeCard') ||
			changedProps.has('_filterDescriptions') ||
			changedProps.has('_composerCandidates') ||
			changedProps.has('_cardsSelected') ||
			changedProps.has('_userScope')
		) this._refreshPreviewCounts();
	}

	_refreshPreviewCounts() {
		if (this._cancelPreviews) this._cancelPreviews();
		this._cancelPreviews = null;
		const draftDescription = this._collectionDescription?.serialize();
		const cachedDraftCount = draftDescription && this._draftPreviewCache?.description === draftDescription ? this._draftPreviewCache.count : undefined;
		this._previewCounts = cachedDraftCount === undefined ? {} : {[this._draftPreviewID]: cachedDraftCount};
		if (!this.open || !collectionComposerPreviewEnabled()) return;
		const previewSuggestions = [...this._composerSuggestions];
		if (cachedDraftCount === undefined) previewSuggestions.unshift({
			id: this._draftPreviewID,
			kind: 'source',
			action: 'open',
			label: 'Current draft',
			detail: '',
			description: this._collectionDescription,
		});
		this._cancelPreviews = startCollectionComposerPreviews(
			previewSuggestions,
			this._activeCardID,
			corpusWorkerRunCollection,
			(suggestionID, count) => {
				if (!this.open) return;
				if (suggestionID === this._draftPreviewID) this._draftPreviewCache = {description: draftDescription, count};
				this._previewCounts = {...this._previewCounts, [suggestionID]: count};
			}
		);
	}

	override disconnectedCallback() {
		if (this._cancelPreviews) this._cancelPreviews();
		this._cancelPreviews = null;
		super.disconnectedCallback();
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectConfigureCollectionDialogOpen(state);
		this.mobile = state.app ? state.app.mobileMode : false;
		this._collectionDescription = selectSnapshotCollectionDescription(state);
		this._filterDescriptions = selectFilterDescriptions(state);
		this._composerCandidates = selectCollectionComposerCandidates(state);
		this._userIDs = selectAuthorAndCollaboratorUserIDs(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._cardsSelected = selectCardsSelected(state);
		this._userScope = selectUid(state);
		this._activeCardID = selectActiveCardID(state);
		this._activeCard = selectActiveCard(state);
		this.title = collectionComposerEnabled() ? 'Compose a collection' : 'Configure Collection';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-dialog': ConfigureCollectionDialog;
	}
}
