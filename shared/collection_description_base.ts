import {
	SetName,
	SortName,
	ViewMode,
	FilterName,
	viewMode as viewModeSchema
} from './types.js';

//The word in the URL that means "the part after this is a sort".
export const SORT_URL_KEYWORD = 'sort';
export const SORT_REVERSED_URL_KEYWORD = 'reverse';

export const VIEW_MODE_URL_KEYWORD = 'view';

//The literal set names for URL parsing. These match the SetName type
//from shared/types.ts.
export const SET_NAMES: SetName[] = ['main', 'reading-list', 'everything'];

//Legal view modes, including whether an option is expected or not.
export const LEGAL_VIEW_MODES: { [mode in ViewMode]: boolean } = {
	//Note: collection_description logic assumes that default_view_mode takes no extra option.
	'list': false,
	'web': true,
};

/**
 * The result of parsing URL parts into filter names, sort, and view mode.
 */
export type ExtractFilterNamesResult = [FilterName[], SortName, boolean, ViewMode, string];

/**
 * extractFilterNamesSortAndView takes the unconsumed portions of the URL path
 * (everything except set name and card identifier) and returns the filter
 * names, sort name, whether sort is reversed, view mode, and view mode extra.
 *
 * configurableFilterURLParts maps the first token of a multi-part
 * configurable filter to how many additional parts it needs.
 * configurableFilterNames maps valid configurable filter start names to true.
 *
 * Both can be passed as empty objects `{}` if the caller doesn't need
 * multi-part filter parsing.
 */
export const extractFilterNamesSortAndView = (
	parts: string[],
	configurableFilterURLParts: Record<string, number>,
	configurableFilterNames: Record<string, boolean>
): ExtractFilterNamesResult => {
	//returns the filter names, the sort name, and whether the sort is reversed
	//parts is all of the unconsumed portions of the path that aren't the set
	//name or the card name.
	if (!parts.length) return [[], 'default', false, 'list', ''];
	const filters: FilterName[] = [];
	let sortName: SortName = 'default';
	let sortReversed = false;
	let viewMode: ViewMode = 'list';
	let viewModeExtra = '';
	let nextPartIsSort = false;
	let nextPartIsView = false;
	let nextPartIsViewExtra = false;
	//The actual multi-part filter we're accumulating
	let multiPartFilter: string[] = [];
	//How many more ports we need until multiPartFilter is done.
	let expectedRemainingMultiParts = 0;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part == '') continue;
		if (part == SORT_URL_KEYWORD) {
			nextPartIsSort = true;
			//handle the case where there was already one sort, and only listen
			//to the last reversed.
			sortReversed = false;
			continue;
		}
		if (nextPartIsSort) {
			if (part == SORT_REVERSED_URL_KEYWORD) {
				sortReversed = true;
				//Note that we requested a reverse, and then expect the  next
				//part to be the sort name
				continue;
			}
			//We don't know what sort names are valid, so we'll just assume it's fine.
			sortName = part as SortName;
			nextPartIsSort = false;
			continue;
		}
		if (part == VIEW_MODE_URL_KEYWORD) {
			nextPartIsView = true;
			nextPartIsViewExtra = false;
			continue;
		}
		if (nextPartIsView) {
			viewMode = viewModeSchema.parse(part);
			nextPartIsView = false;
			//LEGAL_VIEW_MODES is a map of view mode to whether or not it expects
			//an extra. Note that we have no way of signaling an error, so we
			//just assume the viewMode is legal.
			if (LEGAL_VIEW_MODES[viewMode]) nextPartIsViewExtra = true;
			continue;
		}
		if (nextPartIsViewExtra) {
			viewModeExtra = part;
			nextPartIsViewExtra = false;
			continue;
		}
		if (configurableFilterURLParts[part]) {
			//It's the beginning of a collection.
			//No matter what we add this on.
			multiPartFilter.push(part);
			//First, if we're already in a multi-count section, keep track that
			//we got another piece, which might have satisfied all of it
			if (expectedRemainingMultiParts) {
				expectedRemainingMultiParts--;
			}
			//Now keep track of how many more pieces the new thing needs to eat
			expectedRemainingMultiParts += configurableFilterURLParts[part];
			continue;
		}
		if (expectedRemainingMultiParts) {
			multiPartFilter.push(part);
			expectedRemainingMultiParts--;
			if (expectedRemainingMultiParts == 0) {
				//Only add multi-part filters that started with one of the valid
				//start filter names. We process up until this point, so even if
				//the URL started in the middle of a multi-part parsing, we
				//still consume it.
				if (configurableFilterNames[multiPartFilter[0]]) filters.push(multiPartFilter.join('/'));
				multiPartFilter = [];
			}
			continue;
		}
		filters.push(part);
	}
	return [filters, sortName, sortReversed, viewMode, viewModeExtra];
};

/**
 * The result shape returned by deserializeCollectionURL.
 */
export interface DeserializedCollectionURL {
	setName: SetName;
	filters: FilterName[];
	sortName: SortName;
	sortReversed: boolean;
	viewMode: ViewMode;
	viewModeExtra: string;
	cardIdentifier: string;
}

/**
 * deserializeCollectionURL takes a serialized collection URL path and parses
 * it into its component parts. This is the pure-function equivalent of
 * CollectionDescription.deserializeWithExtra().
 *
 * configurableFilterURLParts and configurableFilterNames are passed through
 * to extractFilterNamesSortAndView. Pass empty objects `{}` if you don't need
 * multi-part filter parsing.
 */
export const deserializeCollectionURL = (
	input: string,
	configurableFilterURLParts: Record<string, number>,
	configurableFilterNames: Record<string, boolean>
): DeserializedCollectionURL => {
	const parts = input.split('/');

	//We do not remove a trailing slash; we take a trailing slash to mean
	//"default item in the collection".

	//in some weird situations, like during editing commit, we might be at no
	//route even when our view is active. Not entirely clear how, but it
	//happens... for a second.
	const firstPart = parts.length ? parts[0] : '';

	let setName: SetName = 'main';

	for (const name of SET_NAMES) {
		if (name == firstPart) {
			setName = firstPart as SetName;
			parts.shift();
			break;
		}
	}

	//Get last part, which is the card selector (and might be "").
	const cardIdentifier = parts.pop() || '';

	const [filters, sortName, sortReversed, viewMode, viewModeExtra] = extractFilterNamesSortAndView(parts, configurableFilterURLParts, configurableFilterNames);

	return {
		setName,
		filters,
		sortName,
		sortReversed,
		viewMode,
		viewModeExtra,
		cardIdentifier
	};
};
