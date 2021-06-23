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
export const EDITING_MOVE_IMAGE_AT_INDEX = 'EDITING_MOVE_IMAGE_AT_INDEX';
export const EDITING_CHANGE_IMAGE_PROPERTY = 'EDITING_CHANGE_IMAGE_PROPERTY';
export const EDITING_OPEN_IMAGE_PROPERTIES_DIALOG = 'EDITING_OPEN_IMAGE_PROPERTIES_DIALOG';
export const EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG = 'EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG';
export const EDITING_OPEN_IMAGE_BROWSER_DIALOG = 'EDITING_OPEN_IMAGE_BROWSER_DIALOG';
export const EDITING_CLOSE_IMAGE_BROWSER_DIALOG = 'EDITING_CLOSE_IMAGE_BROWSER_DIALOG';
export const EDITING_MERGE_UPDATED_UNDERLYING_CARD = 'EDITING_MERGE_UPDATED_UNDERLYING_CARD';

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
	selectEditingCardSuggestedConceptReferences,
	selectMultiEditDialogOpen,
	selectEditingUnderlyingCardSnapshotDiffDescription,
	selectEditingUnderlyingCardSnapshotAutoMergeableDiffDescription,
	selectEditingUnderlyingCard
} from '../selectors.js';

import {
	addReference
} from './multiedit.js';

import {
	modifyCard,
} from './data.js';

import {
	generateFinalCardDiff,
	confirmationsForCardDiff
} from '../card_diff.js';

import {
	CARD_TYPE_CONFIGURATION,
	TEXT_FIELD_CONFIGURATION,
	REFERENCE_TYPES,
} from '../card_fields.js';

import {
	referencesNonModifying
} from '../references.js';

import {
	randomString,
} from '../util.js';

import {
	normalizeBodyHTML
} from '../contenteditable.js';

import {
	createAuthorStub
} from './comments.js';

import {
	findCardToReference
} from './find.js';

import {
	UNION_FILTER_DELIMITER
} from '../filters.js';

import {
	getImageDimensionsForImageAtURL,
	srcSeemsValid,
	getImagesFromCard
} from '../images.js';

import {
	uploadsRef
} from '../firebase.js';

let lastReportedSelectionRange = null;
let savedSelectionRange = null;
let selectionParent = null;


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
	if (!savedSelectionRange) return;
	let parentEle = savedSelectionRange.commonAncestorContainer;
	//Walk up to the parent that actually has content editable set.
	while (parentEle && parentEle.contentEditable != 'true') {
		parentEle = parentEle.parentNode;
	}
	if (!parentEle) return;
	//a tuple of [startOffset, endOffset]
	const offsets = startEndOffsetInEle(parentEle,savedSelectionRange, 0);
	selectionParent = parentEle;
	selectionParent.stashedSelectionOffset = offsets;
};

const startEndOffsetInEle = (ele, range, previousCount) => {
	let start = -1;
	let end = -1;
	if (!ele) return [start, end];
	if (ele == range.startContainer) {
		start = previousCount + range.startOffset;
	}
	if (ele == range.endContainer) {
		end = previousCount + range.endOffset;
	}
	for (let child of ele.childNodes) {
		if (child.nodeType != child.ELEMENT_NODE && child.nodeType != child.TEXT_NODE) continue;
		const [innerStart, innerEnd] = startEndOffsetInEle(child, range, previousCount);
		if (start == -1 && innerStart != -1) start = innerStart;
		if (end == -1 && innerEnd != -1) end = innerEnd;
		previousCount += child.textContent.length;
	}
	return [start, end];
};

const rangeFromOffsetsInEle = (ele, startOffset = -1, endOffset = -1) => {
	//startOffset and endOffset are within the given ele.
	if (startOffset == -1 || endOffset == -1) return null;
	const range = document.createRange();
	setOffsetRange(ele, range, startOffset, endOffset, 0);
	return range;
};

const setOffsetRange = (node, range, startOffset, endOffset, offsetCount) => {
	if (node.nodeType == node.TEXT_NODE) {
		//We might be the candidate!
		if (startOffset >= offsetCount && startOffset < offsetCount + node.textContent.length) range.setStart(node, startOffset - offsetCount);
		if (endOffset >= offsetCount && endOffset < offsetCount + node.textContent.length) range.setEnd(node, endOffset - offsetCount);
	}
	for (let child of node.childNodes) {
		setOffsetRange(child, range, startOffset, endOffset, offsetCount);
		offsetCount += child.textContent.length;
	}
};

export const restoreSelectionRange = () => {
	if (!selectionParent) return;
	let selection = document.getSelection();
	selection.removeAllRanges();
	//Note that this assumes that selectionParent is still literally the same element as when selection was saved.
	const offsets = selectionParent.stashedSelectionOffset || [-1, -1];
	let range = rangeFromOffsetsInEle(selectionParent, offsets[0], offsets[1]);
	if (range) selection.addRange(range);
	selectionParent.stashedSelectionOffset = undefined;
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

	const underlyingDiffDescription = selectEditingUnderlyingCardSnapshotDiffDescription(state);
	if (underlyingDiffDescription) {
		alert('Can\'t save. sThe underlying card has changed: ' + underlyingDiffDescription);
		return;
	}

	const underlyingCard = selectActiveCard(state);
	if (!underlyingCard || !underlyingCard.id) {
		console.warn('That card isn\'t legal');
		return;
	}

	const rawUpdatedCard = selectEditingCard(state);

	let update;
	try {
		update = await generateFinalCardDiff(state, underlyingCard, rawUpdatedCard);
	} catch(err) {
		alert(err);
		return;
	}

	if (!update) return;

	//TODO: technically we shouldn't pass rawUpdatedCard, but the one that has
	//been run through any cardFinishers in generateFinalCardDiff.
	if (!confirmationsForCardDiff(update, rawUpdatedCard)) return;

	//modifyCard will fail if the update is a no-op.
	dispatch(modifyCard(underlyingCard, update, state.editor.substantive));

};

