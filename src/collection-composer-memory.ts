import { CollectionDescription } from './collection_description.js';

const DATE_FILTER_FAMILIES = new Set(['created', 'updated', 'last-tweeted']);
const DATE_COMPARISONS = new Set(['before', 'after', 'between']);
const RELATIVE_DATE_TOKEN = /^(today|yesterday|\d+-(day|week|month|year)s?-ago|last-(monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/;

const localCalendarDay = (date : Date) : number => Date.UTC(
	date.getFullYear(),
	date.getMonth(),
	date.getDate()
);

const relativeDateToken = (token : string, visitedAt : Date) : string => {
	const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(token);
	if (!match) return token;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(year, month - 1, day);
	if (
		parsed.getFullYear() !== year ||
		parsed.getMonth() !== month - 1 ||
		parsed.getDate() !== day
	) return token;
	const daysAgo = Math.round((localCalendarDay(visitedAt) - localCalendarDay(parsed)) / 86400000);
	if (daysAgo < 0) return token;
	if (daysAgo === 0) return 'today';
	if (daysAgo === 1) return 'yesterday';
	return `${daysAgo}-days-ago`;
};

export const collectionDescriptionWithRelativeDateMemory = (
	description : CollectionDescription,
	visitedAt = new Date()
) : CollectionDescription => {
	const filters = description.filters.map(filter => {
		const pieces = filter.split('/');
		if (!DATE_FILTER_FAMILIES.has(pieces[0]) || !DATE_COMPARISONS.has(pieces[1])) return filter;
		const expectedDates = pieces[1] === 'between' ? 2 : 1;
		for (let index = 0; index < expectedDates; index++) {
			const pieceIndex = index + 2;
			if (pieces[pieceIndex]) pieces[pieceIndex] = relativeDateToken(pieces[pieceIndex], visitedAt);
		}
		return pieces.join('/');
	});
	return new CollectionDescription(
		description.setNameExplicitlySet ? description.set : undefined,
		filters,
		description.sort,
		description.sortReversed,
		description.viewMode,
		description.viewModeExtra
	);
};

export const collectionDescriptionHasRelativeDateMemory = (description : CollectionDescription) : boolean =>
	description.filters.some(filter => {
		const pieces = filter.split('/');
		if (!DATE_FILTER_FAMILIES.has(pieces[0]) || !DATE_COMPARISONS.has(pieces[1])) return false;
		return pieces.slice(2).some(piece => RELATIVE_DATE_TOKEN.test(piece));
	});
