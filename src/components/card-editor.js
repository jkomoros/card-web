import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	addSlug,
	createTag,
} from '../actions/data.js';

import {
	selectTags,
	selectActiveCard,
	selectEditingCard,
	selectEditingCardAutoTodos,
	selectEditingCardSuggestedTags,
	selectAuthorsForTagList,
	selectUserIsAdmin,
	selectTagInfosForCards,
	selectUserMayEditSomeTags,
	tagsUserMayNotEdit,
	selectSectionsUserMayEdit,
	selectUserMayChangeEditingCardSection
} from '../selectors.js';

import {
	editingFinish,
	editingCommit,
	titleUpdated,
	notesUpdated,
	bodyUpdated,
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

	TAB_CONTENT,
	TAB_CONFIG,
	EDITOR_TAB_CONTENT,
	EDITOR_TAB_NOTES,
	EDITOR_TAB_TODO,
	autoTodoOverrideDisabled,
	skippedLinkInboundAdded,
	skippedLinkInboundRemoved,
	editorAdded,
	editorRemoved,
	collaboratorAdded,
	collaboratorRemoved,
	manualEditorAdded,
	manualCollaboratorAdded
} from '../actions/editor.js';

import {
	SAVE_ICON,
	CANCEL_ICON
} from './my-icons.js';

