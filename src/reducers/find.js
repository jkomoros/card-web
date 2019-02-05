import {
	FIND_DIALOG_OPEN,
	FIND_DIALOG_CLOSE,
	FIND_UPDATE_QUERY,
	FIND_CARD_TO_LINK
} from '../actions/find.js';

import {
	selectCards,
	selectQuery
} from '../selectors.js';

const INITIAL_STATE = {
	open: false,
	query: '',
	linking: false
};

const app = (state = INITIAL_STATE, action) => {
	switch (action.type) {
	case FIND_DIALOG_OPEN:
		return {
			...state,
			linking: false,
			query: '',
			open: true
		};
	case FIND_DIALOG_CLOSE:
		return {
			...state,
			open: false,
			query: ''
		};
	case FIND_UPDATE_QUERY: 
		return {
			...state,
			query: action.query
		};
	case FIND_CARD_TO_LINK:
		return {
			...state,
			open: true,
			linking: true
		};
	default:
		return state;
	}
};

const stringPropertyScoreForStringSubQuery = (propertyValue, preparedSubquery) => {
	let value = propertyValue.toLowerCase();
	for (let item of preparedSubquery) {
		if (value.indexOf(item[0]) >= 0) return item[1];
	}
	return 0.0;
};

const cardScoreForQuery = (card, preparedQuery) => {
	if (!card) return 0.0;
	let score = 0.0;

	//TODO: filter out filters.

	for (let key of ['title', 'body', 'subtitle']) {
		if(!preparedQuery[key] || !card[key]) continue;
		score += stringPropertyScoreForStringSubQuery(card[key], preparedQuery[key]);
	}

	return score;
};

const FILTER_PREFIX = 'filter:';

const filterForWord = (word) => {
	if (word.indexOf(FILTER_PREFIX) < 0) return '';
	return word.split(FILTER_PREFIX).join('');
};

//extracts the raw, non filter words from a query, then also the filters.
const queryWordsAndFilters = (queryString) => {
	queryString = queryString.toLowerCase();
	let words = [];
	let filters = [];
	for (let word of queryString.split(' ')) {
		if (!word) continue;
		let filter = filterForWord(word);
		if (filter) {
			filters.push(filter);
		} else {
			words.push(word);
		}
	}
	return [words.join(' '), filters];
};

const prepareQuery = (queryString) => {
	let [query, filters] = queryWordsAndFilters(queryString);
	return {
		title: [[query, 1.0]],
		body: [[query, 0.5]],
		subtitle: [[query, 0.75]],
		filters,
	};
};

export const collectionForQuery = (state) => {
	let scoredCollection = [];
	let query = selectQuery(state);

	if (!query) return [];

	let preparedQuery = prepareQuery(query);

	let cards = selectCards(state);

	for (let card of Object.values(cards)) {
		let score = cardScoreForQuery(card, preparedQuery);
		if (score > 0.0) {
			scoredCollection.push({
				score,
				card
			});
		}
	}

	scoredCollection.sort((left, right) => right.score - left.score);

	return scoredCollection.map(item => item.card);

};

export default app;