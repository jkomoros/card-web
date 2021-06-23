import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

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
	selectEditingCardSuggestedTags,
	selectAuthorsForTagList,
	selectUserIsAdmin,
	selectTagInfosForCards,
	selectUserMayEditSomeTags,
	tagsUserMayNotEdit,
	selectSectionsUserMayEdit,
	selectUserMayChangeEditingCardSection,
	selectPendingSlug,
	selectReasonsUserMayNotDeleteActiveCard,
	selectCardModificationPending,
	selectEditingCardSuggestedConceptReferences,
	selectEditingUnderlyingCardSnapshotDiffDescription
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
	mergeUpdatedUnderlyingCard,

	TAB_CONTENT,
	TAB_CONFIG,
	EDITOR_TAB_CONTENT,
	EDITOR_TAB_NOTES,
	EDITOR_TAB_TODO,
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
} from '../actions/editor.js';

import {
	SAVE_ICON,
	CANCEL_ICON,
	DELETE_FOREVER_ICON,
	PLUS_ICON,
	HIGHLIGHT_OFF_ICON,
	MERGE_TYPE_ICON
} from './my-icons.js';

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
	TEXT_FIELD_BODY,
	editableFieldsForCardType,
	REFERENCE_TYPES,
	REFERENCE_TYPE_ACK,
	CARD_TYPE_CONFIGURATION,
	REFERENCE_TYPE_CONCEPT,
	LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE
} from '../card_fields.js';

import {
	references,
} from '../references.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import './tag-list.js';
import './card-images-editor.js';

