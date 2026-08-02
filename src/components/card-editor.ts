import {
	blockedReason,
	SAVE_VERB
} from '../sync-copy.js';

import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit/directives/repeat.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	corpusWorkerCanRunCollections,
	corpusWorkerSuggestTags
} from '../corpus-bridge.js';

import {
	corpusWorkerServesCollections
} from '../corpus-mode.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	addSlug,
	createTag,
	deleteCard,
} from '../actions/data.js';

import {
	selectTags,
	selectEditingUnderlyingCardSnapshot,
	selectEditingCard,
	selectEditingCardAutoTodos,
	selectAuthorsForTagList,
	selectUserIsAdmin,
	selectRawCards,
	selectUserMayEditSomeTags,
	tagsUserMayNotEdit,
	selectSectionsUserMayEdit,
	selectUserMayChangeEditingCardSection,
	selectPendingSlug,
	selectReasonsUserMayNotDeleteActiveCard,
	selectCardModificationPending,
	selectEditingCardSuggestedConceptReferences,
	selectEditingCardSuggestedTags,
	selectCardSavesEligible,
	selectCorpusStatus,
	selectEditingUnderlyingCardSnapshotDiffDescription,
	selectOvershadowedUnderlyingCardChangesDiffDescription,
	selectEditingCardHasUnsavedChanges,
	selectEditorMinimized,
	selectUserMayUseAI,
	selectIsEditing,
	selectFieldValidationErrorsForEditingCard
} from '../selectors.js';

import {
	editingFinish,
	editingCommit,
	textFieldUpdated,
	notesUpdated,
	sectionUpdated,
	nameUpdated,
	substantiveUpdated,
	publishedUpdated,
	fullBleedUpdated,
	autoTodoOverrideEnabled,
	autoTodoOverrideRemoved,
	tagAdded,
	tagRemoved,
	editingSelectTab,
	editingSelectEditorTab,
	todoUpdated,
	cardTypeUpdated,
	updateUnderlyingCard,
	mergeOvershadowedUnderlyingChanges,
	autoTodoOverrideDisabled,
	editorAdded,
	editorRemoved,
	collaboratorAdded,
	collaboratorRemoved,
	manualEditorAdded,
	manualCollaboratorAdded,
	selectCardToReference,
	removeReferenceFromCard,
	addReferenceToCard,
	setEditorMinimized
} from '../actions/editor.js';

import {
	SAVE_ICON,
	CANCEL_ICON,
	DELETE_FOREVER_ICON,
	PLUS_ICON,
	HIGHLIGHT_OFF_ICON,
	MERGE_TYPE_ICON,
	AUTO_AWESOME_ICON
} from '../../shared/icons.js';

import {
	killEvent, 
	cardHasContent, 
	cardHasNotes,
	cardHasTodo,
	cardMissingReciprocalLinks,
	toTitleCase,
	reasonCardTypeNotLegalForCard,
	createSlugFromArbitraryString
} from '../util.js';

import {
	findCardToLink
} from '../actions/find.js';

import { 
	TODO_AUTO_INFOS,
	TODO_ALL_INFOS,
} from '../filters.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	editableFieldsForCardType,
	REFERENCE_TYPES,
	CARD_TYPE_CONFIGURATION,
	LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE
} from '../../shared/card_fields.js';

import {
	references,
} from '../references.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import './tag-list.js';
import './card-images-editor.js';

import {
	Card,
	CardType,
	Sections,
	EditorTab,
	EditorContentTab,
	TagInfos,
	TagID,
	Slug,
	CardID,
	Cards,
	State,
	CorpusStatus,
	ReferenceType,
	CardFieldTypeEditable,
	editorContentTab,
	editorTab,
	referenceTypeSchema,
	TODOType,
	autoTODOType,
	cardFieldTypeEditableSchema,
	CardFieldType
} from '../types.js';

import {
	COLOR_LIGHT_FIRE_BRICK,
	COLORS
} from '../../shared/card_fields.js';

import {
	TagEvent
} from '../events.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	ARROW_UP_ICON,
	ARROW_RIGHT_ICON
} from '../../shared/icons.js';

import {
	titleForEditingCardWithAI
} from '../actions/ai.js';


type TagInfosByReferenceType = {[typ in ReferenceType]: TagInfos};

const cardReferenceIDs = (card : Card | null) : CardID[] => {
	if (!card) return [];
	return Object.values(references(card).byTypeArray()).flat();
};

const cardTagInfosForIDs = (cards : Cards, ids : Iterable<CardID>) : TagInfos => {
	const result : TagInfos = {};
	for (const id of ids) {
		const card = cards[id];
		if (!card) continue;
		result[id] = {
			id,
			title: card.name || id,
			previewCard: id
		};
	}
	return result;
};

//e.code is the PHYSICAL key position, so on AZERTY, Dvorak or any non-QWERTY
//layout the printed shortcut stops working and a DIFFERENT printed key silently
//triggers it — Cmd-M creating a card from whatever key sits where M is on
//QWERTY. e.key is what the user actually pressed.
const pressedLetter = (e : KeyboardEvent) : string => (e.key || '').toLowerCase();

@customElement('card-editor')
class CardEditor extends connect(store)(LitElement) {

	_suggestionsTimeout = 0;

	_suggestionsKey = '';

	@state()
		_card: Card | null;

	@state()
		_autoTodos: TODOType[];

	@state()
		_active: boolean;

	@state()
		_minimized: boolean;

	@state()
		_sectionsUserMayEdit: Sections;

	@state()
		_userMayChangeEditingCardSection: boolean;

	@state()
		_userMayUseAI: boolean;

	@state()
		_mayNotDeleteReason: string;

	@state()
		_substantive: boolean;

	@state()
		_selectedTab: EditorTab;

	@state()
		_selectedEditorTab: EditorContentTab;

	@state()
		_tagInfos: TagInfos;

	@state()
		_userMayEditSomeTags: boolean;

	@state()
		_tagsUserMayNotEdit: TagID[];

	@state()
		_cardTagInfos: TagInfos;

	//This isn't set until after cardInfos and card updated, so sometimes it
	//will render while it's empyt, so make sure we defend against that.
	@state()
		_cardTagInfosForReferenceTypes?: TagInfosByReferenceType;

	//The card before any edits
	@state()
		_underlyingCard: Card | null;

	@state()
		_suggestedTags: TagID[];

