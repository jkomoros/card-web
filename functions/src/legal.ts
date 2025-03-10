import {
	db
} from './common.js';

import {
	CARDS_COLLECTION
} from '../../shared/collection-constants.js';

import {
	Slug
} from './types.js';

//note: these are from util.js
const slugRegularExpression = /^[a-zA-Z0-9-_]+$/;

const normalizeSlug = (slug : Slug) => {
	slug = slug.trim();
	slug = slug.toLowerCase();
	slug = slug.split(' ').join('-');
	slug = slug.split('_').join('-');

	if (!slugRegularExpression.test(slug)) slug = '';

	return slug;
};

//returns a reason why the slug is not legal, or '' if it is legal.
export const slug = async (newSlug : Slug) : Promise<string> => {
	newSlug = normalizeSlug(newSlug);

	if (!newSlug) {
		return 'Provided slug is not a valid slug';
	}

	const doc = await db.collection(CARDS_COLLECTION).doc(newSlug).get();
    
	if (doc.exists) {
		return 'That slug is already the id of another item';
	}
    
	const snapshot = await db.collection(CARDS_COLLECTION).where('slugs', 'array-contains', newSlug).get();
	if (snapshot.size > 0) {
		return 'Another document already has that slug';
	}

	return '';
    
};