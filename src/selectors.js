import { createSelector } from 'reselect';

export const getSections = (state) => state.data.sections;

export const getBaseSet = createSelector(
	getSections,
	(sections) => {
		let result = [];
		for (let section of Object.values(sections)) {
			result = result.concat(section.cards)
		}
		return result;
	}
)