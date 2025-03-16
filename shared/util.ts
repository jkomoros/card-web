import {
	Slug
} from './types.js';

const slugRegularExpression = /^[a-zA-Z0-9-_]+$/;

/**
 * Normalizes a mostly-OK slug, returning '' if it wasn't legal.
 * If you want to generate a good one given an arbitrary string that may contain illegal
 * characters to strip, see createSlugFromArbitraryString in the main util.ts
 */
export const normalizeSlug = (slug : Slug) : Slug => {
	slug = slug.trim();
	slug = slug.toLowerCase();
	slug = slug.split(' ').join('-');
	slug = slug.split('_').join('-');

	if (!slugRegularExpression.test(slug)) slug = '';

	return slug;
};