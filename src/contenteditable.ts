
import {
	isWhitespace
} from './util.js';

import {
	getDocument
} from './document.js';

import {
	HTMLTagMap,
	HTMLTagName
} from './types.js';

import {
	TypedObject
} from './typed_object.js';

//We don't just use Node.ELEMENT_NODE and friends because this also runs in the
//Node context for testing.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;


const replaceAsWithCardLinks = (body : string) : string=> {
	//Replaces all a's with card-links.
	//TODO: consider modifying the actual nodes in place, which is more robust.;
	body = body.split('<a').join('<card-link');
	body = body.split('</a>').join('</card-link>');
	return body;
};

const replaceCardLinksWithAs = (body : string) : string => {
	//Inverse of replaceAwsWithCardLinks
	body = body.split('<card-link').join('<a');
	body = body.split('</card-link>').join('</a>');
	return body;
};

const hrefToCardAttribute = (cardLink : HTMLElement) => {
  
	const cardAttribute = cardLink.getAttribute('card');
	//Sometimes the HTML erroneously has a normal href in the card, so look for
	//that too and put it in the href property, where we expect it to be. See
	//#97.
	if (cardAttribute) {
		cardLink.setAttribute('href', cardAttribute);
		cardLink.removeAttribute('card');
	}

	let href = cardLink.getAttribute('href');

	if (!href) return;
	if (href.startsWith('/')) return;
	//If you copy and paste a section, the non-valid URLs that are just naked
	//card IDs will have the site prepended to it. Strip that off. Put in a
	//realistic sentinel so it can be tested in a unit test.
	let prefix = 'http://localhost:8081/';
	try {
		prefix = window.location.origin + '/';
	} catch(err) {
		//This must be in a unit test. That's OK.
	}
	if (href.startsWith(prefix)) href = href.slice(prefix.length);
	if (href.startsWith('http://')) return;
	if (href.startsWith('https://')) return;

	cardLink.setAttribute('card', href);
	cardLink.removeAttribute('href');

};

const cardAttributeToHref = (a : HTMLAnchorElement) => {

	const card = a.getAttribute('card');

	if (!card) return;

	a.setAttribute('href', card);
	a.removeAttribute('card');

};

const spliceEle = (ele : Element) => {
	const parent = ele.parentNode;
	if (!parent) return;
	ele.replaceWith(...ele.childNodes);
	parent.normalize();
};

const normalizeBodyFromContentEditable = (html : string) => {

	//Rewrite elements from content editable form to canonical form (which is
	//primarily replacing <a>'s with <card-link>.)

	//This transform should be the inverse, semantically, of normalizeBodyFromCotentEditable

	html = replaceAsWithCardLinks(html);

	//This is the part where we do live-node fix-ups of stuff that
	//contenteditable might have erroneously spewed in.

	const document = getDocument();
	if (!document) throw new Error('no document');

	const section = document.createElement('section');
	//TODO: catch syntax errors
	section.innerHTML = html;

	//createLink will have <a href='cardid'>. We will have changed the <a> to
	//<card-link> already, but the href should be a card attribute.
	section.querySelectorAll('card-link').forEach(hrefToCardAttribute);
	//If card-highlight somehow got back in, remove it.
	section.querySelectorAll('card-highlight').forEach(spliceEle);

	return section.innerHTML;
};

export const normalizeBodyToContentEditable = (html : string) => {
	//inverse transform of normalizeBodyFromContentEditable. contentEditable
	//expects links to be, for example, actual link elements. We only do
	//transforms that are necessary for Chrome's content editable to understand
	//our content. For example, although Chrome's content editable places <b>'s,
	//it understands that <strong>'s are the same thing for the purpose of
	//unbolding.

	html = replaceCardLinksWithAs(html);

	//This is the part where we do live-node fix-ups of stuff that
	//contenteditable might have erroneously spewed in.

	const document = getDocument();
	if (!document) throw new Error('no document');

	const section = document.createElement('section');
	//TODO: catch syntax errors
	section.innerHTML = html;

	section.querySelectorAll('a').forEach(cardAttributeToHref);
	//Make sure that highlights are inactive so if you click on a card highlight
	//to focus the field it won't navigate.
	section.querySelectorAll('card-highlight').forEach(ele => ele.setAttribute('disabled', ''));

	return section.innerHTML;

};

