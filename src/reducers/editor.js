import { 
	EDITING_START,
	EDITING_FINISH,
	EDITING_SELECT_TAB,
	EDITING_TITLE_UPDATED,
	EDITING_BODY_UPDATED,
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

	TAB_CONTENT,
} from '../actions/editor.js';

const DEFAULT_TAB = TAB_CONTENT;

const INITIAL_STATE = {
	editing: false,
	bodyFromContentEditable: false,
	titleFromContentEditable: false,
	card: null,
	substantive: false,
	selectedTab: DEFAULT_TAB,
};

import {
	arrayRemove,
	arrayUnion,
	extractCardLinksFromBody
} from '../util.js';
import { TODO_OVERRIDE_LEGAL_KEYS } from './collection.js';

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case EDITING_START:
		return {
			...state,
			editing: true,
			card: action.card,
			substantive: false,
			bodyFromContentEditable: false,
			titleFromContentEditable: false,
			selectedTab: DEFAULT_TAB,
		};
	case EDITING_FINISH:
		return {
			...state,
			editing:false,
			card: null,
			substantive:false,
			bodyFromContentEditable: false,
			titleFromContentEditable: false,
		};
	case EDITING_SELECT_TAB:
		return {
			...state,
			selectedTab: action.tab,
		};
	case EDITING_TITLE_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, title:action.title},
			titleFromContentEditable: action.fromContentEditable,
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
	case EDITING_BODY_UPDATED:
		if (!state.card) return state;
		return {
			...state,
			card: {...state.card, body:action.body},
			bodyFromContentEditable: action.fromContentEditable
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
		//links to be updated away.
		let linkInfo = extractCardLinksFromBody(state.card.body);
		return {
			...state,
			card: {...state.card, links:linkInfo[0], links_text: linkInfo[1]}
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
	default:
		return state;
	}
};

export default app;