class CardEditor extends connect(store)(LitElement) {
	render() {

		const hasContent = cardHasContent(this._card);
		const hasNotes = cardHasNotes(this._card);
		const hasTodo = cardHasTodo(this._card);
		const contentModified = this._card[TEXT_FIELD_BODY] != this._underlyingCard[TEXT_FIELD_BODY];
		const notesModified = this._card.notes != this._underlyingCard.notes;
		const todoModified = this._card.todo != this._underlyingCard.todo;

		const todoOverridesEnabled = Object.entries(this._card.auto_todo_overrides).filter(entry => entry[1] == false).map(entry => entry[0]);
		const todoOverridesPreviouslyEnabled = Object.entries(this._underlyingCard.auto_todo_overrides).filter(entry => entry[1] == false).map(entry => entry[0]);
		const todoOverridesDisabled = Object.entries(this._card.auto_todo_overrides).filter(entry => entry[1] == true).map(entry => entry[0]);
		const todoOverridesPreviouslyDisabled = Object.entries(this._underlyingCard.auto_todo_overrides).filter(entry => entry[1] == true).map(entry => entry[0]);

		
		const enableTODOColor = '#b22222'; //firebrick
		//When you're disabling a TODO, you're marking it done, so it should be green.
		const disableTODOColor = '#006400'; //darkgreen
		const autoTODOColor = '#cc9494'; //firebrick, but less saturated and lighter

		const referencesMap = references(this._card).byTypeArray();

		return html`
	  ${ButtonSharedStyles}
	  ${HelpStyles}
      <style>

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
          position:absolute;
        }

        .inputs {
          display:flex;
          flex-direction:column;
          width:100%;
          flex-grow:1;
		  overflow:scroll;
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
          opacity:0.5;
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

		.tabs label[selected] {
			color: var(--app-primary-color);
			border-bottom-color: var(--app-primary-color);
		}

		.tabs label[empty] {
			font-weight:inherit;
		}

		.tabs label[modified] {
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

		.tabs.main label[selected] {
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
			display:block;
		}

      </style>
      <div class='container ${this._cardModificationPending ? 'modification-pending' : ''}'>
		<div class='scrim'></div>
        <div class='inputs'>
		  <div ?hidden=${this._selectedTab !== TAB_CONTENT} class='flex body'>
			<div class='tabs' @click=${this._handleEditorTabClicked}>
				<label name='${EDITOR_TAB_CONTENT}' ?selected=${this._selectedEditorTab == EDITOR_TAB_CONTENT} ?empty=${!hasContent} ?modified=${contentModified}>Content</label>
				<label name='${EDITOR_TAB_NOTES}' ?selected=${this._selectedEditorTab == EDITOR_TAB_NOTES} ?empty=${!hasNotes} ?modified=${notesModified}>Notes</label>
				<label name='${EDITOR_TAB_TODO}' ?selected=${this._selectedEditorTab == EDITOR_TAB_TODO} ?empty=${!hasTodo} ?modified=${todoModified}>Freeform TODO</label>
				<span class='flex'></span>
				<label class='help' ?hidden=${this._selectedEditorTab !== EDITOR_TAB_CONTENT}>Content is what shows up on the main body of the card</label>
				<label class='help' ?hidden=${this._selectedEditorTab !== EDITOR_TAB_NOTES}>Notes are visible in the info panel to all readers and are for permanent asides</label>
				<label class='help' ?hidden=${this._selectedEditorTab !== EDITOR_TAB_TODO}>Freeform TODOs are only visible to editors and mark a temporary thing to do so it shows up in the has-freeform-todo filter</label>

			</div>
			<div ?hidden=${this._selectedEditorTab !== EDITOR_TAB_CONTENT} class='body flex'>
				${Object.entries(editableFieldsForCardType(this._card.card_type)).map(entry => html`<label>${toTitleCase(entry[0])}${entry[1].description ? help(entry[1].description) : ''}</label>
					${entry[1].html
		? html`<textarea @input='${this._handleTextFieldUpdated}' .field=${entry[0]} .value=${this._card[entry[0]]}></textarea>`
		: html`<input type='text' @input='${this._handleTextFieldUpdated}' .field=${entry[0]} .value=${this._card[entry[0]] || ''}></input>`}
				`)}
				<label>Images</label><card-images-editor></card-images-editor>
			</div>
			<textarea ?hidden=${this._selectedEditorTab !== EDITOR_TAB_NOTES} @input='${this._handleNotesUpdated}' .value=${this._card.notes}></textarea>
			<textarea ?hidden=${this._selectedEditorTab !== EDITOR_TAB_TODO} @input='${this._handleTodoUpdated}' .value=${this._card.todo}></textarea>
		  </div>
		  <div ?hidden=${this._selectedTab !== TAB_CONFIG}>
			<div class='row'>
				<div>
				<label>Section ${help('Cards are in 0 or 1 sections, which determines the default order they show up in. Cards that are orphaned will not show up in any default collection.')}</label>
				${this._userMayChangeEditingCardSection ? 
		html`<select @change='${this._handleSectionUpdated}' .value=${this._card.section}>
					${repeat(Object.values(this._sectionsUserMayEdit), (item) => item, (item) => html`
					<option value="${item.id}" ?selected=${item.id == this._card.section}>${item.title}</option>`)}
					<option value='' ?selected=${this._card.section == ''}>[orphaned]</option>
				</select>` : html`<em>${this._card.section}</em>`}
				</div>
				<div>
				<Label>Slugs ${help('Slugs are alternate identifiers for the card. You may not remove slugs. The one that is selected in this drop down is the default one that will be shown in end-user visible URLs')}</label>
				${this._pendingSlug ? html`<em>${this._pendingSlug}</em><button disabled>+</button>` : html`
					<select .value=${this._card.name} @change='${this._handleNameUpdated}'>
						${repeat([this._card.id, ...this._card.slugs], (item) => item, (item) => html`
						<option value="${item}" ?selected=${item == this._card.name}>${item}</option>`)}
					</select>
					<button @click='${this._handleAddSlug}'>+</button>
				`}
				</div>
				<div>
					<label>Card Type ${help('The type of card. Typically all published cards are content')}</label>
					<select .value=${this._card.card_type} @change=${this._handleCardTypeChanged}>
					${Object.keys(CARD_TYPE_CONFIGURATION).map(item => {
		const illegalCardTypeReason = reasonCardTypeNotLegalForCard(this._card, item);
		const title = CARD_TYPE_CONFIGURATION[item].description + (illegalCardTypeReason ? '' : '\n' + illegalCardTypeReason);
		return html`<option .value=${item} .disabled=${illegalCardTypeReason} .title=${title} .selected=${item == this._card.card_type}>${item}</option>`;
	})}
					</select>
				</div>
				<div>
					<button class='small' @click=${this._handleDeleteClicked} ?disabled=${this._mayNotDeleteReason} title='${this._mayNotDeleteReason ? 'Cards cannot be deleted unless they are orphaned, have no tags, and no other cards references them' : 'Delete card permanently'}'>${DELETE_FOREVER_ICON}</button>
				</div>
			</div>
			<div class='row'>
				<div>
					<label>Tags ${help('Tags are collections, visible to all viewers, that a card can be in. A card can be in 0 or more tags.')}</label>
					<tag-list .tags=${this._card.tags} .previousTags=${this._underlyingCard ? this._underlyingCard.tags : null} .editing=${this._userMayEditSomeTags} .excludeItems=${this._tagsUserMayNotEdit} .tagInfos=${this._tagInfos} @add-tag=${this._handleAddTag} @remove-tag=${this._handleRemoveTag} @new-tag=${this._handleNewTag}></tag-list>
				</div>
				<div>
					<label>Suggested Tags ${help('Tags suggested because this card\'s content is similar to cards of the given tag. Tap one to add it.')}</label>
					<tag-list .tags=${this._suggestedTags} .tagInfos=${this._tagInfos} .subtle=${true} .tapEvents=${true} @tag-tapped=${this._handleAddTag}></tag-list>
				</div>
				<div>
					<label>Suggested Concepts ${help('Cards that are suggested to be added as concept references. Tap one to add it as a concept reference, or x it out to add an ACK and get it to go away.')}</label>
					<div class='row'>
						<tag-list .tags=${this._suggestedConcepts} .tagInfos=${this._cardTagInfos} .editing=${true} .defaultColor=${REFERENCE_TYPES[REFERENCE_TYPE_CONCEPT].color} .tapEvents=${true} .disableAdd=${true} @tag-tapped=${this._handleSuggestedConceptTapped} @remove-tag=${this._handleAddAckReference} .overrideTypeName=${'Concept'}></tag-list>
						<button class='small' @click=${this._handleAddAllConceptsClicked} ?hidden=${this._suggestedConcepts.length == 0} title='Add all suggested concepts (Ctrl-Shift-C)'>${PLUS_ICON}</button>
						<button class='small' @click=${this._handleIgnoreAllConceptsClicked} ?hidden=${this._suggestedConcepts.length == 0} title='Ignore all suggested concepts (Ctrl-Shift-I)'>${HIGHLIGHT_OFF_ICON}</button>
					</div>
				</div>
			</div>
				<div class='row'>
					<div>
						<label>Force Enable TODO ${help('Add a TODO manually')}</label>
						<tag-list .defaultColor=${enableTODOColor} .tags=${todoOverridesEnabled} .previousTags=${todoOverridesPreviouslyEnabled} .disableNew=${true} .overrideTypeName=${'Enabled'} .editing=${true} .tagInfos=${TODO_AUTO_INFOS} @add-tag=${this._handleAddTodoOverrideEnabled} @remove-tag=${this._handleRemoveTodoOverride}></tag-list>
					</div>
					<div>
						<label>Force Disable TODO ${help('Affirmatively mark that even if an auto-todo WOULD have applied, it has been addressed.')}</label>
						<tag-list .defaultColor=${disableTODOColor} .tags=${todoOverridesDisabled} .previousTags=${todoOverridesPreviouslyDisabled} .disableNew=${true} .overrideTypeName=${'Disabled'} .editing=${true} .tagInfos=${TODO_AUTO_INFOS} @add-tag=${this._handleAddTodoOverrideDisabled} @remove-tag=${this._handleRemoveTodoOverride}></tag-list>
					</div>
					<div>
						<label>Auto TODO ${help('Todos that are automatically applied because of the values of the card. Add a Force Disable TODO to remove one of these if it doesn\'t apply.')}</label>
						<tag-list .defaultColor=${autoTODOColor} .tags=${this._autoTodos} .overrideTypeName=${'Auto TODO'} .tagInfos=${TODO_ALL_INFOS}></tag-list>
					</div>
				</div>
				<div class='row'>
					<div>
						<label>Editors ${help('Editors are people who should be able to edit this card.')}</label>
						<tag-list .overrideTypeName=${'Editor'} .tagInfos=${this._authors} .tags=${this._card.permissions[PERMISSION_EDIT_CARD]} .editing=${true} @remove-tag=${this._handleRemoveEditor} @add-tag=${this._handleAddEditor} .disableNew=${!this._isAdmin} @new-tag=${this._handleNewEditor} .excludeItems=${[this._card.author]}></tag-list>
					</div>
					<div>
						<label>Collaborators ${help('Collaborators are people who helped author the card. Collaborators are visible to all viewers of a card. By default any editor who edits a card is marked as a collaborator.')}</label>
						<tag-list .overrideTypeName=${'Collaborator'} .tagInfos=${this._authors} .tags=${this._card.collaborators} .editing=${true} @remove-tag=${this._handleRemoveCollaborator} @add-tag=${this._handleAddCollaborator} .disableNew=${!this._isAdmin} @new-tag=${this._handleNewCollaborator} .excludeItems=${[this._card.author]}></tag-list>
					</div>
				</div>
				<div class='row'>
					<div>
						<label>Missing Reciprocal Links ${help('These are cards that reference this one, but we don\'t yet reference in any way. If this is non-empty, then there will be an Auto TODO of reciprocal links. X one out to add a Non-substantive acknowledgement back to that card.')}</label>
						<tag-list .overrideTypeName=${'Link'} .tagInfos=${this._cardTagInfos} .defaultColor=${enableTODOColor} .tags=${cardMissingReciprocalLinks(this._card)} .editing=${true} .disableAdd=${true} @remove-tag=${this._handleAddAckReference}></tag-list>
					</div>
					<div>
						<select @change=${this._handleAddReference}>
							<option value=''><em>Add a reference to a card type...</option>
							${Object.entries(REFERENCE_TYPES).filter(entry => entry[1].editable).map(entry => html`<option value=${entry[0]} title=${entry[1].description} ?disabled=${!LEGAL_OUTBOUND_REFERENCES_BY_CARD_TYPE[this._card.card_type][entry[0]]}>${entry[1].name}</option>`)}
						</select>
					</div>
				</div>
				<div class='row'>
					${Object.entries(REFERENCE_TYPES).filter(entry => referencesMap[entry[0]]).map(entry => {
		return html`<div>
							<label>${entry[1].name} ${help(entry[1].description, false)} <button class='small' .referenceType=${entry[0]} @click=${this._handleRemoveAllReferencesOfTypeClicked} title=${'Remove all references of type ' + entry[1].name} >${HIGHLIGHT_OFF_ICON}</button></label>
							<tag-list .overrideTypeName=${'Reference'} .referenceType=${entry[0]} .tagInfos=${this._cardTagInfos} .defaultColor=${entry[1].color} .tags=${referencesMap[entry[0]]} .editing=${entry[1].editable} .subtle=${!entry[1].editable} .tapEvents=${true} .disableAdd=${true} @remove-tag=${this._handleRemoveReference}></tag-list>
						</div>`;
	})}
				</div>
			</div>
        </div>
        <div class='buttons'>
		  <h3>Editing</h3>
		  <div class='tabs main' @click=${this._handleTabClicked}>
			  <label name='${TAB_CONFIG}' ?selected=${this._selectedTab == TAB_CONFIG}>Configuration</label>
			  <label name='${TAB_CONTENT}' ?selected=${this._selectedTab == TAB_CONTENT}>Content</label>
		  </div>
		  <div class='flex'>
		  </div>
		  <div>
              <label>Full Bleed</label>
              <input type='checkbox' ?checked='${this._card.full_bleed}' @change='${this._handleFullBleedUpdated}'></input>
            </div>
		  <div>
            <label>Published</label>
            <input type='checkbox' .checked=${this._card.published} @change='${this._handlePublishedUpdated}'></input>
          </div>
          <div>
            <label>Substantive</label>
            <input type='checkbox' .checked=${this._substantive} @change='${this._handleSubstantiveChanged}'></input>
          </div>
          <button class='round' @click='${this._handleCancel}'>${CANCEL_ICON}</button>
		  <button class='round primary' @click=${this._handleMergeClicked} ?hidden=${!this._underlyingCardDifferences} title='${'The card you\'re editing has been changed by someone else:\n' + this._underlyingCardDifferences}'>${MERGE_TYPE_ICON}</button>
          <button class='round primary' @click='${this._handleCommit}' ?disabled=${this._underlyingCardDifferences} title=${this._underlyingCardDifferences ? 'You must merge underlying differences before saving' : 'Commit the changes you\'ve made'}>${SAVE_ICON}</button>
        </div>
      </div>
    `;
	}

