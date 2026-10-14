// Filter name constants - extracted to break circular dependency
// between filters.ts and collection_description.ts

export const UNION_FILTER_DELIMITER = '+';

export const PUBLISHED_FILTER_NAME = 'published';
export const UNPUBLISHED_FILTER_NAME = 'unpublished';
export const EXCLUDE_FILTER_NAME = 'exclude';
export const COMBINE_FILTER_NAME = 'combine';
export const LIMIT_FILTER_NAME = 'limit';
export const OFFSET_FILTER_NAME = 'offset';
export const QUERY_FILTER_NAME = 'query';
export const SELECTED_FILTER_NAME = 'selected';
//The router's PLACEHOLDER filter for a route that resolves to no collection at
//all (actions/collection.ts installs it while a card link redirects). It lives
//here, with the other names modules outside the filter engine need to RECOGNIZE
//rather than evaluate: the composer's history has to be able to refuse it
//without importing the engine.
export const NONE_FILTER_NAME = 'none';

//The configurable filters whose results can depend on the live editing card
//(filters.ts reads extras.editingCard in exactly three factories: the card
//links/BFS family, similar, and expand, which composes both). The worker
//mirrors the editing card on every extraction while the user types; only
//subscriptions naming one of these can change as a result, so the others are
//not recomputed for that dirt. test/subscription-manager pins this list
//against the registry's factories. A false positive only costs a recompute.
export const EDITING_CARD_FILTER_NAMES : readonly string[] = [
	'similar', 'similar-cutoff', 'expand',
	'children', 'descendants', 'parents', 'ancestors',
	'direct-connections', 'connections',
	'references', 'references-inbound', 'references-outbound',
	'direct-references', 'direct-references-inbound', 'direct-references-outbound',
];

//The viewer-state filters: each is changed by exactly one per-user
//listener action (UPDATE_READS, UPDATE_STARS, UPDATE_READING_LIST), and
//only subscriptions naming one can change as a result. Each test matches
//the filter name (and its inverse, and for the reading list the SET name)
//as a whole piece of the serialized description — pieces are delimited by
//'/' and, inside a union, '+' — because a bare substring would make
//'reading-list' depend on reads and re-run the reading-list collections
//on every auto-read. A configurable sub-expression (exclude/read/) embeds
//the piece the same way, so it still matches.
//test/subscription-manager pins these three lists to the filter registry's
//VIEWER_DEPENDENT_FILTER_NAMES, so a new per-user filter cannot be added
//without being placed in a scope (or the pin naming it).
export const READS_FILTER_NAMES : readonly string[] = ['read', 'unread'];
export const STARS_FILTER_NAMES : readonly string[] = ['starred', 'unstarred'];
export const READING_LIST_FILTER_NAMES : readonly string[] = ['reading-list', 'in-reading-list', 'not-in-reading-list'];
const namesPiece = (names : readonly string[]) : RegExp => new RegExp(`(^|[/+])(${names.join('|')})([/+]|$)`);
const READS_PIECE = namesPiece(READS_FILTER_NAMES);
const STARS_PIECE = namesPiece(STARS_FILTER_NAMES);
const READING_LIST_PIECE = namesPiece(READING_LIST_FILTER_NAMES);
export const descriptionMayReadReads = (description : string) : boolean => READS_PIECE.test(description);
export const descriptionMayReadStars = (description : string) : boolean => STARS_PIECE.test(description);
export const descriptionMayReadReadingList = (description : string) : boolean => READING_LIST_PIECE.test(description);

//Conservative substring test, like the selection test: a configurable filter
//is written `name/args`, union members and configurable sub-expressions embed
//the literal, so any description that could read the editing card contains
//one of the names followed by '/'.
export const descriptionMayReadEditingCard = (description : string) : boolean =>
	EDITING_CARD_FILTER_NAMES.some(name => description.includes(name + '/'));
