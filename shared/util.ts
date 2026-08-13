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
//Regex-based approximation of card-link conversion for environments without
//a document (workers, bare Node). Handles the well-formed card-link markup
//the editor produces; pathological HTML may extract slightly differently
//than the DOM path.
const convertCardLinksForPlainTextWithoutDocument = (html : string) : string => {
	return html.replace(/<card-link\b([^>]*)>([\s\S]*?)<\/card-link>/gi, (_match, attrs : string, text : string) => {
		const hrefMatch = attrs.match(/href\s*=\s*["']([^"']*)["']/i);
		if (hrefMatch) return `${text} (${hrefMatch[1]})`;
		return text;
	});
};

//Decodes the handful of entities that show up in card content.
//Named entities the DOM decodes and this fallback used not to. Only six were
//handled, so the WORKER — which has no document and therefore always takes this
//path — tokenized `A &mdash; B` as [a, mdash, b] and `caf&eacute;` as
//[caf, eacute], while the main thread produced [a, b] and [café]. Measured: 3 of
//5 representative samples diverged. That matters because the worker owns
//similarity, fingerprints and suggestions in the default mode, and
//`nlp_source_fingerprint` is computed from RAW fields, so it cannot detect the
//divergence and heal it.
//
//Exact-match, not case-insensitive: `&Eacute;` and `&eacute;` are different
//characters.
const NAMED_ENTITIES : {[entity : string] : string} = {
	//U+00A0, not a plain space: that is what the DOM produces, and parity with
	//the DOM is the entire point. Both are matched by \\s, so tokenization is
	//unaffected either way — but a difference here is a difference.
	nbsp: '\u00a0', lt: '<', gt: '>', quot: '"', apos: '\'',
	//Typographic punctuation, which is what prose actually contains.
	mdash: '\u2014', ndash: '\u2013', hellip: '\u2026', middot: '\u00b7', bull: '\u2022',
	lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
	laquo: '\u00ab', raquo: '\u00bb', prime: '\u2032', Prime: '\u2033',
	deg: '\u00b0', copy: '\u00a9', reg: '\u00ae', trade: '\u2122',
	times: '\u00d7', divide: '\u00f7', minus: '\u2212', plusmn: '\u00b1',
	frac12: '\u00bd', frac14: '\u00bc', frac34: '\u00be',
	//Accented Latin-1, the class that silently splits a word into two tokens.
	aacute: '\u00e1', eacute: '\u00e9', iacute: '\u00ed', oacute: '\u00f3', uacute: '\u00fa',
	Aacute: '\u00c1', Eacute: '\u00c9', Iacute: '\u00cd', Oacute: '\u00d3', Uacute: '\u00da',
	agrave: '\u00e0', egrave: '\u00e8', igrave: '\u00ec', ograve: '\u00f2', ugrave: '\u00f9',
	Agrave: '\u00c0', Egrave: '\u00c8', Igrave: '\u00cc', Ograve: '\u00d2', Ugrave: '\u00d9',
	acirc: '\u00e2', ecirc: '\u00ea', icirc: '\u00ee', ocirc: '\u00f4', ucirc: '\u00fb',
	auml: '\u00e4', euml: '\u00eb', iuml: '\u00ef', ouml: '\u00f6', uuml: '\u00fc',
	Auml: '\u00c4', Euml: '\u00cb', Iuml: '\u00cf', Ouml: '\u00d6', Uuml: '\u00dc',
	ntilde: '\u00f1', Ntilde: '\u00d1', ccedil: '\u00e7', Ccedil: '\u00c7',
	aring: '\u00e5', Aring: '\u00c5', oslash: '\u00f8', Oslash: '\u00d8',
	szlig: '\u00df', aelig: '\u00e6', AElig: '\u00c6',
};

const decodeCommonEntities = (text : string) : string => {
	//Numeric forms first; they are unambiguous and cover whatever a given
	//editor happens to emit.
	let result = text
		.replace(/&#(\d+);/g, (match, code) => {
			const value = Number(code);
			return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
		})
		.replace(/&#x([0-9a-fA-F]+);/g, (match, code) => {
			const value = parseInt(code, 16);
			return Number.isFinite(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : match;
		});
	//Named forms, leaving anything unrecognized ALONE rather than dropping it:
	//an unknown entity is better tokenized as its literal text than deleted.
	result = result.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name) => {
		if (name === 'amp') return match;
		const decoded = NAMED_ENTITIES[name];
		return decoded === undefined ? match : decoded;
	});
	//&amp; LAST, and deliberately: decoding it earlier would turn the literal
	//text `&amp;mdash;` into an em dash instead of the string `&mdash;`.
	return result.replace(/&amp;/g, '&');
};

const innerTextForHTMLWithoutDocument = (body : string) : string => {
	//Remove comments, then all tags, then decode entities.
	const withoutComments = body.replace(/<!--[\s\S]*?-->/g, '');
	const withoutTags = withoutComments.replace(/<[^>]*>/g, '');
	return decodeCommonEntities(withoutTags);
};

const convertCardLinksForPlainText = (html : string) : string => {
	const document = getDocument();
	if (!document) return convertCardLinksForPlainTextWithoutDocument(html);
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
	// makes sure line breaks are in the right place after each legal block level element
	body = normalizeLineBreaks(body);
	if (preserveLinks) {
		body = convertCardLinksForPlainText(body);
	}
	if (!document) {
		//Workers and bare Node have no document; a regex-based extraction is
		//a close approximation for the well-formed HTML cards contain.
		return innerTextForHTMLWithoutDocument(body);
	}
	const ele = document.createElement('section');
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