const removeZombieSpans = (ele : Element) => {
	//Remove zombie spans (which can show up if you backspace to remove
	//a paragraph break, and then can start infecting all content as you
	//edit.)

	//We used to only treat spans as zombies if they had specific styles in
	//them, but zombies show up way more often than that. The new policy is to
	//assume that EVERY span is a zombie. If you want to have some kind of
	//styling, use literally any other kind of element. Spans and fonts are
	//special because they are likely to be injected somewhat randomly by
	//contenteditable, but nothing else is (well, excdept for p since that's the
	//paragraph separator).

	if (ele.children.length > 0) {
		for (const child of ele.children) {
			removeZombieSpans(child);
		}
	}

	let removedZombies = false;
	for (const child of Object.values(ele.children)) {
		//Spans are legal to use if they have a classname, like 'small'.
		if (!child.className && (child.localName == 'span' || child.localName == 'font')) {
			//Replace it with either just the text if it's only got 
			child.replaceWith(...child.childNodes);
			removedZombies = true;
		}
		child.removeAttribute('style');
		//content pasted from Google docs has these
		child.removeAttribute('role');
		child.removeAttribute('dir');
	}
	//Combine adjacent text nodes, otherwise when you add back in a space it
	//will show as &nbsp; because it will be between two runs not within one.
	if (removedZombies) ele.normalize();
};

//Recreated in functions/src/embeddings.ts
const DEFAULT_LEGAL_TOP_LEVEL_NODES : HTMLTagMap = {
	'p': true,
	'ol': true,
	'ul': true,
	'h1': true,
	'h2': true,
	'h3': true,
	'h4': true,
	'blockquote': true
};

const removeWhitespace = (ele : Element) => {
	for (const child of Object.values(ele.childNodes)) {
		if (isWhitespace(child.textContent || '')) {
			if (!child.parentNode) throw new Error('No parent node');
			//It's all text content, just get rid of it
			child.parentNode.removeChild(child);
			continue;
		}
		if (child.nodeType == ELEMENT_NODE) removeWhitespace(child as Element);
	}
};

const cleanUpTopLevelHTML = (html : string, legalTopLevelNodes : HTMLTagMap = DEFAULT_LEGAL_TOP_LEVEL_NODES, tag? : HTMLTagName) => {

	if (!tag) tag = TypedObject.keys(legalTopLevelNodes)[0];
	if (!tag) throw new Error('No tag');

	//Does deeper changes that require parsing.
	//1) make sure all text in top is within a p tag.
	//2) make sure that p elements don't have any line breaks inside.
	const document = getDocument();
	if (!document) throw new Error('no document');
	const section = document.createElement('section');
	section.innerHTML = html;
	const children = section.childNodes;
	let hoistNode = null;
	//First, go through an hoist up any children that are not valid at this level.
	for (const child of Object.values(children)) {
		if (child.nodeType == TEXT_NODE) {
			if (!hoistNode) {
				hoistNode = document.createElement(tag);
				child.replaceWith(hoistNode);
			} else {
				if (!child.parentNode) throw new Error('no parent node');
				child.parentNode.removeChild(child);
			}
			hoistNode.innerHTML += child.textContent;
		} else if (child.nodeType == ELEMENT_NODE) {
			const ele = child as HTMLElement;
			//Normally we allow only the explicitly legal items. But also allow
			//the hoist tag (since that's the thing we'll hoist to, we can skip
			//hoisting to it!). This covers the <li> inner use.
			if (legalTopLevelNodes[ele.localName as HTMLTagName] || ele.localName == tag) {
				//The child is already OK at top-level. But if we have an active
				//hoistNode, the next things to hoist should go into a new one.
				hoistNode = null;
				continue;
			}
			if (!hoistNode) {
				hoistNode = document.createElement(tag);
				child.replaceWith(hoistNode);
			} else {
				if (!child.parentNode) throw new Error('no parent node');
				child.parentNode.removeChild(child);
			}
			hoistNode.innerHTML += ele.outerHTML;
		}
	}

	//OK, we now know all top-level children are valid types. Do additional cleanup.
	for (const child of Object.values(children)) {
		if (child.nodeType == ELEMENT_NODE) {
			const ele = child as HTMLElement;
			ele.removeAttribute('style');
			//content pasted from Google docs has these
			ele.removeAttribute('role');
			ele.removeAttribute('dir');
			ele.removeAttribute('aria-level');
			removeZombieSpans(ele);

			let inner = ele.innerHTML;
			inner = inner.trim();
			ele.innerHTML = inner;

			if (ele.localName == 'ol' || ele.localName == 'ul') {
				ele.innerHTML = cleanUpTopLevelHTML(ele.innerHTML, legalTopLevelNodes, 'li');
			}
		}
	}

	removeWhitespace(section);

	return section.innerHTML;

};

