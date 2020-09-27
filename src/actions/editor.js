export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';
export const EDITING_SELECT_TAB = 'EDITING_SELECT_TAB';
export const EDITING_SELECT_EDITOR_TAB = 'EDITING_SELECT_EDITOR_TAB';
export const EDITING_TEXT_FIELD_UPDATED = 'EDITING_TEXT_FIELD_UPDATED';
export const EDITING_SECTION_UPDATED = 'EDITING_SECTION_UPDATED';
export const EDITING_SLUG_ADDED = 'EDITING_SLUG_ADDED';
export const EDITING_NAME_UPDATED = 'EDITING_NAME_UPDATED';
export const EDITING_SUBSTANTIVE_UPDATED = 'EDITING_SUBSTANTIVE_UPDATED';
export const EDITING_PUBLISHED_UPDATED = 'EDITING_PUBLISHED_UPDATED';
export const EDITING_FULL_BLEED_UPDATED = 'EDITING_FULL_BLEED_UPDATED';
export const EDITING_NOTES_UPDATED = 'EDITING_NOTES_UPDATED';
export const EDITING_TODO_UPDATED = 'EDITING_TODO_UPDATED';
export const EDITING_AUTO_TODO_OVERRIDE_ENABLED = 'EDITING_AUTO_TODO_OVERRIDE_ENABLED';
export const EDITING_AUTO_TODO_OVERRIDE_DISABLED = 'EDITING_AUTO_TODO_OVERRIDE_DISABLED';
export const EDITING_AUTO_TODO_OVERRIDE_REMOVED = 'EDITING_AUTO_TODO_OVERRIDE_REMOVED';
export const EDITING_TAG_ADDED = 'EDITING_TAG_ADDED';
export const EDITING_TAG_REMOVED = 'EDITING_TAG_REMOVED';
export const EDITING_SKIPPED_LINK_INBOUND_ADDED = 'EDITING_SKIPPED_LINK_INBOUND_ADDED';
export const EDITING_SKIPPED_LINK_INBOUND_REMOVED = 'EDITING_SKIPPED_LINK_INBOUND_REMOVED';
export const EDITING_EXTRACT_LINKS = 'EDITING_EXTRACT_LINKS';
export const EDITING_EDITOR_ADDED = 'EDITING_EDITOR_ADDED';
export const EDITING_EDITOR_REMOVED = 'EDITING_EDITOR_REMOVED';
export const EDITING_COLLABORATOR_ADDED = 'EDITING_COLLABORATOR_ADDED';
export const EDITING_COLLABORATOR_REMOVED = 'EDITING_COLLABORATOR_REMOVED';

export const TAB_CONTENT = 'content';
export const TAB_CONFIG = 'config';

export const EDITOR_TAB_CONTENT = 'content';
export const EDITOR_TAB_NOTES = 'notes';
export const EDITOR_TAB_TODO = 'todo';

import {
	selectActiveCard,
	selectUserMayEditActiveCard,
	selectEditingCard,
	selectSections,
	selectUid,
	selectPendingSlug
} from '../selectors.js';

import {
	modifyCard
} from './data.js';

import {
	TEXT_FIELD_CONFIGURATION
} from '../card_fields.js';

import {
	arrayDiff,
	cardHasContent,
	triStateMapDiff,
} from '../util.js';

import {
	normalizeBodyHTML
} from '../contenteditable.js';

import {
	createAuthorStub
} from './comments.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

let lastReportedSelectionRange = null;
//TODO: figure out a pattenr that doesn't have a single shared global
let savedSelectionRange = null;

//selection range is weird; you can only listen for changes at the document
//level, but selections wihtin a shadow root are hidden from outside. Certain
//opeartions, like execCommand, operate on a selection state--but if you have
//to do actions in between, like pop a dialog to ask follow-up questions--your
//selection will be lost. The solution we go with is that elements who might
//have a content editable target (e.g. content-card in editing mode) report
//their selected ranged when they have one here, globally.
export const reportSelectionRange = (range) => {
	lastReportedSelectionRange = range;
};

