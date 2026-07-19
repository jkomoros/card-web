import { html, css, PropertyValues } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectConfigureCollectionDialogOpen,
	selectConfigureCollectionDialogMode,
	selectFilterDescriptions,
	selectCollectionComposerCandidates,
	selectAuthorAndCollaboratorUserIDs,
	selectAuthorsForTagList,
	selectTagInfosForCards,
	selectSnapshotCollectionDescription,
	selectActiveCollectionDescription,
	selectCardsSelected,
	selectUid,
	selectActiveCardID,
	selectRequestedCard,
	selectActiveCard,
} from '../selectors.js';

import {
	askForPathToNavigateTo,
	cancelConfigureCollectionDialog,
	closeConfigureCollectionDialog,
	openConfigureCollectionDialog,
	navigatePathToResult,
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
	collectionDescriptionWithViewMode,
	collectionDescriptionWithFilterRemoved,
	collectionDescriptionWithFilterModified,
	collectionDescriptionWithFilterAppended,
	CollectionDescription
} from '../collection_description.js';

import {
	SET_INFOS,
	SORTS,
	ALL_FILTER_NAME,
	CONFIGURABLE_FILTER_INFO,
	LEGAL_VIEW_MODES,
} from '../filters.js';

import {
	LINK_ICON,
	PLUS_ICON
} from '../../shared/icons.js';

import './configure-collection-filter.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	SetName,
	SortName,
	ViewMode,
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
	readRememberedCollections,
} from '../collection-composer-history.js';

import {
	currentBrowserLocation,
} from '../collection-composer-receipt.js';

import {
	parseCollectionSource,
	ParsedCollectionSource,
} from '../collection-source.js';

