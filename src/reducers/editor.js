import { 
	EDITING_START,
	EDITING_FINISH,
	EDITING_SELECT_TAB,
	EDITING_SELECT_EDITOR_TAB,
	EDITING_TEXT_FIELD_UPDATED,
	EDITING_SECTION_UPDATED,
	EDITING_SLUG_ADDED,
	EDITING_NAME_UPDATED,
	EDITING_CARD_TYPE_UPDATED,
	EDITING_SUBSTANTIVE_UPDATED,
	EDITING_PUBLISHED_UPDATED,
	EDITING_FULL_BLEED_UPDATED,
	EDITING_NOTES_UPDATED,
	EDITING_TODO_UPDATED,
	EDITING_AUTO_TODO_OVERRIDE_ENABLED,
	EDITING_AUTO_TODO_OVERRIDE_DISABLED,
	EDITING_AUTO_TODO_OVERRIDE_REMOVED,
	EDITING_TAG_ADDED,
	EDITING_TAG_REMOVED,
	EDITING_EXTRACT_LINKS,
	EDITING_EDITOR_ADDED,
	EDITING_EDITOR_REMOVED,
	EDITING_COLLABORATOR_ADDED,
	EDITING_COLLABORATOR_REMOVED,
	EDITING_START_REFERENCE_CARD,
	EDITING_RESET_REFERENCE_CARD,
	EDITING_ADD_REFERENCE,
	EDITING_REMOVE_REFERENCE,
	EDITING_ADD_IMAGE_URL,
	EDITING_REMOVE_IMAGE_AT_INDEX,
	EDITING_MOVE_IMAGE_AT_INDEX,
	EDITING_CHANGE_IMAGE_PROPERTY,
	EDITING_OPEN_IMAGE_PROPERTIES_DIALOG,
	EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG,
	EDITING_OPEN_IMAGE_BROWSER_DIALOG,
	EDITING_CLOSE_IMAGE_BROWSER_DIALOG,
	EDITING_UPDATE_UNDERLYING_CARD,
	EDITING_MERGE_OVERSHADOWED_CHANGES,
	TAB_CONFIG,
	EDITOR_TAB_CONTENT,
} from '../actions/editor.js';

import {
	SET_PENDING_SLUG
} from '../actions/data.js';

import {
	arrayRemove,
	arrayUnion,
	extractCardLinksFromBody
} from '../util.js';

import {
	references
} from '../references.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	TODO_OVERRIDE_LEGAL_KEYS
} from '../filters.js';

import {
	applyCardDiff,
	generateCardDiff,
	applyCardFirebaseUpdate
} from '../card_diff.js';

import {
	addImageWithURL,
	removeImageAtIndex,
	changeImagePropertyAtIndex,
	moveImageAtIndex
} from '../images.js';

const DEFAULT_TAB = TAB_CONFIG;
const DEFAULT_EDITOR_TAB = EDITOR_TAB_CONTENT;

const INITIAL_STATE = {
	editing: false,
	//this is a map of field name to true if it was updated last from content
	//editable, or false or missing if it wasn't.
	updatedFromContentEditable: {},
	card: null,
	//A direct reference to the card, as it was when editing started, in the
	//cards array. Useful for detecting when the underlying card has changed.
	underlyingCardSnapshot: null,
	//The very original card snapshot from when editing started. This allows us
	//to figure out what edits have been merged in from other users while we're
	//open for editing.
	originalUnderlyingCardSnapshot: null,
	//This number should increment every time EDITING_EXTRACT_LINKS fires. The
	//selector for selectEditingNormalizedCard will return the same result until this changes.
	cardExtractionVersion: -1,
	substantive: false,
	selectedTab: DEFAULT_TAB,
	selectedEditorTab: DEFAULT_EDITOR_TAB,
	pendingSlug: '',
	pendingReferenceType: '',
	imagePropertiesDialogOpen: false,
	imagePropertiesDialogIndex: 0,
	imageBrowserDialogOpen: false,
	//Undefined communicates 'add to end'
	imageBrowserDialogIndex: undefined,
};

