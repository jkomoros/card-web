import {
	SELECT_CARDS,
	UNSELECT_CARDS,
	CLEAR_SELECTED_CARDS,
	UPDATE_READS,
	UPDATE_STARS,
	UPDATE_READING_LIST
} from '../actions.js';

import type {
	DirtyScope
} from './subscription-manager.js';

//The narrow dirty scope each forwarded action's change can be confined to;
//anything unlisted is 'all'. Its own module so test/subscription-manager
//can assert it as DATA — the earlier source-text pin accepted a spread of a
//second table that mapped every card update to selection-only dirt.
export const FORWARDED_ACTION_SCOPE : {readonly [type : string] : DirtyScope} = Object.freeze({
	[SELECT_CARDS]: 'selection',
	[UNSELECT_CARDS]: 'selection',
	[CLEAR_SELECTED_CARDS]: 'selection',
	[UPDATE_READS]: 'reads',
	[UPDATE_STARS]: 'stars',
	[UPDATE_READING_LIST]: 'reading-list',
});