//Also recreated in functions/src/embeddings.ts
export const normalizeLineBreaks = (html : string, legalTopLevelNodes : HTMLTagMap = DEFAULT_LEGAL_TOP_LEVEL_NODES) => {

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

export const normalizeBodyHTML = (html : string, legalTopLevelNodes : HTMLTagMap = DEFAULT_LEGAL_TOP_LEVEL_NODES) => {

	if (!html) return html;

	//normalizeBodyHTML makes sure that the html is well formatted. It first
	//does basic string processing to clean it up, and then does node
	//modification. Thus, it assumes the HTML is always valid. This is true if
	//the html is coming directly from a contentEditable, or if it's the final
	//stage before commit.

	//normalizeBodyHTML should do processing on the HTML (that comes potentially
	//from contentEditable) to represent it in a sane, simple way that should
	//ideally not change the display of the content, just structure the markup
	//differently.

	//Ensure that after every block element we have a new line. Don't worry
	//about putting in extra; we'll remove them in the next step.

	//Do all gross tag replacements

	//If you have a link at the end and hit enter, it puts in a <br> in a <p>.
	html = html.split('<br>').join('');
	html = html.split('<b>').join('<strong>');
	html = html.split('</b>').join('</strong>');
	html = html.split('<i>').join('<em>');
	html = html.split('</i>').join('</em>');

	html = cleanUpTopLevelHTML(html, legalTopLevelNodes);

	html = normalizeLineBreaks(html, legalTopLevelNodes);

	html = html.split('&nbsp;').join(' ');

	//Remove any extra linke breaks (which we might have added)
	//html = removeDoubleLineBreaks(html);

	return normalizeBodyFromContentEditable(html);

};

//Returns an HTMLElement whose innerHTML is input.
export const elementForHTML = (input : string) : HTMLElement => {
	const doc = getDocument();
	if (!doc) throw new Error('No document');
	const ele = doc.createElement('section');
	ele.innerHTML = input;
	return ele;
};

//Returns an empty string if it's OK, and a non-empty string if it's not.
export const validateTopLevelNodes = (input : string | HTMLElement, legalTopLevelNodes : HTMLTagMap = DEFAULT_LEGAL_TOP_LEVEL_NODES, disallowNakedSpans = false) : string => {
	const ele = typeof input == 'string' ? elementForHTML(input) : input;
	for (const node of ele.childNodes) {
		if (node instanceof HTMLElement) {
			if (!legalTopLevelNodes[node.localName as HTMLTagName]) {
				return `${node.localName} was in top-level but only legal values are ${Object.keys(legalTopLevelNodes).join(',')}`;
			}
		}
		if (!disallowNakedSpans) continue;
		if (node.nodeType == node.TEXT_NODE) {
			if (!node.nodeValue) continue;
			const value = node.nodeValue.trim();
			if (!value) continue;
			return `'${value}' was found at top-level but that is not allowed`;
		}
	}
	return '';
};

const extractTopLevelULs = (ele : HTMLElement) : HTMLUListElement[] => {
	const result : HTMLUListElement[] = [];
	for (const child of ele.children) {
		if (child.tagName === 'UL') {
			result.push(child as HTMLUListElement);
			continue;
		}
		if (child.children.length && child.nodeType == 1) {
			result.push(...extractTopLevelULs(child as HTMLElement));
		}
	}
	return result;
};

const processExtractedCardRun = (eles : HTMLElement[]) : string => {
	//TODO: allow passing a topLevel node name, instead of assuming `ul`.
	//The body machinery is actually pretty good at handling a lot of the weird
	//formatting, so just lean on it!
	const raw =`<ul>${eles.map(ele => ele.outerHTML).join('')}</ul>`;
	const clean = normalizeBodyHTML(raw);
	return clean;
};

//A run is one or more elements that should go together into a card.
//Right now it's assuming that it's a li plus the ul after it (if there is one).
const extractGoogleDocCardRuns = (ele : HTMLUListElement) : HTMLElement[][] => {
	const result : HTMLElement[][] = [];
	let innerResult : HTMLElement[] = [];
	for (const child of ele.children) {
		if (child.tagName === 'LI') {
			if (innerResult.length) {
				result.push(innerResult);
				innerResult = [];
			}
			innerResult.push(child as HTMLLIElement);
			continue;
		}
		if (child.tagName === 'UL') {
			innerResult.push(child as HTMLUListElement);
		}
	}
	if (innerResult.length) result.push(innerResult);
	return result;
};

export const importBodiesFromGoogleDocs = (content : string) : string[] => {
	const doc = getDocument();
	if (!doc) throw new Error('No document');
	const ele = doc.createElement('div');
	ele.innerHTML = content;
	const uls = extractTopLevelULs(ele);
	const runs = uls.map(extractGoogleDocCardRuns).flat();
	return runs.map(processExtractedCardRun);
};