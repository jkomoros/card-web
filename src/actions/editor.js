export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';
export const EDITING_SELECT_TAB = 'EDITING_SELECT_TAB';
export const EDITING_SELECT_EDITOR_TAB = 'EDITING_SELECT_EDITOR_TAB';
export const EDITING_TEXT_FIELD_UPDATED = 'EDITING_TEXT_FIELD_UPDATED';
export const EDITING_SECTION_UPDATED = 'EDITING_SECTION_UPDATED';
export const EDITING_SLUG_ADDED = 'EDITING_SLUG_ADDED';
export const EDITING_NAME_UPDATED = 'EDITING_NAME_UPDATED';
export const EDITING_SUBSTANTIVE_UPDATED = 'EDITING_SUBSTANTIVE_UPDATED';
export const EDITING_CARD_TYPE_UPDATED = 'EDITING_CARD_TYPE_UPDATED';
export const EDITING_PUBLISHED_UPDATED = 'EDITING_PUBLISHED_UPDATED';
export const EDITING_FULL_BLEED_UPDATED = 'EDITING_FULL_BLEED_UPDATED';
export const EDITING_NOTES_UPDATED = 'EDITING_NOTES_UPDATED';
export const EDITING_TODO_UPDATED = 'EDITING_TODO_UPDATED';
export const EDITING_AUTO_TODO_OVERRIDE_ENABLED = 'EDITING_AUTO_TODO_OVERRIDE_ENABLED';
export const EDITING_AUTO_TODO_OVERRIDE_DISABLED = 'EDITING_AUTO_TODO_OVERRIDE_DISABLED';
export const EDITING_AUTO_TODO_OVERRIDE_REMOVED = 'EDITING_AUTO_TODO_OVERRIDE_REMOVED';
export const EDITING_TAG_ADDED = 'EDITING_TAG_ADDED';
export const EDITING_TAG_REMOVED = 'EDITING_TAG_REMOVED';
export const EDITING_EXTRACT_LINKS = 'EDITING_EXTRACT_LINKS';
export const EDITING_EDITOR_ADDED = 'EDITING_EDITOR_ADDED';
export const EDITING_EDITOR_REMOVED = 'EDITING_EDITOR_REMOVED';
export const EDITING_COLLABORATOR_ADDED = 'EDITING_COLLABORATOR_ADDED';
export const EDITING_COLLABORATOR_REMOVED = 'EDITING_COLLABORATOR_REMOVED';
export const EDITING_START_REFERENCE_CARD = 'EDITING_START_REFERENCE_CARD';
export const EDITING_RESET_REFERENCE_CARD = 'EDITING_RESET_REFERENCE_CARD';
export const EDITING_ADD_REFERENCE = 'EDITING_ADD_REFERENCE';
export const EDITING_REMOVE_REFERENCE = 'EDITING_REMOVE_REFERENCE';
export const EDITING_ADD_IMAGE_URL = 'EDITING_ADD_IMAGE_URL';
export const EDITING_REMOVE_IMAGE_AT_INDEX = 'EDITING_REMOVE_IMAGE_AT_INDEX';
export const EDITING_CHANGE_IMAGE_PROPERTY = 'EDITING_CHANGE_IMAGE_PROPERTY';
export const EDITING_OPEN_IMAGE_PROPERTIES_DIALOG = 'EDITING_OPEN_IMAGE_PROPERTIES_DIALOG';
export const EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG = 'EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG';
export const EDITING_OPEN_IMAGE_BROWSER_DIALOG = 'EDITING_OPEN_IMAGE_BROWSER_DIALOG';
export const EDITING_CLOSE_IMAGE_BROWSER_DIALOG = 'EDITING_CLOSE_IMAGE_BROWSER_DIALOG';

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
	selectPendingSlug,
	selectIsEditing,
	selectEditingPendingReferenceType,
	getCardExists,
	getCardType,
	selectEditingCardSuggestedConceptReferences,
} from '../selectors.js';

import {
	modifyCard
} from './data.js';

import {
	CARD_TYPE_CONFIGURATION,
	TEXT_FIELD_CONFIGURATION,
	fontSizeBoosts,
	REFERENCE_TYPES,
} from '../card_fields.js';

import {
	references
} from '../references.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from '../card_finishers.js';

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

import {
	findCardToReference
} from './find.js';

import {
	UNION_FILTER_DELIMITER
} from '../filters.js';