export const saveSelectionRange = () => {
	savedSelectionRange = lastReportedSelectionRange;
};

export const restoreSelectionRange = () => {
	let selection = document.getSelection();
	selection.removeAllRanges();
	selection.addRange(savedSelectionRange);
};

export const savedSelectionRangeIsLink = () => {
	if (!savedSelectionRange) return false;
	if (savedSelectionRange.startContainer && savedSelectionRange.startContainer.parentElement && savedSelectionRange.startContainer.parentElement.localName == 'a') return true;
	if (savedSelectionRange.endContainer && savedSelectionRange.endContainer.parentElement && savedSelectionRange.endContainer.parentElement.localName == 'a') return true;
	return false;
};

export const editingSelectTab = (tab) => {
	return {
		type: EDITING_SELECT_TAB,
		tab,
	};
};

export const editingSelectEditorTab = (tab) => {
	return {
		type: EDITING_SELECT_EDITOR_TAB,
		tab,
	};
};

export const editingStart = () => (dispatch, getState) => {
	const state = getState();
	if (!selectUserMayEditActiveCard(state)) {
		console.warn('This user is not allowed to edit!');
		return;
	}
	const card = selectActiveCard(state);
	if (!card || !card.id) {
		console.warn('There doesn\'t appear to be an active card.');
		return;
	}
	dispatch({type: EDITING_START, card: card});
};

export const editingCommit = () => (dispatch, getState) => {
	const state = getState();
	if (!selectUserMayEditActiveCard(state)) {
		console.warn('This user isn\'t allowed to edit!');
		return;
	}
	if (selectPendingSlug(state)) {
		if (!confirm('There is a slug pending that is not yet added. Continue?')) {
			return;
		}
	}
	const underlyingCard = selectActiveCard(state);
	if (!underlyingCard || !underlyingCard.id) {
		console.warn('That card isn\'t legal');
		return;
	}

	const updatedCard = selectEditingCard(state);

	if (cardHasContent(updatedCard) && !updatedCard.published) {
		if (!window.confirm('The card has content but is unpublished. Do you want to continue?')) return;
	}

	let update = {};

	for (let field of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		if (updatedCard[field] == underlyingCard[field]) continue;
		const config = TEXT_FIELD_CONFIGURATION[field];
		let value = updatedCard[field];
		if (config.html) {
			try {    
				value = normalizeBodyHTML(value);
			} catch(err) {
				alert('Couldn\'t save: invalid HTML: ' + err);
				return;
			}
		}
		update[field] = value;
	}

	if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
	if (updatedCard.name != underlyingCard.section) update.name = updatedCard.name;
	if (updatedCard.notes != underlyingCard.notes) update.notes = updatedCard.notes;
	if (updatedCard.todo != underlyingCard.todo) update.todo = updatedCard.todo;
	if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;
	if (updatedCard.published !== underlyingCard.published) update.published = updatedCard.published;

	let [todoEnablements, todoDisablements, todoRemovals] = triStateMapDiff(underlyingCard.auto_todo_overrides || {}, updatedCard.auto_todo_overrides || {});
	if (todoEnablements.length) update.auto_todo_overrides_enablements = todoEnablements;
	if (todoDisablements.length) update.auto_todo_overrides_disablements = todoDisablements;
	if (todoRemovals.length) update.auto_todo_overrides_removals = todoRemovals;

	let [tagAdditions, tagDeletions] = arrayDiff(underlyingCard.tags || [], updatedCard.tags || []);
	if (tagAdditions.length) update.addTags = tagAdditions;
	if (tagDeletions.length) update.removeTags = tagDeletions;

	let [skippedLinksInboundAdditions, skippedLinksInboundDeletions] = arrayDiff(underlyingCard.auto_todo_skipped_links_inbound || [], updatedCard.auto_todo_skipped_links_inbound || []);
	if (skippedLinksInboundAdditions.length) update.add_skipped_link_inbound = skippedLinksInboundAdditions;
	if (skippedLinksInboundDeletions.length) update.remove_skipped_link_inbound = skippedLinksInboundDeletions;
	
	let [editorAdditions, editorDeletions] = arrayDiff(underlyingCard.permissions[PERMISSION_EDIT_CARD] || [], updatedCard.permissions[PERMISSION_EDIT_CARD] || []);
	if (editorAdditions.length) update.add_editors = editorAdditions;
	if (editorDeletions.length) update.remove_editors = editorDeletions;

	let [collaboratorAdditions, collaboratorDeletions] = arrayDiff(underlyingCard.collaborators || [], updatedCard.collaborators || []);
	if (collaboratorAdditions.length) update.add_collaborators = collaboratorAdditions;
	if (collaboratorDeletions.length) update.remove_collaborators = collaboratorDeletions;

	//modifyCard will fail if the update is a no-op.
	dispatch(modifyCard(underlyingCard, update, state.editor.substantive));

};