	//'pending' while the worker is computing, 'unavailable' when it could not
	//answer. Without this an empty list from a timed-out worker was
	//indistinguishable from a genuine "nothing to suggest". Needs its OWN
	//@state(): a decorator applies to one field, and this is driven from async
	//worker callbacks — it only re-rendered by coincidence, because every
	//transition also happened to assign _suggestedTags a fresh array.
	@state()
		_suggestedTagsState: 'pending' | 'ready' | 'unavailable';

	@state()
		_authors: TagInfos;

	@state()
		_isAdmin: boolean;

	@state()
		_pendingSlug: Slug;

	@state()
		_cardModificationPending: boolean;

	@state()
		_saveEligible: boolean;

	@state()
		_corpusStatus: CorpusStatus;

	@state()
		_offline: boolean;

	@state()
		_suggestedConcepts: CardID[];

	@state()
		_underlyingCardDifferences: string;

	@state()
		_overshadowedDifferences: string;

	@state()
		_hasUnsavedChanges: boolean;

	@state()
		_fieldValidationErrors: {[field in CardFieldType]+?: string};

	static override styles = [
		ButtonSharedStyles,
		HelpStyles,
		css`
			/* Hover target for a disabled control's explanation; see the
			   save-button markup. inline-flex keeps the button's layout
			   identical to when it was unwrapped, and the vertical-align
			   matches what ButtonSharedStyles puts on the button itself
			   (a default baseline-aligned wrapper would override it). */
			/* Distinguishes "still working" and "could not answer" from a genuine
		   empty result, which all rendered as the same blank space. */
		.suggestion-state {
			font-size: 0.75em;
			font-style: italic;
			color: var(--app-dark-text-color-light);
		}

		.suggestion-state[hidden] {
			display: none;
		}

		span.reason {
				display: inline-flex;
				vertical-align: middle;
			}

			:host {
				position:relative;
				background-color: white;
			}

			.container {
				width: 100%;
				height:100%;
				display:flex;
				flex-direction: column;
				/* The up-down padding comes from margins in the top and bottom elements */
				padding: 0 0.5em;
				box-sizing:border-box;
			}

			.container.not-minimized {
				position:absolute;
			}

			.inputs {
				display:flex;
				flex-direction:column;
				width:100%;
				flex-grow:1;
				overflow:scroll;
			}

			.minimized .inputs {
				display: none;
			}

			.buttons .checkboxes, .buttons .header, .buttons .tags {
				display: flex;
				flex-direction: row;
				align-items: center;
			}

			.buttons .header {
				color: var(--app-dark-text-color);
			}

			.buttons .header:hover {
				cursor: pointer;
				color: var(--app-dark-text-color-light);
			}

			.buttons .header:hover svg {
				fill: var(--app-dark-text-color-light);
			}

			.minimized .buttons .checkboxes {
				display: none;
			}

			input, textarea {
				border: 0 solid black;
				font-size:0.8em;
				border-bottom:1px solid var(--app-dark-text-color);
				width: 100%;
			}

			textarea {
			flex-grow:1;
			}

			label {
				/* TODO: consider changing this at the button-shared-styles layer instead */
				margin-top: 0.5em;
			}

			svg {
				height:1.3em;
				width:1.3em;
				fill: var(--app-dark-text-color-subtle);
			}

			.flex {
				flex-grow:1;
			}

			.body {
				display:flex;
				flex-direction:column;
			}

			.buttons {
				display:flex;
				flex-direction:row;
				width:100%;
			}

			.buttons h3 {
				font-size:1em;
				font-weight:normal;
				margin-right:0.5em;
			}

			.inputs .row {
				display:flex;
				flex-direction:row;
				align-items:center;
			}

			.inputs .row > div {
			flex-grow:1;
			}

			.tags.stack {
				display: flex;
				flex-direction: column;
			}

			.tags.stack > div {
				display: flex;
				flex-direction: row;
			}

			.tabs {
				display:flex;
				flex-direction:row;
			}

			.tabs label {
				cursor:pointer;
				padding-right:0.5em;
				border-bottom:1px solid transparent;
				font-weight:bold;
			}

			.tabs label.help {
				font-weight: normal;
				font-style: italic;
			}

			.tabs label[data-selected] {
				color: var(--app-primary-color);
				border-bottom-color: var(--app-primary-color);
			}

			.tabs label[data-empty] {
				font-weight:inherit;
			}

			.tabs label[data-modified] {
				font-style: italic;
			}

			.tabs.main {
				font-size:1.25em;
			}

			.tabs.main label {
				font-weight: inherit;
				border-top: 2px solid transparent;
				border-bottom: none;
				padding: 0.5em 2em;
			}

			.tabs.main label[data-selected] {
				color: var(--app-primary-color);
				border-top-color: var(--app-primary-color);
				font-weight: bold;
			}

			[hidden] {
				display:none;
			}

			.scrim {
				z-index:100;
				height:100%;
				width:100%;
				position:absolute;
				background-color:rgba(255,255,255,0.7);
				display:none;
			}

				.modification-pending .scrim {
					display:flex;
					align-items:center;
					justify-content:center;
					font-weight:bold;
					text-align:center;
					padding:1em;
					box-sizing:border-box;
			}

		`
	];

