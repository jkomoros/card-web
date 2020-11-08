import { 
	EDITING_START,
	EDITING_FINISH,
	EDITING_SELECT_TAB,
	EDITING_SELECT_EDITOR_TAB,
	EDITING_TEXT_FIELD_UPDATED,
	EDITING_SECTION_UPDATED,
	EDITING_SLUG_ADDED,
	EDITING_NAME_UPDATED,
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
	EDITING_SKIPPED_LINK_INBOUND_ADDED,
	EDITING_SKIPPED_LINK_INBOUND_REMOVED,
	EDITING_EXTRACT_LINKS,
	EDITING_EDITOR_ADDED,
	EDITING_EDITOR_REMOVED,
	EDITING_COLLABORATOR_ADDED,
	EDITING_COLLABORATOR_REMOVED,
	EDITING_START_REFERENCE_CARD,
	EDITING_RESET_REFERENCE_CARD,
	EDITING_ADD_REFERENCE,
	EDITING_REMOVE_REFERENCE,

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
	cardSetNormalizedTextProperties,
	references,
} from '../card_fields.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	TODO_OVERRIDE_LEGAL_KEYS
} from '../filters.js';

const DEFAULT_TAB = TAB_CONFIG;
const DEFAULT_EDITOR_TAB = EDITOR_TAB_CONTENT;

const INITIAL_STATE = {
	editing: false,
	//this is a map of field name to true if it was updated last from content
	//editable, or false or missing if it wasn't.
	updatedFromContentEditable: {},
	card: null,
	substantive: false,
	selectedTab: DEFAULT_TAB,
	selectedEditorTab: DEFAULT_EDITOR_TAB,
	pendingSlug: '',
	pendingReferenceType: '',
};

const app = (state = INITIAL_STATE, action) => {
	let card;
	switch (action.type) {
	case EDITING_START:
		return {
			...state,
			editing: true,
			card: action.card,
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
		if(!action.skipUpdatingNormalizedFields) cardSetNormalizedTextProperties(card);
		return {
			...state,
			card: card,
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
		cardSetNormalizedTextProperties(card);
		return {
			...state,
			card: card,
		};
	case EDITING_ADD_REFERENCE:
		if (!state.card) return state;
		card = {...state.card};
		references(card).setCardReference(action.cardID, action.referenceType);
		return {
			...state,
			card: card,
		};
	case EDITING_REMOVE_REFERENCE:
		if (!state.card) return state;
		card = {...state.card};
		references(card).removeCardReference(action.cardID, action.referenceType);
		return {
			...state,
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
			card: {...state.card, auto_todo_overrides: {...state.card.auto_todo_overrides, [action.todo]: true}}
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
			card: {...state.card, auto_todo_overrides: {...state.card.auto_todo_overrides, [action.todo]: false}}
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
	case EDITING_SKIPPED_LINK_INBOUND_ADDED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, auto_todo_skipped_links_inbound: arrayUnion(state.card.auto_todo_skipped_links_inbound, [action.link])}
		};
	case EDITING_SKIPPED_LINK_INBOUND_REMOVED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, auto_todo_skipped_links_inbound: arrayRemove(state.card.auto_todo_skipped_links_inbound, [action.link])}
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
	default:
		return state;
	}
};

export default app;