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
