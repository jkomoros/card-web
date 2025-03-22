import {
	Card,
	CardFieldTypeEditable,
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

export const randomCharSetNumbers = '0123456789';
export const randomCharSetLetters = 'abcdef';
export const randomCharSet = randomCharSetNumbers + randomCharSetLetters;

/**
 * Generates a random string of specified length using the provided character set
 */
export const randomString = (length : number, charSet = randomCharSet) : string => {
	let text = '';
	for (let i = 0; i < length; i++) {
		text += charSet.charAt(Math.floor(Math.random() * charSet.length));
	}
	return text;
};

import {
	getDocument
} from './document.js';

import {
	BODY_CARD_TYPES,
	DERIVED_FIELDS_FOR_CARD_TYPE,
	TEXT_FIELD_CONFIGURATION
} from './card_fields.js';

// Import from src/contenteditable.ts
const DEFAULT_LEGAL_TOP_LEVEL_NODES = {
	'p': true,
	'ol': true,
	'ul': true,
	'h1': true,
	'h2': true,
	'h3': true,
	'h4': true,
	'blockquote': true
};

// Import from src/contenteditable.ts
export const normalizeLineBreaks = (html : string, legalTopLevelNodes = DEFAULT_LEGAL_TOP_LEVEL_NODES) => {
	if (!html) return html;
	//Remove all line breaks. We'll put them back in.
	html = html.split('\n').join('');

	//Add in line breaks
	for (const key of Object.keys(legalTopLevelNodes)) {
		const closeTag = '</' + key + '>';
		html = html.split(closeTag).join(closeTag + '\n');
	}

	html = html.split('<ul>').join('<ul>\n');
	html = html.split('<ol>').join('<ol>\n');
	html = html.split('<li>').join('\t<li>');
	html = html.split('</li>').join('</li>\n');
	return html;
};

/**
 * Extracts text content from HTML
 * This shouldn't be an XSS vulnerability even though body is supplied by
 * users and thus untrusted, because the temporary element is never actually
 * appended into the DOM
 */
export const innerTextForHTML = (body : string) : string => {
	const document = getDocument();
	if (!document) throw new Error('missing document');
	const ele = document.createElement('section');
	// makes sure line breaks are in the right place after each legal block level element
	body = normalizeLineBreaks(body);
	ele.innerHTML = body;
	//textContent would return things like style and script contents, but those shouldn't be included anyway.
	return ele.textContent || '';
};

const plainContentCache = new WeakMap<Card, string>();

const cardPlainContentImpl = (card : Card) : string => {
	const cardType = card.card_type;
	if (!BODY_CARD_TYPES[cardType]) return '';
	const result : string[] = [];
	const fieldsInOrder : CardFieldTypeEditable[] = ['title', 'body', 'commentary'];
	for (const field of fieldsInOrder) {
		//Skip derived fields
		if (DERIVED_FIELDS_FOR_CARD_TYPE[cardType][field]) continue;
		const rawContent = card[field] || '';
		const fieldConfiguration = TEXT_FIELD_CONFIGURATION[field];
		const content = fieldConfiguration.html ? innerTextForHTML(rawContent) : rawContent;
		if (!content) continue;
		result.push(content.trim());
	}
	return result.join('\n');
};

//Extracts the user-provided title and body from the card, without HTML
//formatting.
export const cardPlainContent = (card : Card) : string => {
	const currentContent = plainContentCache.get(card);
	if (currentContent == undefined) {
		const value = cardPlainContentImpl(card);
		plainContentCache.set(card, value);
		return value;
	}
	return currentContent;
};