	override render() {

		const card = this._card;
		const underlyingCard = this._underlyingCard;

		if (!card) return html`No card`;
		if (!underlyingCard) return html`No underlying card`;

		const hasContent = cardHasContent(card);
		const hasNotes = cardHasNotes(card);
		const hasTodo = cardHasTodo(card);
		const contentModified = card.body != underlyingCard.body;
		const notesModified = card.notes != underlyingCard.notes;
		const todoModified = card.todo != underlyingCard.todo;

		const todoOverridesEnabled = Object.entries(card.auto_todo_overrides).filter(entry => entry[1] == false).map(entry => entry[0]);
		const todoOverridesPreviouslyEnabled = Object.entries(underlyingCard.auto_todo_overrides).filter(entry => entry[1] == false).map(entry => entry[0]);
		const todoOverridesDisabled = Object.entries(card.auto_todo_overrides).filter(entry => entry[1] == true).map(entry => entry[0]);
		const todoOverridesPreviouslyDisabled = Object.entries(underlyingCard.auto_todo_overrides).filter(entry => entry[1] == true).map(entry => entry[0]);

		
		const enableTODOColor = COLORS.FIRE_BRICK;
		//When you're disabling a TODO, you're marking it done, so it should be green.
		const disableTODOColor = COLORS.DARK_GREEN;
		const autoTODOColor = COLOR_LIGHT_FIRE_BRICK;

		const referencesMap = references(this._card).byTypeArray();
		const previousReferencesMap = references(this._underlyingCard).byTypeArray();

		return html`
      <div class='container ${this._cardModificationPending ? 'modification-pending' : ''} ${this._minimized ? 'minimized' : 'not-minimized'}'>
			<div class='scrim' role='status' aria-live='polite' aria-busy=${this._cardModificationPending}>
				${this._offline ? 'Waiting for a connection to save. Keep this tab open; your draft is still here.' : 'Saving card…'}
			</div>
        <div class='inputs'>
		  ${this._selectedTab == 'content' ? html`<div class='flex body'>
			<div class='tabs' @click=${this._handleEditorTabClicked} @keydown=${this._handleEditorTabKeyDown}>
				<label role='tab' tabindex='0' aria-selected=${this._selectedEditorTab == 'content'} data-testid='editor-tab-content' data-name='${editorContentTab('content')}' ?data-selected=${this._selectedEditorTab == 'content'} ?data-empty=${!hasContent} ?data-modified=${contentModified}>Content</label>
				<label role='tab' tabindex='0' aria-selected=${this._selectedEditorTab == 'notes'} data-name='${editorContentTab('notes')}' ?data-selected=${this._selectedEditorTab == 'notes'} ?data-empty=${!hasNotes} ?data-modified=${notesModified}>Notes</label>
				<label role='tab' tabindex='0' aria-selected=${this._selectedEditorTab == 'todo'} data-name='${editorContentTab('todo')}' ?data-selected=${this._selectedEditorTab == 'todo'} ?data-empty=${!hasTodo} ?data-modified=${todoModified}>Freeform TODO</label>
				<span class='flex'></span>
				<label class='help' ?hidden=${this._selectedEditorTab !== 'content'}>Content is what shows up on the main body of the card</label>
				<label class='help' ?hidden=${this._selectedEditorTab !== 'notes'}>Notes are visible in the info panel to all readers and are for permanent asides</label>
				<label class='help' ?hidden=${this._selectedEditorTab !== 'todo'}>Freeform TODOs are only visible to editors and mark a temporary thing to do so it shows up in the has-freeform-todo filter</label>

			</div>
			<div ?hidden=${this._selectedEditorTab !== 'content'} class='body flex'>
				${TypedObject.entries(editableFieldsForCardType(card.card_type)).map(entry => html`
					<label>
						${toTitleCase(entry[0].split('_').join(' '))}
						${entry[1].description ? help(entry[1].description) : ''}
						${this._fieldValidationErrors[entry[0]] ? help(this._fieldValidationErrors[entry[0]] || '', true, true) : ''}
					</label>
					${entry[1].html
		? html`<textarea 
									@input='${this._handleTextFieldUpdated}'
									data-field=${entry[0]}
									.value=${card[entry[0]] || ''}
								>
								</textarea>`
		: html`<div class='row'>
								<input
									type='text'
									@input='${this._handleTextFieldUpdated}'
									data-field=${entry[0]}
									.value=${card[entry[0]] || ''}
								></input>
								${this._userMayUseAI && entry[0] == 'title' ? 
		html`<button
											class='small'
											@click=${this._handleAITitleClicked}
											title='Suggest title with AI'
										>${AUTO_AWESOME_ICON}</button>`
		: ''}</div>`}
				`)}
				<label>Images</label><card-images-editor></card-images-editor>
			</div>
			<textarea ?hidden=${this._selectedEditorTab !== 'notes'} @input='${this._handleNotesUpdated}' .value=${card.notes}></textarea>
			<textarea ?hidden=${this._selectedEditorTab !== 'todo'} @input='${this._handleTodoUpdated}' .value=${card.todo}></textarea>
		  </div>` : ''}
		  ${this._selectedTab == 'config' ? html`<div>
			<div class='row'>
				<div>
				<label>Section ${help('Cards are in 0 or 1 sections, which determines the default order they show up in. Cards that are orphaned will not show up in any default collection.')}</label>
				${this._userMayChangeEditingCardSection ? 
		html`<select @change='${this._handleSectionUpdated}' .value=${card.section}>
					${repeat(Object.values(this._sectionsUserMayEdit), (item) => item, (item) => html`
					<option value="${item.id}" ?selected=${item.id == card.section}>${item.title}</option>`)}
					<option value='' ?selected=${card.section == ''}>[orphaned]</option>
				</select>` : html`<em>${card.section}</em>`}
				</div>
				<div>
				<Label>Slugs ${help('Slugs are alternate identifiers for the card. You may not remove slugs. The one that is selected in this drop down is the default one that will be shown in end-user visible URLs')}</label>
				${this._pendingSlug ? html`<em>${this._pendingSlug}</em><button disabled>+</button>` : html`
					<select .value=${card.name} @change='${this._handleNameUpdated}'>
						${repeat([card.id, ...card.slugs], (item) => item, (item) => html`
						<option value="${item}" ?selected=${item == card.name}>${item}</option>`)}
					</select>
					<button @click='${this._handleAddSlug}'>+</button>
				`}
				</div>
				<div>
					<label>Card Type ${help('The type of card. Typically all published cards are content')}</label>
					<select .value=${card.card_type} @change=${this._handleCardTypeChanged}>
					${(Object.keys(CARD_TYPE_CONFIGURATION) as CardType[]).map(item => {
		const illegalCardTypeReason = reasonCardTypeNotLegalForCard(card, item);
		const configuration = CARD_TYPE_CONFIGURATION[item];
		if (!configuration) return '';
		const title = configuration.description + (illegalCardTypeReason ? '' : '\n' + illegalCardTypeReason);
		return html`<option .value=${item} .disabled=${illegalCardTypeReason 
		!= ''} .title=${title} .selected=${item == card.card_type}>${item}</option>`;
	})}
					</select>
				</div>
				<div>
					<button
						class='small'
						@click=${this._handleDeleteClicked}
						?disabled=${this._mayNotDeleteReason != ''}
						title='${this._mayNotDeleteReason ? 'Cards cannot be deleted unless they are orphaned, have no tags, and no other cards references them' : 'Delete card permanently'}'>
						${DELETE_FOREVER_ICON}
					</button>
				</div>
			</div>
			<div class='row'>
				<div>
					<label>Tags ${help('Tags are collections, visible to all viewers, that a card can be in. A card can be in 0 or more tags.')}</label>
					<tag-list
						.tags=${card.tags}
						.previousTags=${this._underlyingCard ? this._underlyingCard.tags : []}
						.editing=${this._userMayEditSomeTags}
						.excludeItems=${this._tagsUserMayNotEdit}
						.tagInfos=${this._tagInfos}
						@tag-added=${this._handleAddTag}
						@tag-removed=${this._handleRemoveTag}
						@tag-new=${this._handleNewTag}>
					</tag-list>
				</div>
				<div>
					<label>Suggested Tags ${help('Tags suggested because this card\'s content is similar to cards of the given tag. Tap one to add it.')}</label>
					<span class='suggestion-state' ?hidden=${this._suggestedTagsState === 'ready' || this._suggestedTags.length > 0}>${this._suggestedTagsState === 'pending' ? 'calculating…' : 'unavailable right now'}</span>
					<tag-list
						.tags=${this._suggestedTags}
						.tagInfos=${this._tagInfos}
						.subtle=${true}
						.tapEvents=${true}
						@tag-tapped=${this._handleAddTag}>
					</tag-list>
				</div>
				<div>
					<label>Suggested Concepts ${help('Cards that are suggested to be added as concept references. Tap one to add it as a concept reference, or x it out to add an ACK and get it to go away.')}</label>
					<div class='row'>
						<tag-list
							.tags=${this._suggestedConcepts}
							.tagInfos=${this._cardTagInfos}
							.editing=${true}
							.defaultColor=${REFERENCE_TYPES.concept.color}
							.tapEvents=${true}
							.disableAdd=${true}
							@tag-tapped=${this._handleSuggestedConceptTapped}
							@tag-removed=${this._handleAddAckReference}
							.overrideTypeName=${'Concept'}>
						</tag-list>
						<button
							class='small'
							@click=${this._handleAddAllConceptsClicked}
							?hidden=${this._suggestedConcepts.length == 0}
							title='Add all suggested concepts (Ctrl-Shift-C)'>
							${PLUS_ICON}
						</button>
						<button
							class='small'
							@click=${this._handleIgnoreAllConceptsClicked}
							?hidden=${this._suggestedConcepts.length == 0}
							title='Ignore all suggested concepts (Ctrl-Shift-I)'>
							${HIGHLIGHT_OFF_ICON}
						</button>
					</div>
				</div>
			</div>
				<div class='row'>
					<div>
						<label>Force Enable TODO ${help('Add a TODO manually')}</label>
						<tag-list
							.defaultColor=${enableTODOColor}
							.tags=${todoOverridesEnabled}
							.previousTags=${todoOverridesPreviouslyEnabled}
							.disableNew=${true}
							.overrideTypeName=${'Enabled'}
							.editing=${true}
							.tagInfos=${TODO_AUTO_INFOS}
							@tag-added=${this._handleAddTodoOverrideEnabled}
							@tag-removed=${this._handleRemoveTodoOverride}>
						</tag-list>
					</div>
					<div>
						<label>Force Disable TODO ${help('Affirmatively mark that even if an auto-todo WOULD have applied, it has been addressed.')}</label>
						<tag-list
							.defaultColor=${disableTODOColor}
							.tags=${todoOverridesDisabled}
							.previousTags=${todoOverridesPreviouslyDisabled}
							.disableNew=${true}
							.overrideTypeName=${'Disabled'}
							.editing=${true}
							.tagInfos=${TODO_AUTO_INFOS}
							@tag-added=${this._handleAddTodoOverrideDisabled}
							@tag-removed=${this._handleRemoveTodoOverride}>
						</tag-list>
					</div>
					<div>
						<label>Auto TODO ${help('Todos that are automatically applied because of the values of the card. Add a Force Disable TODO to remove one of these if it doesn\'t apply.')}</label>
						<tag-list
							.defaultColor=${autoTODOColor}
							.tags=${this._autoTodos}
							.overrideTypeName=${'Auto TODO'}
							.tagInfos=${TODO_ALL_INFOS}
							.disableAdd=${true}
							.editing=${true}
							@tag-removed=${this._handleAddTodoOverrideDisabled}>
						</tag-list>
					</div>
				</div>
				<div class='row'>
					<div>
						<label>Editors ${help('Editors are people who should be able to edit this card.')}</label>
						<tag-list
							.overrideTypeName=${'Editor'}
							.tagInfos=${this._authors}
							.tags=${card.permissions[PERMISSION_EDIT_CARD] || []}
							.editing=${true}
							@tag-removed=${this._handleRemoveEditor}
							@tag-added=${this._handleAddEditor}
							.disableNew=${!this._isAdmin}
							@tag-new=${this._handleNewEditor}
							.excludeItems=${[card.author]}>
						</tag-list>
					</div>
					<div>
						<label>Collaborators ${help('Collaborators are people who helped author the card. Collaborators are visible to all viewers of a card. By default any editor who edits a card is marked as a collaborator.')}</label>
						<tag-list
							.overrideTypeName=${'Collaborator'}
							.tagInfos=${this._authors}
							.tags=${card.collaborators}
							.editing=${true}
							@tag-removed=${this._handleRemoveCollaborator}
							@tag-added=${this._handleAddCollaborator}
							.disableNew=${!this._isAdmin}
							@tag-new=${this._handleNewCollaborator}
							.excludeItems=${[card.author]}>
						</tag-list>
					</div>
				</div>
				<div class='row'>
					<div>
						<label>Missing Reciprocal Links ${help('These are cards that reference this one, but we don\'t yet reference in any way. If this is non-empty, then there will be an Auto TODO of reciprocal links. X one out to add a Non-substantive acknowledgement back to that card.')}</label>
						<tag-list
							.overrideTypeName=${'Link'}
							.tagInfos=${this._cardTagInfos}
							.defaultColor=${enableTODOColor}
							.tags=${cardMissingReciprocalLinks(card)}
							.editing=${true}
							.disableAdd=${true}
							@tag-removed=${this._handleAddAckReference}>
						</tag-list>
					</div>
					<div>
						<select @change=${this._handleAddReference}>
							<option value=''><em>Add a reference to a card type...</option>
							${Object.entries(REFERENCE_TYPES).filter(entry => entry[1].editable).map(entry => html`<option value=${entry[0]} title=${entry[1].description} ?disabled=${!LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE[card.card_type][entry[0]]}>${entry[1].name}</option>`)}
						</select>
					</div>
				</div>
				<div class='row'>
					${TypedObject.entries(REFERENCE_TYPES).filter(entry => referencesMap[entry[0]]).map(entry => {
		return html`<div>
							<label>${entry[1].name} ${help(entry[1].description, false)} <button class='small' data-reference-type=${entry[0]} @click=${this._handleRemoveAllReferencesOfTypeClicked} title=${'Remove all references of type ' + entry[1].name} >${HIGHLIGHT_OFF_ICON}</button></label>
							<tag-list
								.overrideTypeName=${'Reference'}
								.disableTagIfMissingTagInfo=${true}
								.disabledDescription=${'You do not have permission to view this card so you may not remove the reference to it.'}
								data-reference-type=${entry[0]}
								.tagInfos=${this._cardTagInfosForReferenceTypes?.[entry[0]] || this._cardTagInfos}
								.defaultColor=${entry[1].color}
								.tags=${referencesMap[entry[0]] || []}
								.previousTags=${previousReferencesMap[entry[0]] || []}
								.editing=${entry[1].editable || false}
								.subtle=${!entry[1].editable}
								.tapEvents=${true}
								.disableAdd=${true}
								@tag-tapped=${this._handleReferenceTapped}
								@tag-removed=${this._handleRemoveReference}
								@tag-added=${this._handleReAddReference}>
							</tag-list>
						</div>`;
	})}
				</div>
			</div>` : ''}
        </div>
        <div class='buttons'>
			<div class='header' @click=${this._handleMinimizedClicked}>
				<button class='small'>${this._minimized ? ARROW_RIGHT_ICON : ARROW_UP_ICON}</button>
				<h3>Editing</h3>
			</div>
			${this._minimized ? 
		html`
			<div class='tags stack'>
				<div>
					<tag-list
						.defaultColor=${autoTODOColor}
						.tags=${this._autoTodos}
						.overrideTypeName=${'Auto TODO'}
						.tagInfos=${TODO_ALL_INFOS}
						.hideOnEmpty=${true}
						.disableAdd=${true}
						.editing=${true}
						@tag-removed=${this._handleAddTodoOverrideDisabled}>
					</tag-list>
					<tag-list
						.defaultColor=${enableTODOColor}
						.tags=${todoOverridesEnabled}
						.previousTags=${todoOverridesPreviouslyEnabled}
						.disableNew=${true}
						.overrideTypeName=${'TODO'}
						.editing=${true}
						.tagInfos=${TODO_AUTO_INFOS}
						@tag-added=${this._handleAddTodoOverrideEnabled}
						@tag-removed=${this._handleRemoveTodoOverride}
						.hideMessageOnEmpty=${true}>
					</tag-list>
				</div>
				<div>
					<tag-list
						.tags=${card.tags}
						.previousTags=${this._underlyingCard ? this._underlyingCard.tags : []}
						.editing=${this._userMayEditSomeTags}
						.excludeItems=${this._tagsUserMayNotEdit}
						.tagInfos=${this._tagInfos}
						@tag-added=${this._handleAddTag}
						@tag-removed=${this._handleRemoveTag}
						@tag-new=${this._handleNewTag}
						.hideMessageOnEmpty=${true}
					></tag-list>
				</div>
			</div>
			<div class='flex'></div>
			<div class='tags'>
				<tag-list
					.tags=${this._suggestedConcepts}
					.tagInfos=${this._cardTagInfos}
					.editing=${true}
					.defaultColor=${REFERENCE_TYPES.concept.color}
					.tapEvents=${true}
					.disableAdd=${true}
					@tag-tapped=${this._handleSuggestedConceptTapped}
					@tag-removed=${this._handleAddAckReference}
					.overrideTypeName=${'Concept'}>
				</tag-list>
				<button
					class='small'
					@click=${this._handleAddAllConceptsClicked}
					?hidden=${this._suggestedConcepts.length == 0}
					title='Add all suggested concepts (Ctrl-Shift-C)'>
					${PLUS_ICON}
				</button>
				<button
					class='small'
					@click=${this._handleIgnoreAllConceptsClicked}
					?hidden=${this._suggestedConcepts.length == 0}
					title='Ignore all suggested concepts (Ctrl-Shift-I)'>
					${HIGHLIGHT_OFF_ICON}
				</button>
			</div>
			<div class='flex'></div>
			<div class='tags'>
				<select @change=${this._handleAddReference} style='max-width:10em'>
					<option value=''><em>Add reference...</em></option>
					${Object.entries(REFERENCE_TYPES).filter(entry => entry[1].editable).map(entry => html`<option value=${entry[0]} title=${entry[1].description} ?disabled=${!LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE[card.card_type][entry[0]]}>${entry[1].name}</option>`)}
				</select>
			</div>
		` :
		html`<div class='tabs main' @click=${this._handleTabClicked} @keydown=${this._handleTabKeyDown}>
				<label role='tab' tabindex='0' aria-selected=${this._selectedTab == 'config'} data-name='${editorTab('config')}' ?data-selected=${this._selectedTab == 'config'}>Configuration</label>
				<label role='tab' tabindex='0' aria-selected=${this._selectedTab == 'content'} data-testid='editor-main-content' data-name='${editorTab('content')}' ?data-selected=${this._selectedTab == 'content'}>Content</label>
			</div>
			<div class='flex'>
			</div>
			`}
			<div class='checkboxes'>
				<div>
					<label>Full Bleed</label>
					<input type='checkbox' ?checked='${card.full_bleed}' @change='${this._handleFullBleedUpdated}'></input>
					</div>
				<div>
					<label>Published</label>
					<input type='checkbox' .checked=${card.published} @change='${this._handlePublishedUpdated}'></input>
				</div>
				<div>
					<label>Substantive</label>
					<input type='checkbox' .checked=${this._substantive} @change='${this._handleSubstantiveChanged}'></input>
				</div>
			</div>
			<button class='round' data-testid='cancel-card-edit' aria-label='Cancel editing' @click='${this._handleCancel}'>${CANCEL_ICON}</button>
			<button class='round primary' @click=${this._handleMergeClicked} ?hidden=${!this._overshadowedDifferences} title='${'The card you\'re editing has been changed by someone else in a way that is overwritten by your edits:\n' + this._overshadowedDifferences + '\nClick here to choose which of these fields to revert your edits on.'}'>${MERGE_TYPE_ICON}</button>
			<!-- The title lives on a WRAPPER, not on the button: Chrome and
			Safari suppress pointer events on disabled controls, so a title on
			the button itself never renders a tooltip — which is exactly the
			state where the user most needs the reason. -->
			<span class='reason' title=${!this._saveEligible ? `${blockedReason(this._corpusStatus, SAVE_VERB)} Your draft is safe.` : this._hasUnsavedChanges ? 'Commit the changes you\'ve made' : 'You haven\'t made any changes that need saving.'}>
				<button class='round primary' data-testid='save-card' aria-label='Save card' @click='${this._handleCommit}' ?disabled=${!this._hasUnsavedChanges || !this._saveEligible}>${SAVE_ICON}</button>
			</span>
        </div>
      </div>
    `;
	}