const app = (state = INITIAL_STATE, action) => {
	let card;
	switch (action.type) {
	case EDITING_START:
		return {
			...state,
			editing: true,
			card: action.card,
			underlyingCardSnapshot: action.card,
			originalUnderlyingCardSnapshot: action.card,
			cardExtractionVersion: 0,
			substantive: false,
			updatedFromContentEditable: {},
			selectedTab: DEFAULT_TAB,
			selectedEditorTab: DEFAULT_EDITOR_TAB,
		};
	case EDITING_FINISH:
		return {
			...state,
			editing:false,
			card: null,
			underlyingCardSnapshot: null,
			originalUnderlyingCardSnapshot: null,
			//If we don't change this, selectEditingNormalizedCard will continue returning the old one.
			cardExtractionVersion: -1,
			substantive:false,
			updatedFromContentEditable: {},
		};
	case EDITING_SELECT_TAB:
		return {
			...state,
			selectedTab: action.tab,
		};
	case EDITING_SELECT_EDITOR_TAB:
		return {
			...state,
			selectedEditorTab: action.tab,
		};
	case EDITING_TEXT_FIELD_UPDATED:
		if (!state.card) return state;
		card = {...state.card, [action.fieldName]:action.value};
		return {
			...state,
			card: card,
			cardExtractionVersion: state.cardExtractionVersion + (action.skipUpdatingNormalizedFields ? 0 : 1),
			updatedFromContentEditable: {...state.updatedFromContentEditable, [action.fieldName]: action.fromContentEditable},
		};
	case EDITING_NOTES_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, notes:action.notes},
		};
	case EDITING_TODO_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, todo:action.todo},
		};
	case EDITING_SECTION_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, section:action.section}
		};
	case EDITING_EXTRACT_LINKS:
		if (!state.card) return state;
		//These links will be recomputed for real when the card is committed,
		//but updating them now allows things like the live list of reciprocal
		//links to be updated away. This is also when we do expensive processing
		//of body, like re-extracting words to cause suggested tags to change.
		let linkInfo = extractCardLinksFromBody(state.card.body);
		card = {...state.card};
		references(card).setLinks(linkInfo);
		return {
			...state,
			cardExtractionVersion: state.cardExtractionVersion + 1,
			card: card,
		};
	case EDITING_ADD_REFERENCE:
		if (!state.card) return state;
		card = {...state.card};
		references(card).setCardReference(action.cardID, action.referenceType);
		return {
			...state,
			//references could change e.g.similar cards, word clouds (if text is
			//backported), etc, so make sure the nlp pipeline for the card runs
			cardExtractionVersion: state.cardExtractionVersion + 1,
			card: card,
		};
	case EDITING_REMOVE_REFERENCE:
		if (!state.card) return state;
		card = {...state.card};
		references(card).removeCardReference(action.cardID, action.referenceType);
		return {
			...state,
			//references could change e.g.similar cards, word clouds (if text is
			//backported), etc, so make sure the nlp pipeline for the card runs
			cardExtractionVersion: state.cardExtractionVersion + 1,
			card: card,
		};
	case EDITING_SLUG_ADDED:
		if (!state.card) return state;
		//If the name was just the id, auto-select this name
		let name = state.card.name;
		if (state.card.name == state.card.id) name = action.slug;
		return {
			...state,
			card: {...state.card, slugs: [...state.card.slugs, action.slug], name: name}
		};
	case EDITING_AUTO_TODO_OVERRIDE_ENABLED:
		if (!state.card) return state;
		//Only allow legal keys to be set
		if (!TODO_OVERRIDE_LEGAL_KEYS[action.todo]) {
			console.warn('Rejecting illegal todo override key: ' + action.todo);
			return state;
		}
		return {
			...state,
			card: {...state.card, auto_todo_overrides: {...state.card.auto_todo_overrides, [action.todo]: false}}
		};
	case EDITING_AUTO_TODO_OVERRIDE_DISABLED:
		if (!state.card) return state;
		//Only allow legal keys to be set
		if (!TODO_OVERRIDE_LEGAL_KEYS[action.todo]) {
			console.warn('Rejecting illegal todo override key: ' + action.todo);
			return state;
		}
		return {
			...state,
			card: {...state.card, auto_todo_overrides: {...state.card.auto_todo_overrides, [action.todo]: true}}
		};
	case EDITING_AUTO_TODO_OVERRIDE_REMOVED:
		if (!state.card) return state;
		//It's OK to remove any key, even ones that were illegal in the first place.
		return {
			...state,
			card: {...state.card, auto_todo_overrides: Object.fromEntries(Object.entries(state.card.auto_todo_overrides).filter(entry => entry[0] != action.todo))}
		};
	case EDITING_TAG_ADDED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, tags: arrayUnion(state.card.tags, [action.tag])}
		};
	case EDITING_TAG_REMOVED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, tags: arrayRemove(state.card.tags, [action.tag])}
		};
	case EDITING_EDITOR_ADDED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, permissions: {...state.card.permissions, [PERMISSION_EDIT_CARD]: arrayUnion(state.card.permissions[PERMISSION_EDIT_CARD], [action.editor])}}
		};
	case EDITING_EDITOR_REMOVED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, permissions: {...state.card.permissions, [PERMISSION_EDIT_CARD]: arrayRemove(state.card.permissions[PERMISSION_EDIT_CARD], [action.editor])}}
		};
	case EDITING_COLLABORATOR_ADDED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, collaborators: arrayUnion(state.card.collaborators, [action.collaborator])}
		};
	case EDITING_COLLABORATOR_REMOVED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, collaborators: arrayRemove(state.card.collaborators, [action.collaborator])}
		};
	case EDITING_NAME_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, name:action.name}
		};
	case EDITING_FULL_BLEED_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, full_bleed:action.fullBleed}
		};
	case EDITING_PUBLISHED_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, published:action.published}
		};
	case EDITING_SUBSTANTIVE_UPDATED:
		return {
			...state,
			substantive: action.checked
		};
	case EDITING_CARD_TYPE_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, card_type:action.cardType},
		};
	case SET_PENDING_SLUG:
		return {
			...state,
			pendingSlug: action.slug,
		};	
	case EDITING_START_REFERENCE_CARD:
		return {
			...state,
			pendingReferenceType: action.referenceType
		};
	case EDITING_RESET_REFERENCE_CARD:
		return {
			...state,
			pendingReferenceType: '',
		};
	case EDITING_ADD_IMAGE_URL:
		return {
			...state,
			card: {...state.card, images: addImageWithURL(state.card.images, action.src, action.uploadPath, action.index)}
		};
	case EDITING_REMOVE_IMAGE_AT_INDEX:
		return {
			...state,
			card: {...state.card, images: removeImageAtIndex(state.card.images, action.index)},
		};
	case EDITING_MOVE_IMAGE_AT_INDEX:
		//If we were looking at that item (which is the common case), also
		//modify which element is open
		let newIndex = state.imagePropertiesDialogIndex;
		if (action.index == state.imagePropertiesDialogIndex) {
			newIndex += action.isRight ? 1 : -1;
		}
		return {
			...state,
			imagePropertiesDialogIndex: newIndex,
			card: {...state.card, images: moveImageAtIndex(state.card.images, action.index, action.isRight)},
		};
	case EDITING_CHANGE_IMAGE_PROPERTY:
		return {
			...state,
			card: {...state.card, images: changeImagePropertyAtIndex(state.card.images, action.index, action.property, action.value)},
		};
	case EDITING_OPEN_IMAGE_PROPERTIES_DIALOG:
		return {
			...state,
			imagePropertiesDialogOpen: true,
			imagePropertiesDialogIndex: action.index
		};
	case EDITING_CLOSE_IMAGE_PROPERTIES_DIALOG:
		return {
			...state,
			imagePropertiesDialogOpen: false
		};
	case EDITING_OPEN_IMAGE_BROWSER_DIALOG:
		return {
			...state,
			imageBrowserDialogOpen: true,
			imageBrowserDialogIndex: action.index
		};
	case EDITING_CLOSE_IMAGE_BROWSER_DIALOG:
		return {
			...state,
			imageBrowserDialogOpen: false
		};
	case EDITING_UPDATE_UNDERLYING_CARD:
		const updatedSnapshotCard = action.updatedUnderlyingCard;
		//First, figure out what edits our user has made.
		const userEditsDiff = generateCardDiff(state.underlyingCardSnapshot, state.card);
		//Now apply back the user's edits on top of the new underlying card.
		const editingFirebaseUpdate = applyCardDiff(updatedSnapshotCard, userEditsDiff);
		const updatedCard = applyCardFirebaseUpdate(updatedSnapshotCard, editingFirebaseUpdate);
		return {
			...state,
			card: updatedCard,
			underlyingCardSnapshot: updatedSnapshotCard,
			//The state could have changed e.g. references or body.
			cardExtractionVersion: state.cardExtractionVersion + 1,
		};
	case EDITING_MERGE_OVERSHADOWED_CHANGES:
		return {
			...state,
			card: applyCardFirebaseUpdate(state.card, applyCardDiff(state.card, action.diff)),
			//The state could have changed e.g. references or body.
			cardExtractionVersion: state.cardExtractionVersion + 1,
		};
	default:
		return state;
	}
};

export default app;