import {
	buildCollectionFilterCatalog,
	collectionFilterCatalogCategories,
	CollectionFilterCatalogItem,
} from '../collection-filter-catalog.js';

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
		_userInfos: TagInfos;

	@state()
		_cardTagInfos: TagInfos;

	@state()
		_composerInput = '';

	@state()
		_entryMode : 'compose' | 'source' = 'compose';

	@state()
		_sourceInput = '';

	@state()
		_sourceCompletionIndex = 0;

	@state()
		_sourceCompletionsDismissed = false;

	@state()
		_sourceReturnWarning = false;

	@state()
		_sourceCopyMessage = '';

	_sourceDirty = false;
	_sourceAutoDelimitedSegment = false;
	_draftSelectedCard = '';
	_requestedCard = '';
	_lastValidSource : ParsedCollectionSource | null = null;

	@state()
		_highlightedSuggestion = 0;

	@state()
		_builderExpanded = false;

	@state()
		_catalogOpen = false;

	@state()
		_catalogHighlightedIndex = 0;

	@state()
		_pendingCatalogFilter = '';

	@state()
		_pendingCatalogChanged = false;

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
	_draftUndoSelectedCard : string | null = null;
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

			.catalog-setup,
			.pending-filter-editor,
			.clause-editor {
				background: var(--app-primary-color-light-very-transparent);
				border: 1px solid var(--app-divider-color);
				border-radius: 2px;
				margin: 0.5em 0;
				padding: 0.65em;
			}

			.catalog-setup {
				display: flex;
				flex-wrap: wrap;
				gap: 0.65em 1em;
			}

			.catalog-setup label {
				display: flex;
				flex-direction: column;
				font-size: 0.78em;
				gap: 0.25em;
			}

			.catalog-list {
				max-height: min(36vh, 22em);
				overflow-y: auto;
			}

			.catalog-item-applied {
				color: var(--app-primary-color);
				font-size: 0.75em;
			}

			.catalog-example {
				color: var(--app-secondary-color);
				font-size: 0.78em;
				margin-top: 0.15em;
			}

			.pending-filter-actions {
				display: flex;
				gap: 0.5em;
				justify-content: flex-end;
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

			.source-editor label,
			.source-interpretation-label {
				display: block;
				font-size: 0.78em;
				font-weight: 500;
				margin: 0.8em 0 0.35em;
				text-transform: uppercase;
			}

			.source-input {
				box-sizing: border-box;
				font-family: monospace;
				line-height: 1.45;
				min-height: 5.5em;
				overflow-wrap: anywhere;
				padding: 0.65em;
				resize: vertical;
				white-space: pre-wrap;
				width: 100%;
			}

			.source-status {
				border-left: 3px solid var(--app-divider-color);
				font-size: 0.85em;
				margin-top: 0.6em;
				padding: 0.35em 0.6em;
			}

			.source-status[data-valid] {
				border-left-color: var(--app-primary-color);
			}

			.source-link {
				font-family: monospace;
				overflow-wrap: anywhere;
			}

			.source-suggestion-heading {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
				margin: 0.65em 0 0.25em;
			}

			.source-suggestion-category {
				color: var(--app-dark-text-color-light);
				font-size: 0.68em;
				letter-spacing: 0.04em;
				text-transform: uppercase;
			}

			.source-steps {
				display: flex;
				flex-wrap: wrap;
				gap: 0.35em;
				margin: 0.25em 0;
			}

			.source-step {
				background: var(--app-primary-color-light-very-transparent);
				border: 1px solid var(--app-divider-color);
				border-radius: 2px;
				padding: 0.3em 0.5em;
			}

			.mode-actions {
				align-items: center;
				border-top: 1px solid var(--app-divider-color);
				display: flex;
				justify-content: space-between;
				margin-top: 0.75em;
				padding-top: 0.5em;
			}

			.mode-actions button.small {
				color: var(--app-primary-color);
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
		if (collectionComposerEnabled()) return this._entryMode === 'source' ? this._sourceRender() : this._composerRender();
		return this._builderRender();
	}

	get _parsedSource() : ParsedCollectionSource {
		const candidates = this._contextualComposerCandidates;
		return parseCollectionSource(this._sourceInput, {
			ordinaryFilters: new Set(Object.keys(this._filterDescriptions || {})),
			filterDescriptions: this._filterDescriptions,
			suggestedFilters: candidates.map(candidate => candidate.filter),
			filterSearchValues: Object.fromEntries(candidates.map(candidate => [candidate.filter, [candidate.label, candidate.category, ...(candidate.aliases || [])]])),
			preservedSelectedCard: this._draftSelectedCard,
			allowedOrigins: new Set([window.location.origin, 'https://thecompendium.cards']),
		});
	}

	_sourceRender() {
		const parsed = this._parsedSource;
		const shown = parsed.status === 'valid' ? parsed : this._lastValidSource;
		const description = shown?.description || this._collectionDescription;
		const count = this._previewCounts[this._draftPreviewID];
		const statusLabel = parsed.status === 'valid' ? 'Ready to open' :
			parsed.status === 'incomplete' ? 'Keep typing' :
			parsed.status === 'unsupported' ? 'Not supported here' : 'Can’t understand this source';
		const diagnostic = parsed.diagnostics[0]?.message || 'This source is complete and safe to open.';
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completionMode = completionDiagnostic ? 'complete' : 'add';
		const completionDetails = completionDiagnostic?.expectedDetails || parsed.nextExpectedDetails || {};
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		const expressionParts = collectionExpressionParts(description, this._composerFilterLabels);
		const fullDestination = parsed.canonicalPath ? new URL(parsed.canonicalPath, window.location.origin).toString() : '';
		return html`
			<div class='source-editor'>
				<label for='collection-source-input'>Collection source</label>
				<textarea
					id='collection-source-input'
					class='source-input'
					rows='3'
					spellcheck='false'
					role='combobox'
					aria-autocomplete='list'
					aria-controls='collection-source-completions'
					aria-expanded=${completions.length > 0}
					aria-activedescendant=${ifDefined(completions.length ? `collection-source-completion-${this._sourceCompletionIndex}` : undefined)}
					aria-describedby='collection-source-status collection-source-destination'
					aria-invalid=${parsed.status !== 'valid'}
					placeholder='everything/starred/updated/after/3-days-ago/'
					.value=${this._sourceInput}
					@input=${this._handleSourceInput}
					@keydown=${this._handleSourceKeyDown}
				></textarea>
				<div id='collection-source-status' class='source-status' role='status' ?data-valid=${parsed.status === 'valid'}>
					<strong>${statusLabel}</strong> — ${diagnostic}
				</div>
			</div>
			${completions.length ? html`
				<div class='source-suggestion-heading'>${completionMode === 'add' ? 'Add another filter or modifier — type to search all filters' : 'Choose the next value'}</div>
				<div id='collection-source-completions' class='suggestions' role='listbox' aria-label='Legal next source values'>
					${completions.map((completion, index) => {
						const presentation = this._sourceCompletionPresentation(completion, completionDetails[completion]);
						return html`
						<div class='suggestion'>
							<button id=${`collection-source-completion-${index}`} role='option' tabindex='-1' aria-selected=${index === this._sourceCompletionIndex} ?data-highlighted=${index === this._sourceCompletionIndex} @click=${() => this._acceptSourceCompletion(completion)}>
								<div class='source-suggestion-category'>${presentation.category}</div>
								<div>${presentation.label}<span class='suggestion-action'>${completionMode}</span></div>
								<div class='suggestion-detail'>${presentation.detail} · <code>${completion}</code></div>
							</button>
						</div>
					`})}
				</div>
			` : ''}
			<span class='source-interpretation-label'>${parsed.status === 'valid' ? 'This means' : 'Last valid collection'}</span>
			<div class='source-steps' aria-label=${readableCollectionExpression(description, this._composerFilterLabels)}>
				<span class='source-step'>Start with ${expressionParts.set.label}</span>
				${expressionParts.filters.map(filter => html`<span class='source-step'>Then ${filter.label}</span>`)}
				${expressionParts.modifiers.map(modifier => html`<span class='source-step'>Finally ${modifier}</span>`)}
			</div>
			${count === undefined ? '' : html`<div>${formatCollectionCardCount(count)}</div>`}
			${shown?.selectedCardRaw ? html`
				<span class='source-interpretation-label'>Opens on</span>
				<div>${shown.selectedCardRaw === '_' ? 'The first card in the collection' : shown.selectedCardRaw}</div>
			` : ''}
			<span class='source-interpretation-label'>${parsed.canonicalPath === this._sourceInput ? 'Link' : 'Will open as'}</span>
			<div id='collection-source-destination' class='source-link'>${fullDestination || 'Open is unavailable until the current source is valid.'}</div>
			${parsed.notices.map(notice => html`<div class='key-hints'>${notice} ${parsed.query}${parsed.hash}</div>`)}
			${fullDestination ? html`<button class='small' @click=${this._handleCopySourceLink} aria-label='Copy collection link'>Copy link</button>` : ''}
			${this._sourceCopyMessage ? html`<span class='draft-receipt' role='status'>${this._sourceCopyMessage}</span>` : ''}
			${this._sourceReturnWarning ? html`
				<div id='collection-source-return-warning' class='source-status' role='alert' tabindex='-1'>
					These source edits do not form an openable collection.
					<div><button class='small' @click=${() => this._sourceReturnWarning = false}>Keep editing</button><button class='small' @click=${this._returnToLastValidSource}>Return to last valid collection</button></div>
				</div>
			` : ''}
			<div class='mode-actions'>
				<button class='small' @click=${this._handleBackToCompose}>Edit visually</button>
				<span class='key-hints'>${completions.length ? (completionMode === 'add' ? '↑↓ Choose · Tab adds · Enter opens · Esc dismisses suggestions' : '↑↓ Choose · Tab or Enter completes · Esc dismisses suggestions') : (parsed.status === 'valid' ? 'Enter opens · Esc cancels' : 'Keep editing · Esc cancels')}</span>
			</div>
			<div class='composer-actions'>
				<button class='primary' ?disabled=${parsed.status !== 'valid' || this._activationPending} @click=${this._handleOpenSource}>
					${count === undefined ? 'Open this collection' : `Open ${formatCollectionCardCount(count)}`}
				</button>
			</div>
			${this._activationMessage ? html`<div class='activation-message' role='alert'>${this._activationMessage}</div>` : ''}
		`;
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
						.userInfos=${this._userInfos}
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

	_selectedClauseEditorRender() {
		const index = this._selectedClauseIndex;
		const filterName = this._collectionDescription.filters[index];
		if (index < 0 || !filterName) return '';
		return html`
			<div class='clause-editor'>
				<div>
					<strong>Editing ${this._readableComposerFilter(filterName)}</strong>
					<div class='suggestion-detail'>Changes update the draft immediately. You can undo them before opening.</div>
				</div>
				<configure-collection-filter
					.value=${filterName}
					.index=${index}
					.lockFilterFamily=${true}
					.filterDescriptions=${this._filterDescriptions}
					.cardTagInfos=${this._cardTagInfos}
					.userIDs=${this._userIDs}
					.userInfos=${this._userInfos}
					@filter-modified=${this._handleFilterModified}
					@filter-removed=${this._handleFilterRemoved}>
				</configure-collection-filter>
				<button class='small done-editing' @click=${this._handleBuilderToggle}>Done editing</button>
			</div>
		`;
	}

	get _catalogItems() : CollectionFilterCatalogItem[] {
		return buildCollectionFilterCatalog(
			this._filterDescriptions || {},
			this._contextualComposerCandidates,
			this._collectionDescription?.filters || [],
			this._composerInput
		);
	}

	get _visibleCatalogItems() : CollectionFilterCatalogItem[] {
		const items = this._catalogItems;
		if (this._composerInput.trim()) return items;
		return collectionFilterCatalogCategories.flatMap(category => items.filter(item => item.category === category).slice(0, 6));
	}

	_catalogRender() {
		const items = this._visibleCatalogItems;
		return html`
			<div class='catalog-setup' aria-label='Collection setup'>
				<label>Start from
					<select aria-label='Starting collection set' @change=${this._handleSetSelectChanged} .value=${this._collectionDescription.set}>
						${Object.entries(SET_INFOS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
					</select>
				</label>
				<label>Order by
					<select aria-label='Card order' @change=${this._handleSortSelectChanged} .value=${this._collectionDescription.sort}>
						${Object.entries(SORTS).map(entry => html`<option value=${entry[0]} title=${entry[1].description}>${entry[0]}</option>`)}
					</select>
				</label>
				<label>Direction
					<select aria-label='Sort direction' @change=${this._handleCatalogDirectionChanged} .value=${this._collectionDescription.sortReversed ? 'reverse' : 'normal'}>
						<option value='normal'>Normal</option>
						<option value='reverse'>Reverse</option>
					</select>
				</label>
				<label>Display as
					<select aria-label='Collection view' @change=${this._handleViewModeChanged} .value=${this._collectionDescription.viewMode}>
						${Object.keys(LEGAL_VIEW_MODES).map(mode => html`<option value=${mode}>${mode}</option>`)}
					</select>
				</label>
				${LEGAL_VIEW_MODES[this._collectionDescription.viewMode] ? html`
					<label>Web focus card
						<configure-collection-key-card
							.value=${this._collectionDescription.viewModeExtra || '_'}
							.cardTagInfos=${this._cardTagInfos}
							.allowIncludeKeyCard=${false}
							@filter-modified-complex=${this._handleViewCardChanged}>
						</configure-collection-key-card>
					</label>
				` : ''}
			</div>
			${this._pendingCatalogFilter ? this._pendingCatalogFilterRender() : ''}
			<div id='collection-filter-catalog' class='catalog-list' role='listbox' aria-label='Filter catalog'>
				${collectionFilterCatalogCategories.map(category => {
					const categoryItems = items.filter(item => item.category === category);
					const shown = categoryItems;
					if (!shown.length) return '';
					return html`
						<div role='group' aria-label=${category}>
							<div class='suggestion-heading'>${category}</div>
							${shown.map(item => {
								const index = items.indexOf(item);
								return html`
									<div class='suggestion'>
										<button
											id=${`collection-filter-catalog-item-${index}`}
											role='option'
											data-filter=${item.filter}
											aria-selected=${index === this._catalogHighlightedIndex}
											?data-highlighted=${index === this._catalogHighlightedIndex}
											@click=${() => this._handleCatalogItem(item)}
										>
											<div>${item.label}<span class='suggestion-action'>${item.appliedIndex >= 0 ? 'edit' : item.configurable && !item.filter.includes('/') ? 'configure' : 'add'}</span></div>
											<div class='suggestion-detail'>${item.detail}</div>
											<div class='catalog-example'>Example: ${item.example}</div>
											${item.appliedIndex >= 0 ? html`<div class='catalog-item-applied'>Already in this collection</div>` : ''}
										</button>
									</div>
								`;
							})}
						</div>
					`;
				})}
			</div>
			${!items.length ? html`<div class='no-suggestions'>No filters match yet. Try a broader word such as date, tag, author, relationship, or text.</div>` : ''}
		`;
	}

	_pendingCatalogFilterRender() {
		const family = this._pendingCatalogFilter.split('/')[0];
		return html`
			<div class='pending-filter-editor' role='group' aria-label=${`Configure ${this._readableComposerFilter(family)}`}>
				<div><strong>Configure ${this._readableComposerFilter(family)}</strong></div>
				<div class='suggestion-detail'>Choose the values below before this filter is added. The collection will not change until you confirm.</div>
				<configure-collection-filter
					.value=${this._pendingCatalogFilter}
					.index=${-1}
					.lockFilterFamily=${true}
					.allowRemove=${false}
					.filterDescriptions=${this._filterDescriptions}
					.cardTagInfos=${this._cardTagInfos}
					.userIDs=${this._userIDs}
					.userInfos=${this._userInfos}
					@filter-modified=${this._handlePendingCatalogFilterModified}
					@filter-removed=${this._cancelPendingCatalogFilter}>
				</configure-collection-filter>
				<div class='pending-filter-actions'>
					<button class='small' @click=${this._cancelPendingCatalogFilter}>Cancel</button>
					<button class='primary' ?disabled=${!this._pendingCatalogChanged} @click=${this._commitPendingCatalogFilter}>Add configured filter</button>
				</div>
			</div>
		`;
	}

	_composerRender() {
		if (!this._collectionDescription) return html``;
		const suggestions = this._catalogOpen ? [] : this._composerSuggestions;
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
					aria-controls=${this._catalogOpen ? 'collection-filter-catalog' : 'collection-composer-suggestions'}
					aria-expanded=${this._catalogOpen ? this._visibleCatalogItems.length > 0 : suggestions.length > 0}
					aria-activedescendant=${ifDefined(this._catalogOpen ?
						(this._visibleCatalogItems[this._catalogHighlightedIndex] ? `collection-filter-catalog-item-${this._catalogHighlightedIndex}` : undefined) :
						(suggestions[this._highlightedSuggestion] ? `collection-suggestion-${this._highlightedSuggestion}` : undefined))}
					aria-busy=${this._activationPending}
					placeholder=${this._catalogOpen ? 'Search dates, tags, authors, relationships…' : 'Type another condition…'}
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
			${this._catalogOpen ? '' : suggestions.length ? html`
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
			<div class='key-hints'>${this._catalogOpen ? 'Type to search · ↑↓ choose · Enter configures or adds · Esc closes catalog' : this._selectedClauseIndex >= 0 ?
				'←→ choose clause · Delete removes · type to continue' : highlighted?.action === 'open' ?
				'↑↓ choose · Click or Enter opens' :
				this._composerInput.trim() ? '↑↓ choose · Click or Tab adds · Enter adds and opens' : '↑↓ choose · Click edits · Enter adds and opens'}</div>
			<div class='builder-toggle mode-actions'>
				<button class='small' @click=${this._handleCatalogToggle}>${this._catalogOpen ? 'Hide filter catalog' : 'Browse all filters'}</button>
				<button class='small' @click=${this._handleEditSource}>Edit source</button>
			</div>
			${this._catalogOpen ? html`<div class='builder'>${this._catalogRender()}</div>` : ''}
			${this._builderExpanded ? html`<div class='builder'>${this._selectedClauseEditorRender()}</div>` : ''}
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
		const recentCollections = readRememberedCollections(this._userScope).map(entry => ({
			description: CollectionDescription.deserialize(entry.authoring),
			visits: entry.visits,
			frequent: entry.frequent,
			relative: entry.relative,
		}));
		return collectionComposerSuggestions(
			this._collectionDescription,
			this._composerInput,
			this._filterDescriptions || {},
			{
				cardsSelected: this._cardsSelected,
				recentCollections,
				preservedSelectedCard: this._draftSelectedCard,
				sourceAllowedOrigins: new Set([window.location.origin, 'https://thecompendium.cards']),
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

	_sourceCompletionPresentation(token : string, grammarDetail = '') : {label: string, detail: string, category: string} {
		const candidate = this._contextualComposerCandidates.find(item => item.filter === token);
		if (candidate) return {label: candidate.label, detail: candidate.detail, category: candidate.category};
		if (token === 'sort') return {label: 'Choose an order', detail: grammarDetail || 'Control the order cards appear in', category: 'ordering'};
		if (token === 'view') return {label: 'Choose a view', detail: grammarDetail || 'Control how cards are displayed', category: 'display'};
		if (['main', 'everything', 'reading-list'].includes(token)) return {label: readableCollectionFilter(token), detail: grammarDetail, category: 'starting set'};
		if (['before', 'after', 'between', 'today', 'yesterday'].includes(token) || /-ago$/.test(token)) {
			return {label: readableCollectionFilter(token), detail: grammarDetail || 'A date boundary', category: 'date'};
		}
		return {label: readableCollectionFilter(token), detail: grammarDetail || 'A legal collection filter', category: 'filter'};
	}

	constructor() {
		super();
		this.title = collectionComposerEnabled() ? 'Compose a collection' : 'Configure Collection';
	}

	_handleSourceInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLTextAreaElement)) throw new Error('not textarea element');
		const previous = this._sourceInput;
		const startsNewFilter = !this._sourceAutoDelimitedSegment && previous.endsWith('/') &&
			input.value.startsWith(previous) && input.value.length > previous.length && Boolean(this._parsedSource.nextExpected?.length);
		let nextValue = input.value;
		const nextCaret = input.selectionStart;
		if (startsNewFilter) {
			nextValue += '/';
			this._sourceAutoDelimitedSegment = true;
		} else if (this._sourceAutoDelimitedSegment) {
			const extendsAutoDelimitedValue = input.value.startsWith(previous.slice(0, -1));
			if (extendsAutoDelimitedValue && !input.value.endsWith('/')) nextValue += '/';
			const caretBeforeDelimiter = nextValue.endsWith('/') && nextCaret === nextValue.length - 1;
			this._sourceAutoDelimitedSegment = caretBeforeDelimiter && nextValue !== previous.slice(0, previous.lastIndexOf('/') + 1);
		}
		this._sourceInput = nextValue;
		this._sourceDirty = true;
		this._activationMessage = '';
		this._sourceReturnWarning = false;
		this._sourceCompletionsDismissed = false;
		this._sourceCompletionIndex = 0;
		this._sourceCopyMessage = '';
		const parsed = this._parsedSource;
		if (parsed.status === 'valid') this._lastValidSource = parsed;
		if (startsNewFilter || this._sourceAutoDelimitedSegment) this.updateComplete.then(() => {
			const sourceInput = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
			sourceInput?.setSelectionRange(nextCaret, nextCaret);
		});
	}

	_handleSourceKeyDown(e : KeyboardEvent) {
		if (e.isComposing || e.keyCode === 229) return;
		const parsed = this._parsedSource;
		const completionDiagnostic = parsed.diagnostics.find(item => item.expected?.length);
		const completions = this._sourceCompletionsDismissed ? [] : (completionDiagnostic?.expected || parsed.nextExpected || []);
		if (completions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			this._sourceCompletionIndex = (this._sourceCompletionIndex + direction + completions.length) % completions.length;
			return;
		}
		if (completions.length && (e.key === 'Tab' || (e.key === 'Enter' && completionDiagnostic))) {
			e.preventDefault();
			this._acceptSourceCompletion(completions[this._sourceCompletionIndex]);
			return;
		}
		if (completions.length && e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			this._sourceCompletionsDismissed = true;
			return;
		}
		if (e.key !== 'Enter') return;
		e.preventDefault();
		if (parsed.status === 'valid') this._handleOpenSource();
	}

	_acceptSourceCompletion(completion : string) {
		const parsedBefore = this._parsedSource;
		const addingToValidSource = parsedBefore.status === 'valid' &&
			!parsedBefore.diagnostics.some(item => item.expected?.length) && Boolean(parsedBefore.nextExpected?.includes(completion));
		const input = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
		let nextCaret : number;
		if (addingToValidSource) {
			this._sourceInput = `${this._sourceInput}${completion}/`;
			nextCaret = this._sourceInput.length;
		} else {
			const selectionStart = input?.selectionStart ?? this._sourceInput.length;
			const selectionEnd = input?.selectionEnd ?? selectionStart;
			const segmentStart = this._sourceInput.lastIndexOf('/', Math.max(0, selectionStart - 1)) + 1;
			const followingSlash = this._sourceInput.indexOf('/', selectionEnd);
			const segmentEnd = followingSlash < 0 ? this._sourceInput.length : followingSlash;
			const prefix = this._sourceInput.slice(0, segmentStart);
			const suffix = this._sourceInput.slice(segmentEnd);
			const needsSlash = !suffix.startsWith('/');
			this._sourceInput = `${prefix}${completion}${needsSlash ? '/' : ''}${suffix}`;
			nextCaret = prefix.length + completion.length + (needsSlash || suffix.startsWith('/') ? 1 : 0);
		}
		this._sourceDirty = true;
		this._sourceAutoDelimitedSegment = false;
		this._sourceCompletionsDismissed = false;
		this._sourceCompletionIndex = 0;
		const parsed = this._parsedSource;
		if (parsed.status === 'valid') this._lastValidSource = parsed;
		this.updateComplete.then(() => {
			const sourceInput = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
			sourceInput?.focus();
			sourceInput?.setSelectionRange(nextCaret, nextCaret);
		});
	}

	_handleEditSource() {
		if (!this._sourceDirty) this._sourceInput = `/c/${this._collectionDescription.serializeShortOriginalOrder()}${this._draftSelectedCard}`;
		store.dispatch(openConfigureCollectionDialog('source'));
	}

	_handleBackToCompose() {
		const parsed = this._parsedSource;
		if (parsed.status === 'valid' && parsed.description) {
			this._commitDraftEdit(parsed.description, 'Applied source to the visual draft', false, parsed.selectedCardRaw);
			this._sourceDirty = false;
		} else {
			this._sourceReturnWarning = true;
			this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLElement>('#collection-source-return-warning')?.focus());
			return;
		}
		store.dispatch(openConfigureCollectionDialog('compose'));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_returnToLastValidSource() {
		if (this._lastValidSource?.description) {
			this._commitDraftEdit(this._lastValidSource.description, 'Returned to the last valid source', false, this._lastValidSource.selectedCardRaw);
			this._sourceInput = this._lastValidSource.canonicalPath || this._sourceInput;
			this._sourceDirty = false;
		}
		this._sourceReturnWarning = false;
		store.dispatch(openConfigureCollectionDialog('compose'));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	async _handleCopySourceLink() {
		const path = this._parsedSource.canonicalPath;
		if (!path) return;
		try {
			await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
			this._sourceCopyMessage = 'Collection link copied';
		} catch {
			this._sourceCopyMessage = 'Could not copy the collection link';
		}
	}

	_handleOpenSource() {
		const parsed = this._parsedSource;
		if (parsed.status !== 'valid' || !parsed.description || !parsed.canonicalPath || this._activationPending) return;
		this._activationPending = true;
		this._activationMessage = '';
		const result = store.dispatch(navigatePathToResult(parsed.canonicalPath));
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
		const count = this._previewCounts[this._draftPreviewID];
		store.dispatch(showSnackbar(
			`Now showing ${readableCollectionExpression(parsed.description, this._composerFilterLabels)}${count === undefined ? '' : ` · ${formatCollectionCardCount(count)}`}`,
			'back',
			currentBrowserLocation()
		));
	}

	_handleComposerInput(e : InputEvent) {
		const input = e.composedPath()[0];
		if (!(input instanceof HTMLInputElement)) throw new Error('not input element');
		this._composerInput = input.value;
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		this._highlightedSuggestion = 0;
		this._catalogHighlightedIndex = 0;
		this._activationMessage = '';
	}

	_handleComposerKeyDown(e : KeyboardEvent) {
		if (this._activationPending) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		if (e.isComposing || e.keyCode === 229) return;
		if (this._catalogOpen) {
			const items = this._visibleCatalogItems;
			if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
				e.preventDefault();
				e.stopPropagation();
				const direction = e.key === 'ArrowDown' ? 1 : -1;
				this._catalogHighlightedIndex = (this._catalogHighlightedIndex + direction + items.length) % items.length;
				return;
			}
			if (e.key === 'Enter' && items[this._catalogHighlightedIndex]) {
				e.preventDefault();
				e.stopPropagation();
				this._handleCatalogItem(items[this._catalogHighlightedIndex]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this._handleCatalogToggle();
				return;
			}
		}
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
			const alreadyActive = !suggestion.destinationPath && selectActiveCollectionDescription(store.getState() as State).serialize() === suggestion.description.serialize();
			if (alreadyActive) {
				store.dispatch(cancelConfigureCollectionDialog());
				return;
			}
			this._activationPending = true;
			this._activationMessage = '';
			const result = store.dispatch(suggestion.destinationPath ? navigatePathToResult(suggestion.destinationPath) : navigateToCollectionWithResult(suggestion.description));
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

	_commitDraftEdit(description : CollectionDescription, message : string, focusInput = false, selectedCard = this._draftSelectedCard) {
		this._draftUndoDescription = this._collectionDescription;
		this._draftUndoSelectedCard = this._draftSelectedCard;
		this._draftSelectedCard = selectedCard;
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
		const selectedCard = this._draftUndoSelectedCard;
		this._draftUndoDescription = null;
		this._draftUndoSelectedCard = null;
		if (selectedCard !== null) this._draftSelectedCard = selectedCard;
		this._draftReceiptMessage = 'Restored previous draft';
		this._selectedClauseIndex = -1;
		this._clauseSelectionMessage = '';
		store.dispatch(updateCollectionConfigurationSnapshot(description));
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	async _handleClauseEdit(index : number) {
		this._catalogOpen = false;
		this._pendingCatalogFilter = '';
		this._selectedClauseIndex = index;
		this._clauseSelectionMessage = `Editing ${this._readableComposerFilter(this._collectionDescription.filters[index])}`;
		this._builderExpanded = true;
		await this.updateComplete;
		const control = this.shadowRoot?.querySelector<HTMLElement & {focusPrimaryControl?: () => boolean}>('.clause-editor configure-collection-filter');
		if (!control?.focusPrimaryControl?.()) this.shadowRoot?.querySelector<HTMLElement>('.clause-editor .done-editing')?.focus();
	}

	_handleBuilderToggle() {
		this._builderExpanded = !this._builderExpanded;
		if (!this._builderExpanded) {
			this._selectedClauseIndex = -1;
			this._clauseSelectionMessage = '';
			this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
		}
	}

	_handleCatalogToggle() {
		this._catalogOpen = !this._catalogOpen;
		this._catalogHighlightedIndex = 0;
		this._pendingCatalogFilter = '';
		this._pendingCatalogChanged = false;
		if (this._catalogOpen) {
			this._builderExpanded = false;
			this._selectedClauseIndex = -1;
			this._clauseSelectionMessage = '';
		}
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_defaultCatalogFilter(family : string) : string {
		if (['created', 'updated', 'last-tweeted'].includes(family)) return `${family}/after/7-days-ago`;
		const info = CONFIGURABLE_FILTER_INFO[family];
		return info ? `${family}/${info.arguments.map(argument => argument.default).join('/')}` : family;
	}

	_catalogDefaultIsReady(family : string) : boolean {
		return ['created', 'updated', 'last-tweeted', 'author', 'limit', 'offset'].includes(family);
	}

	async _handleCatalogItem(item : CollectionFilterCatalogItem) {
		if (item.appliedIndex >= 0) {
			this._catalogOpen = false;
			await this._handleClauseEdit(item.appliedIndex);
			return;
		}
		const family = item.filter.split('/')[0];
		if (item.configurable && item.filter === family) {
			this._pendingCatalogFilter = this._defaultCatalogFilter(family);
			this._pendingCatalogChanged = this._catalogDefaultIsReady(family);
			await this.updateComplete;
			this.shadowRoot?.querySelector<HTMLElement & {focusPrimaryControl?: () => void}>('.pending-filter-editor configure-collection-filter')?.focusPrimaryControl?.();
			return;
		}
		this._commitDraftEdit(collectionDescriptionWithFilterAppended(this._collectionDescription, item.filter), `Added ${item.label}`);
		this._composerInput = '';
		this._catalogHighlightedIndex = 0;
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_handlePendingCatalogFilterModified(e : FilterModifiedEvent) {
		this._pendingCatalogFilter = e.detail.value;
		this._pendingCatalogChanged = true;
	}

	_cancelPendingCatalogFilter() {
		this._pendingCatalogFilter = '';
		this._pendingCatalogChanged = false;
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_commitPendingCatalogFilter() {
		if (!this._pendingCatalogFilter || !this._pendingCatalogChanged) return;
		const filter = this._pendingCatalogFilter;
		this._commitDraftEdit(collectionDescriptionWithFilterAppended(this._collectionDescription, filter), `Added ${this._readableComposerFilter(filter)}`);
		this._pendingCatalogFilter = '';
		this._pendingCatalogChanged = false;
		this._composerInput = '';
		this._catalogHighlightedIndex = 0;
		this.updateComplete.then(() => this.shadowRoot?.querySelector<HTMLInputElement>('#collection-composer-input')?.focus());
	}

	_handleCatalogDirectionChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		this._commitDraftEdit(collectionDescriptionWithSortReversed(this._collectionDescription, ele.value === 'reverse'), ele.value === 'reverse' ? 'Reversed sort' : 'Restored normal sort');
	}

	_handleViewModeChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const viewMode = ele.value as ViewMode;
		const extra = LEGAL_VIEW_MODES[viewMode] ? (this._collectionDescription.viewModeExtra || this._activeCardID || '_') : '';
		this._commitDraftEdit(collectionDescriptionWithViewMode(this._collectionDescription, viewMode, extra), `Changed view to ${ele.value}`);
	}

	_handleViewCardChanged(e : FilterModifiedEvent) {
		this._commitDraftEdit(collectionDescriptionWithViewMode(this._collectionDescription, this._collectionDescription.viewMode, e.detail.value), 'Changed web focus card');
	}

	_handleOpenCurrentDraft() {
		this._applyComposerSuggestion({
			id: 'current-draft',
			kind: 'source',
			action: 'open',
			label: 'Open this collection',
			detail: readableCollectionExpression(this._collectionDescription, this._composerFilterLabels),
			description: this._collectionDescription,
			destinationPath: `/c/${this._collectionDescription.serializeShortOriginalOrder()}${this._draftSelectedCard}`,
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
		if (this.open && this._catalogOpen && e.key === 'Escape' && !e.defaultPrevented) {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			if (this._pendingCatalogFilter) this._cancelPendingCatalogFilter();
			else this._handleCatalogToggle();
			return;
		}
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
				this._catalogOpen = false;
				this._catalogHighlightedIndex = 0;
				this._pendingCatalogFilter = '';
				this._pendingCatalogChanged = false;
				this._selectedClauseIndex = -1;
				this._draftReceiptMessage = '';
				this._clauseSelectionMessage = '';
				this._draftUndoDescription = null;
				this._draftUndoSelectedCard = null;
				this._sourceDirty = false;
				this._sourceAutoDelimitedSegment = false;
				this._draftSelectedCard = this._requestedCard;
				this._sourceInput = this._entryMode === 'source' ? window.location.pathname : '';
				const parsed = this._entryMode === 'source' ? this._parsedSource : null;
				if (parsed?.status === 'valid') this._draftSelectedCard = parsed.selectedCardRaw;
				this._lastValidSource = parsed?.status === 'valid' ? parsed : null;
			}
		}
		if (this.open && changedProps.has('_entryMode') && this._entryMode === 'source') {
			if (!this._sourceDirty && !this._sourceInput) this._sourceInput = `/c/${this._collectionDescription.serializeShortOriginalOrder()}${this._draftSelectedCard}`;
			this.updateComplete.then(() => {
				const input = this.shadowRoot?.querySelector<HTMLTextAreaElement>('#collection-source-input');
				if (!input) return;
				input.focus();
				if (changedProps.has('open')) input.select();
				else input.setSelectionRange(input.value.length, input.value.length);
			});
		}
		if (
			changedProps.has('open') ||
			changedProps.has('_composerInput') ||
			changedProps.has('_sourceInput') ||
			changedProps.has('_entryMode') ||
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
		const sourceDescription = this._entryMode === 'source' ? (this._parsedSource.description || this._lastValidSource?.description) : null;
		const previewDescription = sourceDescription || this._collectionDescription;
		const draftDescription = previewDescription?.serialize();
		const cachedDraftCount = draftDescription && this._draftPreviewCache?.description === draftDescription ? this._draftPreviewCache.count : undefined;
		this._previewCounts = cachedDraftCount === undefined ? {} : {[this._draftPreviewID]: cachedDraftCount};
		if (!this.open || !collectionComposerPreviewEnabled()) return;
		const previewSuggestions = this._entryMode === 'source' ? [] : [...this._composerSuggestions];
		if (cachedDraftCount === undefined) previewSuggestions.unshift({
			id: this._draftPreviewID,
			kind: 'source',
			action: 'open',
			label: 'Current draft',
			detail: '',
			description: previewDescription,
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
		this._userInfos = selectAuthorsForTagList(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._cardsSelected = selectCardsSelected(state);
		this._userScope = selectUid(state);
		this._activeCardID = selectActiveCardID(state);
		this._requestedCard = selectRequestedCard(state) || '';
		this._activeCard = selectActiveCard(state);
		this._entryMode = selectConfigureCollectionDialogMode(state);
		this.title = collectionComposerEnabled() ? 'Compose a collection' : 'Configure Collection';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-dialog': ConfigureCollectionDialog;
	}
}