	override stateChanged(state : State) {
		this._card= selectEditingCard(state);
		this._underlyingCard = selectEditingUnderlyingCardSnapshot(state);
		this._active = selectIsEditing(state);
		this._minimized = selectEditorMinimized(state);
		this._selectedTab = state.editor ? state.editor.selectedTab : 'content';
		this._selectedEditorTab = state.editor ? state.editor.selectedEditorTab : 'content';
		//The MINIMIZED bar has no tab strip, and it renders the auto-TODO list,
		//the tag editor and both suggested-concept shortcuts itself. Gating those
		//values on the config TAB blanked all of them there — minimize while on the
		//Content tab and the bar's lists render empty, which reads as 'no TODOs, no
		//tags, no suggestions' rather than 'not computed'. Gate on whether anything
		//that displays them is actually on screen.
		//Gated on EDITING, not on the tab. Cmd-Shift-C / Cmd-Shift-I act on
		//_suggestedConcepts and are live whenever the editor is open, so
		//zeroing that list on the default Content tab made both shortcuts
		//silent no-ops that still swallowed the keystroke — master populated
		//suggestions whenever editing. The tab gating was a perf measure, and
		//it buys little now: suggested TAGS are computed by the worker, and
		//the expensive local fallback runs only in non-worker diagnostic modes
		//on small corpora.
		const detailFieldsVisible = this._active;

		this._autoTodos = detailFieldsVisible ? selectEditingCardAutoTodos(state) : [];
		this._userMayChangeEditingCardSection = detailFieldsVisible ? selectUserMayChangeEditingCardSection(state) : false;
		this._userMayUseAI = selectUserMayUseAI(state);
		this._sectionsUserMayEdit = detailFieldsVisible ? selectSectionsUserMayEdit(state) : {};
		this._mayNotDeleteReason = detailFieldsVisible ? selectReasonsUserMayNotDeleteActiveCard(state) : '';
		this._substantive = state.editor ? state.editor.substantive : false;
		this._tagInfos = selectTags(state);
		this._userMayEditSomeTags = detailFieldsVisible ? selectUserMayEditSomeTags(state) : false;
		this._tagsUserMayNotEdit = detailFieldsVisible ? tagsUserMayNotEdit(state) : [];
		if (detailFieldsVisible) {
			this._scheduleSuggestions(state);
			this._cardTagInfos = this._makeVisibleCardTagInfos(state);
		} else {
			window.clearTimeout(this._suggestionsTimeout);
			this._suggestionsKey = '';
			this._suggestedTags = [];
			this._suggestedTagsState = 'pending';
			this._suggestedConcepts = [];
			this._cardTagInfos = {};
		}
		this._authors = detailFieldsVisible ? selectAuthorsForTagList(state) : {};
		this._isAdmin = selectUserIsAdmin(state);
		this._pendingSlug = selectPendingSlug(state);
		this._cardModificationPending = selectCardModificationPending(state);
		this._saveEligible = selectCardSavesEligible(state);
		this._corpusStatus = selectCorpusStatus(state);
		this._offline = state.app.offline;
		//These two are memoized card diffs (cheap) and drive the merge
		//affordance AND updated()'s auto-apply of underlying changes — gating
		//them to the config tab silently disabled both on the default content
		//tab (regression sweep finding).
		this._underlyingCardDifferences = selectEditingUnderlyingCardSnapshotDiffDescription(state);
		this._overshadowedDifferences = selectOvershadowedUnderlyingCardChangesDiffDescription(state);
		this._hasUnsavedChanges = selectEditingCardHasUnsavedChanges(state);
		this._fieldValidationErrors = selectFieldValidationErrorsForEditingCard(state);
	}