export const cancelLink = () => () => {
	restoreSelectionRange();
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

//If index is undefined, it will add a new item to the end of the list
export const addImageWithFile = (file, index) => async (dispatch, getState) => {

	const state = getState();

	if (!selectUserMayEditActiveCard(state)) {
		alert('You don\'t have permission');
		return;
	}

	const uid = selectUid(state);
	if (!uid) return;

	const userUploadRef = uploadsRef.child(uid);

	const rawFileNameParts = file.name.split('.');

	if (rawFileNameParts.length >= 2) {
		rawFileNameParts[rawFileNameParts.length - 2] += '_' + randomString(6);
	}
	
	const fileName = rawFileNameParts.join('.');
	
	const fileRef = userUploadRef.child(fileName);

	try {
		await new Promise((resolve, reject) => {
			const snapshot = fileRef.put(file);
			snapshot.then(resolve, reject);
		});
	} catch (err) {
		console.warn(err);
		alert('Failed to upload');
		return;
	}

	const downloadURL = await fileRef.getDownloadURL();

	dispatch(addImageWithURL(downloadURL, fileRef.fullPath, index));
};

//src must be a fully qualified URL. uploadPath is the filename in the upload
//bucket, if applicable. If index is undefined, it will add a new item to the end of the list
export const addImageWithURL = (src, uploadPath = '', index) => async (dispatch, getState) => {

	if (!srcSeemsValid(src)) {
		alert('Src doesn\'t seem valid. It should start with https or http');
		return;
	}

	let images = getImagesFromCard(selectEditingCard(getState()));
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
		index,
	});
	const dim = await getImageDimensionsForImageAtURL(src);
	if (!dim) {
		alert('Image load failed to fetch resources');
		return;
	}
	images = getImagesFromCard(selectEditingCard(getState()));
	let actualIndex = -1;
	for (let i = 0; i < images.length; i++) {
		if (images[i].src == src) {
			actualIndex = i;
			break;
		}
	}
	if (actualIndex < 0) {
		console.warn('Invalid index');
		return;
	}
	dispatch(changeImagePropertyAtIndex(actualIndex, 'height', dim.height));
	dispatch(changeImagePropertyAtIndex(actualIndex, 'width', dim.width));

	//Adding an image or changing what image shows is automatically substantive;
	dispatch(substantiveUpdated(true, true));
};

export const removeImageAtIndex = (index) => (dispatch) => {
	dispatch({
		type: EDITING_REMOVE_IMAGE_AT_INDEX,
		index
	});

	//Removing an image is automatically substantive
	dispatch(substantiveUpdated(true, true));
};

export const moveImageAtIndex = (index, isRight) => {
	return {
		type: EDITING_MOVE_IMAGE_AT_INDEX,
		index,
		isRight
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

//index can be not provided, which defaults to adding to end.
export const openImageBrowserDialog = (index) => {
	return {
		type: EDITING_OPEN_IMAGE_BROWSER_DIALOG,
		index,
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
	if (selectMultiEditDialogOpen(state)) {
		dispatch(addReference(cardID, referenceType));
	} else {
		dispatch(addReferenceToCard(cardID, referenceType));
	}
	dispatch({
		type: EDITING_RESET_REFERENCE_CARD,
	});
};

export const selectCardToReference = (referenceType) => (dispatch, getState) => {

	const referenceTypeConfig = REFERENCE_TYPES[referenceType];
	if (!referenceTypeConfig) {
		console.warn('Illegal reference type');
		return;
	}

	const state = getState();

	if (!selectMultiEditDialogOpen(state)) {
		const editingCard = selectEditingCard(state);
		if (!editingCard) {
			console.warn('No editing card');
			return;
		}

		if (referenceTypeConfig.fromCardTypeAllowList) {
			if (!referenceTypeConfig.fromCardTypeAllowList[editingCard.card_type]) {
				console.warn('That reference type may not originate from cards of type ' + editingCard.card_type);
				return;
			}
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
	const state = getState();

	const editingCard = selectEditingCard(state);
	if (!editingCard) {
		console.warn('No editing card');
		return;
	}

	const reason = referencesNonModifying(editingCard).mayNotSetCardReferenceReason(state, cardID, referenceType); 

	if (reason) {
		console.warn(reason);
		return;
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

export const mergeUpdatedUnderlyingCard = (autoMergeableChangesOnly) => (dispatch, getState) => {
	const state = getState();

	if (!selectEditingCard(state)) {
		console.log('No editing card');
		return;
	}

	const updatedUnderlyingCard = selectEditingUnderlyingCard(state);

	if (!updatedUnderlyingCard) {
		console.log('No updated underlying card');
		return;
	}

	const description = autoMergeableChangesOnly ? selectEditingUnderlyingCardSnapshotAutoMergeableDiffDescription(state) : selectEditingUnderlyingCardSnapshotDiffDescription(state);

	if (!description) {
		console.log('There isn\'t a diff to apply');
		return;
	}

	if (!confirm('This will incorporate the following changes: \n' + description + '\nAre you sure?')) {
		console.log('User canelled');
		return;
	}

	dispatch({
		type: EDITING_MERGE_UPDATED_UNDERLYING_CARD,
		updatedUnderlyingCard,
		autoMerge: autoMergeableChangesOnly,
	});
};