	static get properties() { return {
		_card: { type: Object },
		_autoTodos: { type:Array },
		_active: {type: Boolean },
		_sectionsUserMayEdit: {type: Object },
		_userMayChangeEditingCardSection: { type:Boolean },
		_mayNotDeleteReason: {type:String},
		_substantive: {type: Object},
		_selectedTab: {type: String},
		_selectedEditorTab: {type:String},
		_tagInfos: {type: Object},
		_userMayEditSomeTags: { type: Boolean},
		_tagsUserMayNotEdit: { type: Array},
		_cardTagInfos: {type: Object},
		//The card before any edits
		_underlyingCard: {type:Object},
		_suggestedTags: { type: Array},
		_authors: { type:Object },
		_isAdmin: { type:Boolean },
		_pendingSlug: { type:String },
		_cardModificationPending: {type:Boolean},
		_suggestedConcepts: { type:Array },
		_underlyingCardDifferences: {type:String},
	};}

	stateChanged(state) {
		this._card= selectEditingCard(state);
		this._autoTodos = selectEditingCardAutoTodos(state);
		this._underlyingCard = selectEditingUnderlyingCardSnapshot(state);
		this._active = state.editor.editing;
		this._userMayChangeEditingCardSection = selectUserMayChangeEditingCardSection(state);
		this._sectionsUserMayEdit = selectSectionsUserMayEdit(state);
		this._mayNotDeleteReason = selectReasonsUserMayNotDeleteActiveCard(state);
		this._substantive = state.editor.substantive;
		this._selectedTab = state.editor.selectedTab;
		this._selectedEditorTab = state.editor.selectedEditorTab;
		this._tagInfos = selectTags(state);
		this._userMayEditSomeTags = selectUserMayEditSomeTags(state);
		this._tagsUserMayNotEdit = tagsUserMayNotEdit(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		//skip the expensive selectors if we're not active
		this._suggestedTags = this._active ? selectEditingCardSuggestedTags(state) : [];
		this._suggestedConcepts = this._active ? selectEditingCardSuggestedConceptReferences(state) : [];
		this._authors = selectAuthorsForTagList(state);
		this._isAdmin = selectUserIsAdmin(state);
		this._pendingSlug = selectPendingSlug(state);
		this._cardModificationPending = selectCardModificationPending(state);
		this._underlyingCardDifferences = selectEditingUnderlyingCardSnapshotDiffDescription(state);
	}

	shouldUpdate() {
		return this._active;
	}

	firstUpdated() {
		document.addEventListener('keydown', e => this._handleKeyDown(e));
	}

	_handleSuggestedConceptTapped(e) {
		const cardID = e.detail.tag;
		store.dispatch(addReferenceToCard(cardID, REFERENCE_TYPE_CONCEPT));
	}

	_handleMergeClicked() {
		store.dispatch(mergeUpdatedUnderlyingCard(false));
	}

	_handleAddAllConceptsClicked() {
		for (const cardID of this._suggestedConcepts) {
			store.dispatch(addReferenceToCard(cardID, REFERENCE_TYPE_CONCEPT));
		}
	}

	_handleIgnoreAllConceptsClicked() {
		for (const cardID of this._suggestedConcepts) {
			store.dispatch(addReferenceToCard(cardID, REFERENCE_TYPE_ACK));
		}
	}

	_handleRemoveAllReferencesOfTypeClicked(e) {
		let referenceType = '';
		for (const ele of e.composedPath()) {
			if (ele.referenceType) {
				referenceType = ele.referenceType;
				break;
			}
		}
		if (!referenceType) return;
		const ids = references(this._card).byTypeArray()[referenceType];
		if (!ids) return;
		for (const cardID of ids) {
			store.dispatch(removeReferenceFromCard(cardID, referenceType));
		}
	}

	_handleCardTypeChanged(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(cardTypeUpdated(ele.value));
	}

	_handleDeleteClicked() {
		store.dispatch(deleteCard(this._card));
	}

	_handleAddReference(e) {
		const ele = e.composedPath()[0];
		if (!ele.value) return;
		const value = ele.value;
		//Set it back to default
		ele.value = '';
		store.dispatch(selectCardToReference(value));
	}

	_handleAddAckReference(e) {
		const cardID = e.detail.tag;
		store.dispatch(addReferenceToCard(cardID, REFERENCE_TYPE_ACK));
	}

	_handleRemoveReference(e) {
		const cardID = e.detail.tag;
		let referenceType = '';
		//Walk up the chain to find which tag-list has it (which will have the
		//referenceType we set explicitly on it)
		for (let ele of e.composedPath()) {
			if (ele.referenceType) {
				referenceType = ele.referenceType;
				break;
			}
		}
		if (!referenceType) {
			console.warn('No reference type found on parents');
		}
		store.dispatch(removeReferenceFromCard(cardID, referenceType));
	}

	_handleTabClicked(e) {
		const ele = e.path[0];
		if (!ele) return;
		const name = ele.getAttribute('name');
		if (!name) return;
		store.dispatch(editingSelectTab(name));
	}

	_handleEditorTabClicked(e) {
		const ele = e.path[0];
		if (!ele) return;
		const name = ele.getAttribute('name');
		if (!name) return;
		store.dispatch(editingSelectEditorTab(name));
	}

	_handleNewTag() {
		let name = prompt('What is the base name of the tag?');
		if (!name) return;
		let displayName = prompt('What is the display name for the tag?', name);
		if (!displayName) return;
		store.dispatch(createTag(name, displayName));
	}

	_handleAddTag(e) {
		store.dispatch(tagAdded(e.detail.tag));
	}

	_handleRemoveTag(e) {
		store.dispatch(tagRemoved(e.detail.tag));
	}

	_handleAddEditor(e) {
		store.dispatch(editorAdded(e.detail.tag));
	}

	_handleRemoveEditor(e) {
		store.dispatch(editorRemoved(e.detail.tag));
	}

	_handleNewEditor() {
		this._addNewEditorOrCollaborator(true);
	}

	_handleAddCollaborator(e) {
		store.dispatch(collaboratorAdded(e.detail.tag));
	}

	_handleRemoveCollaborator(e) {
		store.dispatch(collaboratorRemoved(e.detail.tag));
	}

	_handleNewCollaborator() {
		this._addNewEditorOrCollaborator(false);
	}

	_addNewEditorOrCollaborator(isEditor) {
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

	_handleAddTodoOverrideEnabled(e) {
		store.dispatch(autoTodoOverrideEnabled(e.detail.tag));
	}

	_handleAddTodoOverrideDisabled(e) {
		store.dispatch(autoTodoOverrideDisabled(e.detail.tag));
	}

	_handleRemoveTodoOverride(e) {
		store.dispatch(autoTodoOverrideRemoved(e.detail.tag));
	}

	_handleKeyDown(e) {
		//We have to hook this to issue content editable commands when we're
		//active. But most of the time we don't want to do anything.
		if (!this._active) return;
		if (!e.metaKey && !e.ctrlKey) return;

		if (e.shiftKey && e.key == 'c') {
			this._handleAddAllConceptsClicked();
			return killEvent(e);
		}

		if (e.shiftKey && e.key == 'i') {
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
			store.dispatch(findCardToLink(document.getSelection().toString()));
			return killEvent(e);
		}
	}

	_handleTextFieldUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(textFieldUpdated(ele.field, ele.value, false));
	}

	textFieldUpdatedFromContentEditable(field, value) {
		store.dispatch(textFieldUpdated(field, value, true));
	}

	disabledCardHighlightClicked(cardID, alternate) {
		if (!this._active) return;
		if(alternate) {
			store.dispatch(addReferenceToCard(cardID, REFERENCE_TYPE_CONCEPT));
		} else {
			store.dispatch(removeReferenceFromCard(cardID, REFERENCE_TYPE_CONCEPT));
		}
	}

	_handleNotesUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(notesUpdated(ele.value));
	}

	_handleTodoUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(todoUpdated(ele.value));
	}

	_handleSectionUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(sectionUpdated(ele.value));
	}

	_handleNameUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(nameUpdated(ele.value));
	}

	_handleAddSlug() {
		if (!this._active) return;
		if (!this._card) return;
		let id = this._card.id;
		let value = prompt('Slug to add:', createSlugFromArbitraryString(this._card.title || ''));
		if (!value) return;
		store.dispatch(addSlug(id, value));
	}

	_handleFullBleedUpdated(e) {
		if(!this._active) return; 
		let ele = e.composedPath()[0];
		store.dispatch(fullBleedUpdated(ele.checked));
	}

	_handlePublishedUpdated(e) {
		if(!this._active) return; 
		let ele = e.composedPath()[0];
		store.dispatch(publishedUpdated(ele.checked));
	}

	_handleSubstantiveChanged(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(substantiveUpdated(ele.checked));
	}

	_handleCommit() {
		store.dispatch(editingCommit());
	}

	_handleCancel() {
		store.dispatch(editingFinish());
	}

}

window.customElements.define('card-editor', CardEditor);