	_suggestionKeyForState(state : State) {
		const cardID = state.editor?.card?.id || '';
		const extractionVersion = state.editor?.cardExtractionVersion || 0;
		//Must match the gate in stateChanged, or a suggestion run is scheduled
		//whose key never validates and never renders.
		return this._active ? `${cardID}:${extractionVersion}` : '';
	}

	_scheduleSuggestions(state : State) {
		const key = this._suggestionKeyForState(state);
		if (!key || key == this._suggestionsKey) return;
		window.clearTimeout(this._suggestionsTimeout);
		this._suggestionsKey = key;
		this._suggestedTags = [];
		this._suggestedConcepts = [];
		this._suggestionsTimeout = window.setTimeout(() => {
			const latestState = store.getState() as State;
			if (this._suggestionKeyForState(latestState) != key) return;
			//Suggested-tag calculation fingerprints every card in every tag —
			//seconds of stall at production corpus size, so it must never run
			//on the UI thread in worker mode. The corpus worker computes it
			//against its mirrored editing card instead; non-worker diagnostic
			//modes fall back to the local selector (small corpora).
			if (corpusWorkerCanRunCollections()) {
				this._suggestedTagsState = 'pending';
				void corpusWorkerSuggestTags().then(tags => {
					if (this._suggestionKeyForState(store.getState() as State) != key) return;
					//null means the worker never answered (torn down, or the
					//10s guard fired) — NOT that there is nothing to suggest.
					this._suggestedTagsState = tags === null ? 'unavailable' : 'ready';
					this._suggestedTags = tags || [];
				});
			} else if (!corpusWorkerServesCollections()) {
				this._suggestedTagsState = 'ready';
				this._suggestedTags = selectEditingCardSuggestedTags(latestState);
			} else {
				this._suggestedTagsState = 'unavailable';
				this._suggestedTags = [];
			}
			this._suggestedConcepts = selectEditingCardSuggestedConceptReferences(latestState);
			this._cardTagInfos = this._makeVisibleCardTagInfos(latestState, this._suggestedConcepts);
			this._cardTagInfosForReferenceTypes = this._makeCardTagInfosForReferenceTypes();
		}, 0);
	}