import {
	killEvent, 
	cardHasContent, 
	cardHasNotes,
	cardHasTodo,
	cardMissingReciprocalLinks
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

import './tag-list.js';

class CardEditor extends connect(store)(LitElement) {
	render() {

		const hasContent = cardHasContent(this._card);
		const hasNotes = cardHasNotes(this._card);
		const hasTodo = cardHasTodo(this._card);
		const contentModified = this._card.body != this._underlyingCard.body;
		const notesModified = this._card.notes != this._underlyingCard.notes;
		const todoModified = this._card.todo != this._underlyingCard.todo;

		const todoOverridesEnabled = Object.entries(this._card.auto_todo_overrides).filter(entry => entry[1] == true).map(entry => entry[0]);
		const todoOverridesPreviouslyEnabled = Object.entries(this._underlyingCard.auto_todo_overrides).filter(entry => entry[1] == true).map(entry => entry[0]);
		const todoOverridesDisabled = Object.entries(this._card.auto_todo_overrides).filter(entry => entry[1] == false).map(entry => entry[0]);
		const todoOverridesPreviouslyDisabled = Object.entries(this._underlyingCard.auto_todo_overrides).filter(entry => entry[1] == false).map(entry => entry[0]);

		
		const enableTODOColor = '#b22222'; //firebrick
		//When you're disabling a TODO, you're marking it done, so it should be green.
		const disableTODOColor = '#006400'; //darkgreen
		const autoTODOColor = '#cc9494'; //firebrick, but less saturated and lighter

		return html`
      ${ButtonSharedStyles}
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

		[hidden] {
          display:none;
        }

      </style>
      <div class='container'>
        <div class='inputs'>
          <div>
            <label>Title</label>
            <input type='text' @input='${this._handleTitleUpdated}' .value=${this._card.title}></input>
		  </div>
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
			<textarea ?hidden=${this._selectedEditorTab !== EDITOR_TAB_CONTENT} @input='${this._handleBodyUpdated}' .value=${this._card.body}></textarea>
			<textarea ?hidden=${this._selectedEditorTab !== EDITOR_TAB_NOTES} @input='${this._handleNotesUpdated}' .value=${this._card.notes}></textarea>
			<textarea ?hidden=${this._selectedEditorTab !== EDITOR_TAB_TODO} @input='${this._handleTodoUpdated}' .value=${this._card.todo}></textarea>
		  </div>
		  <div ?hidden=${this._selectedTab !== TAB_CONFIG}>
			<div class='row'>
				<div>
				<label>Section</label>
				${this._userMayChangeEditingCardSection ? 
		html`<select @change='${this._handleSectionUpdated}' .value=${this._card.section}>
					${repeat(Object.values(this._sectionsUserMayEdit), (item) => item, (item) => html`
					<option value="${item.id}" ?selected=${item.id == this._card.section}>${item.title}</option>`)}
					<option value='' ?selected=${this._card.section == ''}>[orphaned]</option>
				</select>` : html`<em>${this._card.section}</em>`}
				</div>
				<div>
				<Label>Slugs</label>
				<select .value=${this._card.name} @change='${this._handleNameUpdated}'>
					${repeat([this._card.id, ...this._card.slugs], (item) => item, (item) => html`
					<option value="${item}" ?selected=${item == this._card.name}>${item}</option>`)}
				</select>
				<button @click='${this._handleAddSlug}'>+</button>
				</div>
				<div>
					<label>Tags</label>
					<tag-list .tags=${this._card.tags} .previousTags=${this._underlyingCard ? this._underlyingCard.tags : null} .editing=${this._userMayEditSomeTags} .excludeItems=${this._tagsUserMayNotEdit} .tagInfos=${this._tagInfos} @add-tag=${this._handleAddTag} @remove-tag=${this._handleRemoveTag} @new-tag=${this._handleNewTag}></tag-list>
				</div>
				<div>
					<label>Suggested Tags</label>
					<tag-list .tags=${this._suggestedTags} .tagInfos=${this._tagInfos} .subtle=${true} .tapEvents=${true} @tag-tapped=${this._handleAddTag}></tag-list>
				</div>
			</div>
				<div class='row'>
					<div>
						<label>Force Enable TODO</label>
						<tag-list .defaultColor=${enableTODOColor} .tags=${todoOverridesEnabled} .previousTags=${todoOverridesPreviouslyEnabled} .disableNew=${true} .overrideTypeName=${'Enabled'} .editing=${true} .tagInfos=${TODO_AUTO_INFOS} @add-tag=${this._handleAddTodoOverrideEnabled} @remove-tag=${this._handleRemoveTodoOverride}></tag-list>
					</div>
					<div>
						<label>Force Disable TODO</label>
						<tag-list .defaultColor=${disableTODOColor} .tags=${todoOverridesDisabled} .previousTags=${todoOverridesPreviouslyDisabled} .disableNew=${true} .overrideTypeName=${'Disabled'} .editing=${true} .tagInfos=${TODO_AUTO_INFOS} @add-tag=${this._handleAddTodoOverrideDisabled} @remove-tag=${this._handleRemoveTodoOverride}></tag-list>
					</div>
					<div>
						<label>Auto TODO</label>
						<tag-list .defaultColor=${autoTODOColor} .tags=${this._autoTodos} .overrideTypeName=${'Auto TODO'} .tagInfos=${TODO_ALL_INFOS}></tag-list>
					</div>
				</div>
				<div class='row'>
					<div>
						<label>Missing Reciprocal Links</label>
						<tag-list .overrideTypeName=${'Link'} .tagInfos=${this._cardTagInfos} .defaultColor=${enableTODOColor} .tags=${cardMissingReciprocalLinks(this._card)} .editing=${true} .disableAdd=${true} @add-tag=${this._handleRemoveSkippedLinkInbound} @remove-tag=${this._handleAddSkippedLinkInbound}></tag-list>
					</div>
					<div>
						<label>Skipped Reciprocal Links</label>
						<tag-list .overrideTypeName=${'Link'} .tagInfos=${this._cardTagInfos} .defaultColor=${disableTODOColor} .tags=${this._card.auto_todo_skipped_links_inbound} .editing=${true} .disableAdd=${true} @remove-tag=${this._handleRemoveSkippedLinkInbound} @add-tag=${this._handleAddSkippedLinkInbound}></tag-list>
					</div>
					<div>
						<label>Editors</label>
						<tag-list .overrideTypeName=${'Editor'} .tagInfos=${this._authors} .tags=${this._card.permissions[PERMISSION_EDIT_CARD]} .editing=${true} @remove-tag=${this._handleRemoveEditor} @add-tag=${this._handleAddEditor} .disableNew=${!this._isAdmin} @new-tag=${this._handleNewEditor} .excludeItems=${[this._card.author]}></tag-list>
					</div>
					<div>
						<label>Collaborators</label>
						<tag-list .overrideTypeName=${'Collaborator'} .tagInfos=${this._authors} .tags=${this._card.collaborators} .editing=${true} @remove-tag=${this._handleRemoveCollaborator} @add-tag=${this._handleAddCollaborator} .disableNew=${!this._isAdmin} @new-tag=${this._handleNewCollaborator} .excludeItems=${[this._card.author]}></tag-list>
					</div>
				</div>
			</div>
        </div>
        <div class='buttons'>
		  <h3>Editing</h3>
		  <div class='tabs' @click=${this._handleTabClicked}>
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
          <button class='round primary' @click='${this._handleCommit}'>${SAVE_ICON}</button>
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
	};}

	stateChanged(state) {
		this._card= selectEditingCard(state);
		this._autoTodos = selectEditingCardAutoTodos(state);
		this._underlyingCard = selectActiveCard(state);
		this._active = state.editor.editing;
		this._userMayChangeEditingCardSection = selectUserMayChangeEditingCardSection(state);
		this._sectionsUserMayEdit = selectSectionsUserMayEdit(state);
		this._substantive = state.editor.substantive;
		this._selectedTab = state.editor.selectedTab;
		this._selectedEditorTab = state.editor.selectedEditorTab;
		this._tagInfos = selectTags(state);
		this._userMayEditSomeTags = selectUserMayEditSomeTags(state);
		this._tagsUserMayNotEdit = tagsUserMayNotEdit(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		//skip the expensive selector if we're not active
		this._suggestedTags = this._active ? selectEditingCardSuggestedTags(state) : [];
		this._authors = selectAuthorsForTagList(state);
		this._isAdmin = selectUserIsAdmin(state);
	}

	shouldUpdate() {
		return this._active;
	}

	firstUpdated() {
		document.addEventListener('keydown', e => this._handleKeyDown(e));
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

	_handleAddSkippedLinkInbound(e) {
		store.dispatch(skippedLinkInboundAdded(e.detail.tag));
	}

	_handleRemoveSkippedLinkInbound(e) {
		//This has to be supported so the user can click a tag again to add it
		//after removing it, even though free-form add tag is disabled.
		store.dispatch(skippedLinkInboundRemoved(e.detail.tag));
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

	_handleTitleUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		store.dispatch(titleUpdated(ele.value, false));
	}

	bodyUpdatedFromContentEditable(html) {
		this._bodyUpdated(html, true);
	}

	titleUpdatedFromContentEditable(text) {
		store.dispatch(titleUpdated(text, true));
	}

	_bodyUpdated(html, fromContentEditable) {
		store.dispatch(bodyUpdated(html, fromContentEditable));
	}

	_handleBodyUpdated(e) {
		if (!this._active) return;
		let ele = e.composedPath()[0];
		this._bodyUpdated(ele.value, false);
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
		let value = prompt('Slug to add:');
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
