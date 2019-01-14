import { 
	UPDATE_CARDS,
	UPDATE_SECTIONS,
	UPDATE_TAGS,
	UPDATE_AUTHORS,
	MODIFY_CARD,
	MODIFY_CARD_SUCCESS,
	MODIFY_CARD_FAILURE,
	REORDER_STATUS
} from '../actions/data.js';

const INITIAL_STATE = {
	cards:{},
	authors:{},
	sections: {},
	tags: {},
	slugIndex: {},
	//The modification that is pending
	cardModificationPending: '',
	cardModificationError: null,
	reorderPending: false
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case UPDATE_CARDS:
		return {
			...state,
			cards: {...state.cards, ...action.cards},
			slugIndex: {...state.slugIndex, ...extractSlugIndex(action.cards)},
		};
	case UPDATE_SECTIONS:
		return {
			...state,
			sections: {...state.sections, ...action.sections}
		};
	case UPDATE_TAGS:
		return {
			...state,
			tags: {...state.tags, ...action.tags}
		};
	case UPDATE_AUTHORS:
		return {
			...state,
			authors: {...state.authors, ...action.authors},
		};
	case MODIFY_CARD:
		return {
			...state,
			cardModificationPending: action.cardId,
			cardModificationError: null,
		}; 
	case MODIFY_CARD_SUCCESS:
		return {
			...state,
			cardModificationPending: '',
		};
	case MODIFY_CARD_FAILURE:
		return {
			...state,
			cardModificationPending: '',
			cardModificationError: action.error
		};
	case REORDER_STATUS:
		return {
			...state,
			reorderPending: action.pending
		};
	default:
		return state;
	}
};

const extractSlugIndex = cards => {
	let result = {};

	Object.keys(cards).forEach(key => {
		let card = cards[key];
		let slugs = card.slugs;
		if (!slugs) return;
		if (typeof slugs !== 'object') slugs = slugs.split(',');
		for (let val of slugs) {
			result[val] = key;
		}
	});

	return result;
};

export const authorForId = (state, authorId) => {
	let author = state.data.authors[authorId];
	if (!author){
		return {displayName: 'Unknown user'};
	}
	return author;
};

export const sectionTitle = (state, sectionId) => {
	let section = state.data.sections[sectionId];
	if (!section) return '';
	return section.title;
};

export const getDefaultCardIdForSection = (section) => {
	if (!section) return null;
	if (section.start_cards && section.start_cards.length) return section.start_cards[0];
	return section.cards[0];
};

export default app;