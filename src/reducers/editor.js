import { 
	EDITING_START,
	EDITING_FINISH,
	EDITING_TITLE_UPDATED,
	EDITING_BODY_UPDATED,
	EDITING_SECTION_UPDATED,
	EDITING_SLUG_ADDED,
	EDITING_NAME_UPDATED,
	EDITING_SUBSTANTIVE_UPDATED,
	EDITING_PUBLISHED_UPDATED,
	EDITING_FULL_BLEED_UPDATED,
	EDITING_NOTES_UPDATED,
	EDITING_TAG_ADDED,
	EDITING_TAG_REMOVED
} from '../actions/editor.js';

const INITIAL_STATE = {
	editing: false,
	bodyFromContentEditable: false,
	titleFromContentEditable: false,
	card: null,
	substantive: false,
};

import {
	arrayRemove,
	arrayUnion
} from '../util.js';

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case EDITING_START:
		return {
			...state,
			editing: true,
			card: action.card,
			substantive: false,
			bodyFromContentEditable: false,
			titleFromContentEditable: false
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
			//Force substantive on
			substantive:true,
			card: {...state.card, section:action.section}
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