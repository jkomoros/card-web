import {
	Card,
	CardFieldTypeEditable,
	Slug
} from './types.js';

export const assertUnreachable = (x : never) : never => {
	throw new Error('Exhaustiveness check failed: ' + String(x));
};

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
const DEFAULT_LEGAL_TOP_LEVEL_NODES : Record<string, true | undefined> = {
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
export const normalizeLineBreaks = (html : string, legalTopLevelNodes : Record<string, true | undefined> = DEFAULT_LEGAL_TOP_LEVEL_NODES) => {
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

/** String-based canonical normalization for card body HTML.
 * Mirrors the non-DOM transforms from normalizeBodyHTML in
 * src/contenteditable.ts. Both the web app and mount tool call this.
 */
export const normalizeBodyHTMLString = (html: string): string => {
	if (!html) return html;
	// Strip <br> tags entirely (canonical format never has them)
	html = html.replace(/<br\s*\/?>/g, '');
	// Normalize bold/italic to semantic tags
	html = html.split('<b>').join('<strong>');
	html = html.split('</b>').join('</strong>');
	html = html.split('<i>').join('<em>');
	html = html.split('</i>').join('</em>');
	// Canonical line-break formatting
	html = normalizeLineBreaks(html);
	// Replace non-breaking spaces
	html = html.split('&nbsp;').join(' ');
	return html;
};

/** Convert <a href="..."> to canonical <card-link> format.
 * External URLs get href attr, card IDs get card attr.
 */
export const replaceAnchorsWithCardLinks = (html: string): string => {
	return html.replace(/<a\s+href="([^"]*)">([\s\S]*?)<\/a>/g,
		(_match, href, text) => {
			if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/')) {
				return `<card-link href="${href}">${text}</card-link>`;
			}
			return `<card-link card="${href}">${text}</card-link>`;
		}
	);
};

/**
 * Extracts text content from HTML
 * This shouldn't be an XSS vulnerability even though body is supplied by
 * users and thus untrusted, because the temporary element is never actually
 * appended into the DOM
 */
const convertCardLinksForPlainText = (html : string) : string => {
	const document = getDocument();
	if (!document) throw new Error('missing document');
	const tempDiv = document.createElement('div');
	tempDiv.innerHTML = html;

	// Find all card-link elements
	const cardLinks = tempDiv.querySelectorAll('card-link');
	cardLinks.forEach(cardLink => {
		const textContent = cardLink.textContent || '';

		// Handle href attribute (external links) - add URL in parentheses
		const href = cardLink.getAttribute('href');
		if (href) {
			const textWithUrl = `${textContent} (${href})`;
			const textNode = document.createTextNode(textWithUrl);
			cardLink.parentNode?.replaceChild(textNode, cardLink);
		} else {
			// Handle card attribute (internal card links) - convert to plain text only
			const textNode = document.createTextNode(textContent);
			cardLink.parentNode?.replaceChild(textNode, cardLink);
		}
	});

	return tempDiv.innerHTML;
};

export const innerTextForHTML = (body : string, preserveLinks = false) : string => {
	const document = getDocument();
	if (!document) throw new Error('missing document');
	const ele = document.createElement('section');
	// makes sure line breaks are in the right place after each legal block level element
	body = normalizeLineBreaks(body);
	if (preserveLinks) {
		body = convertCardLinksForPlainText(body);
	}
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