	_makeVisibleCardTagInfos(state : State, suggestedConcepts = this._suggestedConcepts || []) {
		const visibleCardIDs = new Set<CardID>([
			...cardReferenceIDs(this._card),
			...cardReferenceIDs(this._underlyingCard),
			...(this._card ? cardMissingReciprocalLinks(this._card) : []),
			...suggestedConcepts
		]);
		return cardTagInfosForIDs(selectRawCards(state), visibleCardIDs);
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_underlyingCardDifferences') && this._underlyingCardDifferences) {
			//TODO: isn't it kind of weird to have the view be the thing thta
			//triggers the autoMerge? Shouldn't it be some wrapper around
			//updateCards or something?
			console.log('Updating underlying card:\n', this._underlyingCardDifferences);
			//auto apply the changes
			store.dispatch(updateUnderlyingCard());
		}
		if (changedProps.has('_cardTagInfos') || changedProps.has('_card')) {
			//TODO: ideally we would only re-run this if the references have changed since last time it ran.
			this._cardTagInfosForReferenceTypes = this._makeCardTagInfosForReferenceTypes();
		}
	}

	override shouldUpdate() {
		return this._active;
	}

	override firstUpdated() {
		document.addEventListener('keydown', e => this._handleKeyDown(e));
	}

	_makeCardTagInfosForReferenceTypes() : TagInfosByReferenceType {
		const card = this._card;
		const baseInfos = this._cardTagInfos;
		const byType = references(card).byType;
		const result : Partial<TagInfosByReferenceType> = {};
		for (const referenceType of referenceTypeSchema.options) {
			let infos = baseInfos;
			if (this._card) {
				const refs = byType[referenceType];
				if (refs) {
					//We want to keep info object identity as much as possible for the multiple caching layers.
					let overlayChanged = false;
					const overlay = Object.fromEntries(TypedObject.entries(refs).map(entry => {
						const [cardID, value] = entry;
						let info = baseInfos[cardID] || {};
						if (value) {
							//This is the meat of overriding the tagInfo based on references.
							info = {
								...info,
								description: (info.description || info.title) + ' : ' + value,
								iconName: 'INFO_ICON'
							};
							overlayChanged = true;
						}
						return [cardID, info];
					}));
					if (overlayChanged) {
						infos = {
							...infos,
							...overlay
						};
					}
				}
			}
			result[referenceType] = infos;
		}
		return result as TagInfosByReferenceType;
	}

	_handleSuggestedConceptTapped(e : TagEvent) {
		const cardID = e.detail.tag;
		store.dispatch(addReferenceToCard(cardID, 'concept'));
	}

	_handleMergeClicked() {
		store.dispatch(mergeOvershadowedUnderlyingChanges());
	}

	_handleAddAllConceptsClicked() {
		for (const cardID of this._suggestedConcepts) {
			store.dispatch(addReferenceToCard(cardID, 'concept'));
		}
	}

	_handleIgnoreAllConceptsClicked() {
		for (const cardID of this._suggestedConcepts) {
			store.dispatch(addReferenceToCard(cardID, 'ack'));
		}
	}

	_handleRemoveAllReferencesOfTypeClicked(e : MouseEvent) {
		let refType : ReferenceType | undefined = undefined;
		for (const ele of e.composedPath()) {
			//Could be a documentfragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) return;
		const ids = references(this._card).byTypeArray()[refType];
		if (!ids) return;
		for (const cardID of ids) {
			store.dispatch(removeReferenceFromCard(cardID, refType));
		}
	}

	_handleCardTypeChanged(e : Event) {
		if (!this._active) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('ele not select');
		const value : CardType = ele.value as CardType;
		if (!CARD_TYPE_CONFIGURATION[value]) throw new Error('Unknown card type');
		store.dispatch(cardTypeUpdated(value));
	}

	_handleMinimizedClicked() {
		store.dispatch(setEditorMinimized(!this._minimized));
	}

	_handleDeleteClicked() {
		if (!this._card) throw new Error('No card');
		store.dispatch(deleteCard(this._card));
	}

	_handleAddReference(e : Event) {
		const ele = e.composedPath()[0];
		if(!(ele instanceof HTMLSelectElement)) throw new Error('ele not select');
		if (!ele.value) return;
		const value = referenceTypeSchema.parse(ele.value);
		if (!REFERENCE_TYPES[value]) throw new Error('Unknown reference types');
		//Set it back to default
		ele.value = '';
		store.dispatch(selectCardToReference(value));
	}

	_handleAddAckReference(e : TagEvent) {
		const cardID = e.detail.tag;
		store.dispatch(addReferenceToCard(cardID, 'ack'));
	}

	_handleReferenceTapped(e : TagEvent) {
		if (!this._card) return;
		const cardID = e.detail.tag;
		let refType : ReferenceType | undefined = undefined;
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (const ele of e.composedPath()) {
			//Could be a documentfragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) {
			console.warn('No reference type found on parents');
			return;
		}

		const config = REFERENCE_TYPES[refType];
		if (!config.editable) {
			console.warn('This reference type is not editable');
		}
		const map = this._card.references_info[cardID];
		let val = '';
		if (map) {
			val = map[refType] || '';
		}
		const newVal = prompt(`What do you want the value to be?${config.valueHint ? '\n' + config.valueHint : ''}`, val);
		if (newVal == null) return;
		store.dispatch(addReferenceToCard(cardID, refType, newVal));
	}

	_handleReAddReference(e : TagEvent) {
		const cardID = e.detail.tag;
		let refType : ReferenceType | undefined = undefined;
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (const ele of e.composedPath()) {
			//Could be a documentfragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) throw new Error('couldn\'t find referenceType');
		store.dispatch(addReferenceToCard(cardID, refType));
	}

	_handleRemoveReference(e : TagEvent) {
		const cardID = e.detail.tag;
		let refType : ReferenceType | undefined = undefined;
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (const ele of e.composedPath()) {
			//Could be a documentfragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.referenceType) {
				refType = referenceTypeSchema.parse(ele.dataset.referenceType);
				break;
			}
		}
		if (!refType) {
			console.warn('No reference type found on parents');
			return;
		}
		store.dispatch(removeReferenceFromCard(cardID, refType));
	}

	_handleTabClicked(e : MouseEvent) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) throw new Error('ele not html element');
		const name = ele.getAttribute('data-name') as EditorTab;
		if (!name) return;
		store.dispatch(editingSelectTab(name));
	}

	_handleTabKeyDown(e : KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) return;
		const name = ele.getAttribute('data-name') as EditorTab;
		if (!name) return;
		killEvent(e);
		store.dispatch(editingSelectTab(name));
	}

	_handleEditorTabClicked(e : MouseEvent) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) throw new Error('ele not html element');
		const name = ele.getAttribute('data-name') as EditorContentTab;
		if (!name) return;
		store.dispatch(editingSelectEditorTab(name));
	}

	_handleEditorTabKeyDown(e : KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) return;
		const name = ele.getAttribute('data-name') as EditorContentTab;
		if (!name) return;
		killEvent(e);
		store.dispatch(editingSelectEditorTab(name));
	}

	_handleAITitleClicked() {
		store.dispatch(titleForEditingCardWithAI());
	}

	_handleNewTag() {
		const name = prompt('What is the base name of the tag?');
		if (!name) return;
		const displayName = prompt('What is the display name for the tag?', name);
		if (!displayName) return;
		store.dispatch(createTag(name, displayName));
	}

	_handleAddTag(e : TagEvent) {
		store.dispatch(tagAdded(e.detail.tag));
	}

	_handleRemoveTag(e : TagEvent) {
		store.dispatch(tagRemoved(e.detail.tag));
	}

	_handleAddEditor(e : TagEvent) {
		store.dispatch(editorAdded(e.detail.tag));
	}

	_handleRemoveEditor(e : TagEvent) {
		store.dispatch(editorRemoved(e.detail.tag));
	}

	_handleNewEditor() {
		this._addNewEditorOrCollaborator(true);
	}

	_handleAddCollaborator(e : TagEvent) {
		store.dispatch(collaboratorAdded(e.detail.tag));
	}

	_handleRemoveCollaborator(e : TagEvent) {
		store.dispatch(collaboratorRemoved(e.detail.tag));
	}

	_handleNewCollaborator() {
		this._addNewEditorOrCollaborator(false);
	}

	_addNewEditorOrCollaborator(isEditor : boolean) {
		const uid = prompt('What is the uid of the user to add? You can get this from the firebase authentication console.');
		if (!uid) {
			console.log('No uid provided');
			return;
		}
		if (isEditor) {
			store.dispatch(manualEditorAdded(uid));
		} else {
			store.dispatch(manualCollaboratorAdded(uid));
		}
	}

	_handleAddTodoOverrideEnabled(e : TagEvent) {
		store.dispatch(autoTodoOverrideEnabled(autoTODOType.parse(e.detail.tag)));
	}

	_handleAddTodoOverrideDisabled(e : TagEvent) {
		store.dispatch(autoTodoOverrideDisabled(autoTODOType.parse(e.detail.tag)));
	}

	_handleRemoveTodoOverride(e : TagEvent) {
		store.dispatch(autoTodoOverrideRemoved(autoTODOType.parse(e.detail.tag)));
	}

	_handleKeyDown(e : KeyboardEvent) {
		//We have to hook this to issue content editable commands when we're
		//active. But most of the time we don't want to do anything.
		if (!this._active) return;
		if (!e.metaKey && !e.ctrlKey) return;

		if (e.shiftKey && pressedLetter(e) == 'c') {
			this._handleAddAllConceptsClicked();
			return killEvent(e);
		}

		if (e.shiftKey && pressedLetter(e) == 'i') {
			this._handleIgnoreAllConceptsClicked();
			return killEvent(e);
		}

		//TODO: bail if a content editable region isn't selected. This isn't THAT
		//big of a deal as long as we use execCommand, because those will just
		//fail if the selection isn't in a contentEditable region.

		switch (e.key) {
		case 'b':
			document.execCommand('bold');
			return killEvent(e);
		case 'i':
			document.execCommand('italic');
			return killEvent(e);
		case '7':
			document.execCommand('insertOrderedList');
			return killEvent(e);
		case '8':
			document.execCommand('insertUnorderedList');
			return killEvent(e);
		case 'k':
			//Default to searching for the text that's selected
			const sel = document.getSelection();
			if (sel) store.dispatch(findCardToLink(sel.toString()));
			return killEvent(e);
		}
	}

	_handleTextFieldUpdated(e : InputEvent) {
		if (!this._active) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLTextAreaElement) && !(ele instanceof HTMLInputElement)) throw new Error('ele not textarea or text input');
		const field = cardFieldTypeEditableSchema.parse(ele.dataset.field);
		store.dispatch(textFieldUpdated(field, ele.value, false));
	}

	textFieldUpdatedFromContentEditable(field : CardFieldTypeEditable, value : string) {
		store.dispatch(textFieldUpdated(field, value, true));
	}

	disabledCardHighlightClicked(cardID : CardID, alternate : boolean) {
		if (!this._active) return;
		if(alternate) {
			store.dispatch(addReferenceToCard(cardID, 'concept'));
		} else {
			store.dispatch(removeReferenceFromCard(cardID, 'concept'));
		}
	}

	_handleNotesUpdated(e : InputEvent) {
		if (!this._active) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLTextAreaElement)) throw new Error('ele not textarea');
		store.dispatch(notesUpdated(ele.value));
	}

	_handleTodoUpdated(e : InputEvent) {
		if (!this._active) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLTextAreaElement)) throw new Error('ele not textarea');
		store.dispatch(todoUpdated(ele.value));
	}

	_handleSectionUpdated(e : Event) {
		if (!this._active) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('ele not select');
		store.dispatch(sectionUpdated(ele.value));
	}

	_handleNameUpdated(e : Event) {
		if (!this._active) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('ele not select');
		store.dispatch(nameUpdated(ele.value));
	}

	_handleAddSlug() {
		if (!this._active) return;
		if (!this._card) return;
		const id = this._card.id;
		const value = prompt('Slug to add:', createSlugFromArbitraryString(this._card.title || ''));
		if (!value) return;
		store.dispatch(addSlug(id, value));
	}

	_handleFullBleedUpdated(e : Event) {
		if(!this._active) return; 
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('ele not input');
		store.dispatch(fullBleedUpdated(ele.checked));
	}

	_handlePublishedUpdated(e : Event) {
		if(!this._active) return; 
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('ele not input');
		store.dispatch(publishedUpdated(ele.checked));
	}

	_handleSubstantiveChanged(e : Event) {
		if(!this._active) return; 
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('ele not input');
		store.dispatch(substantiveUpdated(ele.checked));
	}

	_handleCommit() {
		store.dispatch(editingCommit());
	}

	_handleCancel() {
		//Cancel is the one unguarded destructive path out of the editor: the
		//draft watcher sees dirty->clean and DELETES the persisted draft, with
		//no confirm, no undo, and no recovery banner. That was survivable when
		//saving was always available; it is not now that Save can be refused
		//for tens of seconds during boot verification — and the disabled Save
		//button's own tooltip tells the user "your draft is safe" while this
		//button silently discards it. Ask, and say what is at stake.
		if (this._hasUnsavedChanges) {
			const extra = this._saveEligible
				? ''
				: '\n\nNote: Save is temporarily unavailable while card sync verifies. Your draft is kept if you leave the editor open, or close the tab.';
			if (!confirm(`Discard your unsaved changes to this card? This cannot be undone.${extra}`)) return;
		}
		store.dispatch(editingFinish());
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'card-editor': CardEditor;
	}
}