export const linkURL = (href) => (dispatch, getState) => {
	const state = getState();
	if (!state.editor.editing) return;
	//TODO: it's weird we do this here, it really should be done on the card-
	//editor component.
	restoreSelectionRange();
	if (href) {
		document.execCommand('createLink', null, href);
	} else {
		document.execCommand('unlink');
	}
};

export const linkCard = (cardID) => (dispatch, getState) => {
	const state = getState();
	if (!state.editor.editing) return;
	//TODO: it's weird we do this here, it really should be done on the card-
	//editor component.
	restoreSelectionRange();
	document.execCommand('createLink', null, cardID);
};

export const editingFinish = () => {
	return {type: EDITING_FINISH};
};

export const notesUpdated = (newNotes) => {
	return {
		type: EDITING_NOTES_UPDATED,
		notes:newNotes,
	};
};

export const todoUpdated = (newTodo) => {
	return {
		type: EDITING_TODO_UPDATED,
		todo: newTodo,
	};
};

var extractLinksTimeout;

export const textFieldUpdated = (fieldName, value, fromContentEditable) => (dispatch) => {
	if (!fromContentEditable) fromContentEditable = false;

	const config = TEXT_FIELD_CONFIGURATION[fieldName] || {};

	if (config.html) {
		//Make sure we have a timeout to extract links a bit of time after the last edit was made.
		if (extractLinksTimeout) window.clearTimeout(extractLinksTimeout);
		extractLinksTimeout = window.setTimeout(() => {
			extractLinksTimeout = 0;
			dispatch({type: EDITING_EXTRACT_LINKS});
		}, 1000);

		//We only run it if it's coming from contentEditable because
		//normalizeBodyHTML assumes the contnet is valid HTML, and if it's been
		//updated in the editor textbox, and for example the end says `</p`,
		//then it's not valid HTML.
		value = fromContentEditable ? normalizeBodyHTML(value) : value;
	}

	dispatch({
		type: EDITING_TEXT_FIELD_UPDATED,
		fieldName: fieldName,
		skipUpdatingNormalizedFields: config.html,
		value: value,
		fromContentEditable
	});
};

export const sectionUpdated = (newSection) => (dispatch, getState) => {
	const state = getState();
	const baseCard = selectActiveCard(state);
	const sections = selectSections(state);
	const currentlySubstantive = state.editor.substantive;
	if (baseCard && sections) {
		const oldSection = baseCard.section;
		let sectionKeys = Object.keys(sections);
		let oldSectionIndex = 1000;
		let newSectionIndex = 1000;
		for (let i = 0; i < sectionKeys.length; i++) {
			let sectionKey = sectionKeys[i];
			if (oldSection == sectionKey) oldSectionIndex = i;
			if (newSection == sectionKey) newSectionIndex = i;
		}

		//If the card has been moved to a more-baked section than before, set
		//substantive. If substantive is set and the section is being set back
		//to what it was, unset substantive.
		if (newSectionIndex < oldSectionIndex && !currentlySubstantive) {
			dispatch(substantiveUpdated(true, true));
		} else if(newSectionIndex == oldSectionIndex && currentlySubstantive) {
			dispatch(substantiveUpdated(false, true));
		}
	}

	dispatch({
		type: EDITING_SECTION_UPDATED,
		section: newSection
	});
};