import {
	imageBlocksEquivalent,
	getImageDimensionsForImageAtURL,
	srcSeemsValid
} from '../images.js';

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
	if (selectIsEditing(state)) {
		console.warn('Can\'t start editing because already editing');
		return;
	}
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

export const editingCommit = () => async (dispatch, getState) => {
	const state = getState();
	if (!selectIsEditing(state)) {
		console.warn('Editing not active');
		return;
	}
	if (!selectUserMayEditActiveCard(state)) {
		console.warn('This user isn\'t allowed to edit!');
		return;
	}
	if (selectPendingSlug(state)) {
		if (!confirm('There is a slug pending that is not yet added. Continue?')) {
			return;
		}
	}

	if (selectEditingCardSuggestedConceptReferences(state).length > 0) {
		if (!confirm('The card has suggested concept references. Typically you either reject or accept them before proceeding. Do you want to proceed?')) return;
	}

	const underlyingCard = selectActiveCard(state);
	if (!underlyingCard || !underlyingCard.id) {
		console.warn('That card isn\'t legal');
		return;
	}

	const rawUpdatedCard = selectEditingCard(state);

	const cardFinisher = CARD_TYPE_EDITING_FINISHERS[rawUpdatedCard.card_type];

	let updatedCard;

	try {
		updatedCard = cardFinisher ? cardFinisher(rawUpdatedCard, state) : rawUpdatedCard;
	} catch(err) {
		alert(err);
		console.warn('The card finisher threw an error: ' + err);
		return;
	}

	const CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[rawUpdatedCard.card_type];

	//TODO: it feels like this 'confirm' logic should be all done in
	//data.js/modifyCard, where there's other confirm-on-save logic.
	if (CARD_TYPE_CONFIG.publishedByDefault) {
		if (!updatedCard.published) {
			if (!window.confirm('This card is of a type that is typically always published, but it\'s not currently published. Do you want to continue?')) return;
		}
	} else if (CARD_TYPE_CONFIG.invertContentPublishWarning) {
		if (updatedCard.published) {
			if (!window.confirm('The card is of a type that is not typically published but you\'re publishing it. Do you want to continue?')) return;
		}
	} else {
		if (cardHasContent(updatedCard) && !updatedCard.published) {
			if (!window.confirm('The card has content but is unpublished. Do you want to continue?')) return;
		}
	}

	for (const img of updatedCard.images) {
		if (img.height === undefined || img.width === undefined) {
			alert('One of the images does not yet have its height/width set yet. It might still be loading. Try removing it and readding it.');
			return;
		}
	}

	//Throw out any boosts that might have been applied to an old card type.
	if (updatedCard.card_type != underlyingCard.card_type) updatedCard.font_size_boost = {};

	updatedCard.font_size_boost = await fontSizeBoosts(updatedCard);

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

	if (Object.keys(updatedCard.font_size_boost).length != Object.keys(underlyingCard.font_size_boost || {}).length || Object.entries(updatedCard.font_size_boost).some(entry => (underlyingCard.font_size_boost || {})[entry[0]] != entry[1])) update.font_size_boost = updatedCard.font_size_boost;
	if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
	if (updatedCard.name != underlyingCard.section) update.name = updatedCard.name;
	if (updatedCard.notes != underlyingCard.notes) update.notes = updatedCard.notes;
	if (updatedCard.todo != underlyingCard.todo) update.todo = updatedCard.todo;
	if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;
	if (updatedCard.published !== underlyingCard.published) update.published = updatedCard.published;
	if (updatedCard.card_type !== underlyingCard.card_type) update.card_type = updatedCard.card_type;

	let [todoEnablements, todoDisablements, todoRemovals] = triStateMapDiff(underlyingCard.auto_todo_overrides || {}, updatedCard.auto_todo_overrides || {});
	if (todoEnablements.length) update.auto_todo_overrides_enablements = todoEnablements;
	if (todoDisablements.length) update.auto_todo_overrides_disablements = todoDisablements;
	if (todoRemovals.length) update.auto_todo_overrides_removals = todoRemovals;

	let [tagAdditions, tagDeletions] = arrayDiff(underlyingCard.tags || [], updatedCard.tags || []);
	if (tagAdditions.length) update.addTags = tagAdditions;
	if (tagDeletions.length) update.removeTags = tagDeletions;

	let [editorAdditions, editorDeletions] = arrayDiff(underlyingCard.permissions[PERMISSION_EDIT_CARD] || [], updatedCard.permissions[PERMISSION_EDIT_CARD] || []);
	if (editorAdditions.length) update.add_editors = editorAdditions;
	if (editorDeletions.length) update.remove_editors = editorDeletions;

	let [collaboratorAdditions, collaboratorDeletions] = arrayDiff(underlyingCard.collaborators || [], updatedCard.collaborators || []);
	if (collaboratorAdditions.length) update.add_collaborators = collaboratorAdditions;
	if (collaboratorDeletions.length) update.remove_collaborators = collaboratorDeletions;

	if (!imageBlocksEquivalent(underlyingCard.images, updatedCard.images)) update.images = updatedCard.images;

	//if references changed, pass the ENTIRE new references object in on update.
	//We pass the whole references since modifyCard will need to extractLinks
	//and update refernces
	if (!references(underlyingCard).equivalentTo(updatedCard)) references(update).ensureReferences(updatedCard);

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

export const textFieldUpdated = (fieldName, value, fromContentEditable) => (dispatch, getState) => {
	if (!fromContentEditable) fromContentEditable = false;

	const config = TEXT_FIELD_CONFIGURATION[fieldName] || {};

	if (config.html) {
		//We only run it if it's coming from contentEditable because
		//normalizeBodyHTML assumes the contnet is valid HTML, and if it's been
		//updated in the editor textbox, and for example the end says `</p`,
		//then it's not valid HTML.
		value = fromContentEditable ? normalizeBodyHTML(value) : value;
	}

	const currentCard = selectEditingCard(getState());
	if (currentCard && currentCard[fieldName] === value) {
		//The values are exactly the same, skip dispatching the update. This
		//could happen for example when a blank card is opened for editing and
		//the nbsp; hack has to be cleared out. If we were to dispatch even for
		//a no-op, then when EDITING_EXTRACT_LINKS fired, it would update the
		//card to a new object, which would then lead to the content-card to
		//re-render, potentially losing focus. (See #347).
		return;
	}

	dispatch({
		type: EDITING_TEXT_FIELD_UPDATED,
		fieldName: fieldName,
		skipUpdatingNormalizedFields: config.html,
		value: value,
		fromContentEditable
	});

	if (config.html) {
		//Make sure we have a timeout to extract links a bit of time after the last edit was made.
		if (extractLinksTimeout) window.clearTimeout(extractLinksTimeout);
		extractLinksTimeout = window.setTimeout(() => {
			extractLinksTimeout = 0;
			dispatch({type: EDITING_EXTRACT_LINKS});
		}, 1000);
	}
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

export const cardTypeUpdated = (cardType) => (dispatch, getState) => {
	const state = getState();
	const baseCard = selectActiveCard(state);
	const currentlySubstantive = state.editor.substantive;

	if (!CARD_TYPE_CONFIGURATION[cardType]) {
		console.warn('Illegal card type');
		return;
	}

	//If the base card is now different card type, and substantive isn't already
	//checked, check it. If we're setting to the same card_type (as base card
	//is) and we're currently substantive, uncheck it.
	if (!currentlySubstantive && baseCard.card_type != cardType) {
		dispatch(substantiveUpdated(true, true));
	} else if(currentlySubstantive && baseCard.card_type == cardType) {
		dispatch(substantiveUpdated(false, true));
	}

	dispatch({
		type: EDITING_CARD_TYPE_UPDATED,
		cardType,
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

export const addImageWithFile = (file) => async (dispatch) => {

	//TODO: append some random characters in the filename;
	alert('Not yet implemented');

	//dispatch(addImageWithURL(src, uploadPath));
};

//src must be a fully qualified URL. uploadPath is the filename in the upload
//bucket, if applicable.
export const addImageWithURL = (src, uploadPath = '') => async (dispatch, getState) => {

	if (!srcSeemsValid(src)) {
		alert('Src doesn\'t seem valid. It should start with https or http');
		return;
	}

	let images = (selectEditingCard(getState()) || {}).images || [];
	for (const img of images) {
		if (img.src == src) {
			console.warn('An image already has that src');
			return;
		}
	}
	dispatch({
		type: EDITING_ADD_IMAGE_URL,
		src,
		uploadPath,
	});
	const dim = await getImageDimensionsForImageAtURL(src);
	if (!dim) {
		alert('Image load failed to fetch resources');
		return;
	}
	images = (selectEditingCard(getState()) || {}).images || [];
	let index = -1;
	for (let i = 0; i < images.length; i++) {
		if (images[i].src == src) {
			index = i;
			break;
		}
	}
	if (index < 0) {
		console.warn('Invalid index');
		return;
	}
	dispatch(changeImagePropertyAtIndex(index, 'height', dim.height));
	dispatch(changeImagePropertyAtIndex(index, 'width', dim.width));
};

export const removeImageAtIndex = (index) => {
	return {
		type: EDITING_REMOVE_IMAGE_AT_INDEX,
		index
	};
};

export const changeImagePropertyAtIndex = (index, property, value) => {
	return {
		type: EDITING_CHANGE_IMAGE_PROPERTY,
		index,
		property,
		value
	};
};

export const openImagePropertiesDialog = (index) => {
	return {
		type: EDITING_OPEN_IMAGE_PROPERTIES_DIALOG,
		index,
	};
};

export const closeImagePropertiesDialog = () => {
	return {
		type: EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG,
	};
};

export const openImageBrowserDialog = () => {
	return {
		type: EDITING_OPEN_IMAGE_BROWSER_DIALOG,
	};
};

export const closeImageBrowserDialog = () => {
	return {
		type: EDITING_CLOSE_IMAGE_BROWSER_DIALOG,
	};
};

export const setCardToReference = (cardID) => (dispatch, getState) => {
	const state = getState();
	const referenceType = selectEditingPendingReferenceType(state);
	dispatch(addReferenceToCard(cardID, referenceType));
	dispatch({
		type: EDITING_RESET_REFERENCE_CARD,
	});
};

export const selectCardToReference = (referenceType) => (dispatch, getState) => {
	const editingCard = selectEditingCard(getState());
	if (!editingCard) {
		console.warn('No editing card');
		return;
	}
	const referenceTypeConfig = REFERENCE_TYPES[referenceType];
	if (!referenceTypeConfig) {
		console.warn('Illegal reference type');
		return;
	}

	if (referenceTypeConfig.fromCardTypeAllowList) {
		if (!referenceTypeConfig.fromCardTypeAllowList[editingCard.card_type]) {
			console.warn('That reference type may not originate from cards of type ' + editingCard.card_type);
			return;
		}
	}

	dispatch({
		type:EDITING_START_REFERENCE_CARD,
		referenceType,
	});
	const cardTypeFilter = referenceTypeConfig.toCardTypeAllowList ? Object.keys(referenceTypeConfig.toCardTypeAllowList).join(UNION_FILTER_DELIMITER) : '';
	dispatch(findCardToReference(cardTypeFilter));
};

export const addReferenceToCard = (cardID, referenceType) => (dispatch, getState) => {
	if (!REFERENCE_TYPES[referenceType]) {
		console.warn('Illegal reference type');
		return;
	}
	const state = getState();
	if (!getCardExists(state, cardID)) {
		console.warn('No such card');
		return;
	}
	const toCardType = getCardType(state, cardID);
	const referenceTypeConfig = REFERENCE_TYPES[referenceType];

	if (!referenceTypeConfig) {
		console.warn('Illegal reference type');
		return;
	}

	const editingCard = selectEditingCard(state);
	if (!editingCard) {
		console.warn('No editing card');
		return;
	}

	if (referenceTypeConfig.conceptReference && references(editingCard).conceptArray().some(id => id == cardID)) {
		console.warn('The editing card already has a concept reference (or subtype) to that card');
		return;
	}

	//if the reference type doesn't have a toCardTypeAllowList then any of them
	//are legal.
	if (referenceTypeConfig.toCardTypeAllowList) {
		if (!referenceTypeConfig.toCardTypeAllowList[toCardType]) {
			console.warn('That reference type may not point to cards of type ' + toCardType);
			return;
		}
	}

	if (referenceTypeConfig.fromCardTypeAllowList) {
		if (!referenceTypeConfig.fromCardTypeAllowList[editingCard.card_type]) {
			console.warn('That reference type may not originate from cards of type ' + editingCard.card_type);
			return;
		}
	}

	dispatch({
		type: EDITING_ADD_REFERENCE,
		cardID,
		referenceType,
	});

};

export const removeReferenceFromCard = (cardID, referenceType) => {
	return {
		type:EDITING_REMOVE_REFERENCE,
		cardID,
		referenceType,
	};
};