export const slugAdded = (newSlug) => {
	return {
		type: EDITING_SLUG_ADDED,
		slug: newSlug
	};
};

export const nameUpdated = (newName) => {
	return {
		type: EDITING_NAME_UPDATED,
		name: newName
	};
};

export const substantiveUpdated = (checked, auto) => (dispatch, getState) => {

	const state = getState();
	const editingCard = selectEditingCard(state);
	const uid = selectUid(state);
	if (editingCard && uid && editingCard.author != uid) {
		if (checked) {
			dispatch(collaboratorAdded(uid, true));
		} else {
			dispatch(collaboratorRemoved(uid, true));
		}
	}


	dispatch({
		type: EDITING_SUBSTANTIVE_UPDATED,
		checked,
		auto
	});
};

export const publishedUpdated = (published) => (dispatch, getState) => {

	const state = getState();
	const baseCard = selectActiveCard(state);
	const currentlySubstantive = state.editor.substantive;

	//If the base card wasn't published, and now is, and substantive isn't
	//already checked, check it. If we're setting to unpublished (as base card
	//is) and we're currently substantive, uncheck it.
	if (baseCard && !baseCard.published) {
		if (!currentlySubstantive && published) {
			dispatch(substantiveUpdated(true, true));
		} else if(currentlySubstantive && !published) {
			dispatch(substantiveUpdated(false, true));
		}
	}

	dispatch({
		type: EDITING_PUBLISHED_UPDATED,
		published,
	});
};

export const fullBleedUpdated = (fullBleed) => {
	return {
		type: EDITING_FULL_BLEED_UPDATED,
		fullBleed
	};
};

export const autoTodoOverrideEnabled = (todo) => {
	return {
		type: EDITING_AUTO_TODO_OVERRIDE_ENABLED,
		todo
	};
};

export const autoTodoOverrideDisabled = (todo) => {
	return {
		type: EDITING_AUTO_TODO_OVERRIDE_DISABLED,
		todo
	};
};

export const autoTodoOverrideRemoved = (todo) => {
	return {
		type: EDITING_AUTO_TODO_OVERRIDE_REMOVED,
		todo
	};
};

export const tagAdded = (tag) => {
	return {
		type: EDITING_TAG_ADDED,
		tag
	};
};

export const tagRemoved = (tag) => {
	return {
		type: EDITING_TAG_REMOVED,
		tag
	};
};

export const skippedLinkInboundAdded = (link) => {
	return {
		type: EDITING_SKIPPED_LINK_INBOUND_ADDED,
		link
	};
};

export const skippedLinkInboundRemoved = (link) => {
	return {
		type: EDITING_SKIPPED_LINK_INBOUND_REMOVED,
		link
	};
};

export const editorAdded = (editorUid) => (dispatch, getState) => {
	const card = selectEditingCard(getState());
	if (!card) return;
	if (editorUid == card.author) {
		console.log('The given editor is already the author');
		return;
	}
	dispatch({
		type: EDITING_EDITOR_ADDED,
		editor:editorUid
	});
};

export const editorRemoved = (editorUid) => {
	return {
		type: EDITING_EDITOR_REMOVED,
		editor:editorUid
	};
};

export const manualEditorAdded = (editorUid) => {
	createAuthorStub(editorUid);
	return editorAdded(editorUid);
};

export const collaboratorAdded = (collaboratorUid, auto) => (dispatch, getState) => {
	const card = selectEditingCard(getState());
	if (!card) return;
	if (collaboratorUid == card.author) {
		console.log('The given collaborator is already the author');
		return;
	}
	dispatch({
		type: EDITING_COLLABORATOR_ADDED,
		collaborator:collaboratorUid,
		auto
	});
};

export const collaboratorRemoved = (collaboratorUid, auto) => {
	return {
		type: EDITING_COLLABORATOR_REMOVED,
		collaborator:collaboratorUid,
		auto
	};
};

export const manualCollaboratorAdded = (collaboratorUid) => {
	createAuthorStub(collaboratorUid);
	return collaboratorAdded(collaboratorUid);
};
