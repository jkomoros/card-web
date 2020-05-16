export const EDITING_START = 'EDITING_START';
export const EDITING_FINISH = 'EDITING_FINISH';
export const EDITING_SELECT_TAB = 'EDITING_SELECT_TAB';
export const EDITING_TITLE_UPDATED = 'EDITING_TITLE_UPDATED';
export const EDITING_BODY_UPDATED = 'EDITING_BODY_UPDATED';
export const EDITING_SECTION_UPDATED = 'EDITING_SECTION_UPDATED';
export const EDITING_SLUG_ADDED = 'EDITING_SLUG_ADDED';
export const EDITING_NAME_UPDATED = 'EDITING_NAME_UPDATED';
export const EDITING_SUBSTANTIVE_UPDATED = 'EDITING_SUBSTANTIVE_UPDATED';
export const EDITING_PUBLISHED_UPDATED = 'EDITING_PUBLISHED_UPDATED';
export const EDITING_FULL_BLEED_UPDATED = 'EDITING_FULL_BLEED_UPDATED';
export const EDITING_NOTES_UPDATED = 'EDITING_NOTES_UPDATED';
export const EDITING_TODO_UPDATED = 'EDITING_TODO_UPDATED';
export const EDITING_AUTO_TODO_OVERRIDE_ENABLED = 'EDITING_AUTO_TODO_OVERRIDE_ENABLED';
export const EDITING_AUTO_TODO_OVERRIDE_DISABLED = 'EDITING_AUTO_TODO_OVERRIDE_DISABLED';
export const EDITING_AUTO_TODO_OVERRIDE_REMOVED = 'EDITING_AUTO_TODO_OVERRIDE_REMOVED';
export const EDITING_TAG_ADDED = 'EDITING_TAG_ADDED';
export const EDITING_TAG_REMOVED = 'EDITING_TAG_REMOVED';
export const EDITING_SKIPPED_LINK_INBOUND_ADDED = 'EDITING_SKIPPED_LINK_INBOUND_ADDED';
export const EDITING_SKIPPED_LINK_INBOUND_REMOVED = 'EDITING_SKIPPED_LINK_INBOUND_REMOVED';
export const EDITING_EXTRACT_LINKS = 'EDITING_EXTRACT_LINKS';


export const TAB_CONTENT = 'content';
export const TAB_NOTES = 'notes';
export const TAB_TODO = 'todo';

import {
	selectActiveCard,
	selectUserMayEdit,
	selectEditingCard,
	selectSections
} from '../selectors.js';

import {
	modifyCard
} from './data.js';

import {
	isWhitespace,
	arrayDiff,
	cardHasContent,
	triStateMapDiff,
} from '../util.js';

let lastReportedSelectionRange = null;
//TODO: figure out a pattenr that doesn't have a single shared global
let savedSelectionRange = null;

//selection range is weird; you can only listen for changes at the document
//level, but selections wihtin a shadow root are hidden from outside. Certain
//opeartions, like execCommand, operate on a selection state--but if you have
//to do actions in between, like pop a dialog to ask follow-up questions--your
//selection will be lost. The solution we go with is that elements who might
//have a content editable target (e.g. content-card in editing mode) report
//their selected ranged when they have one here, globally.
export const reportSelectionRange = (range) => {
	lastReportedSelectionRange = range;
};

export const saveSelectionRange = () => {
	savedSelectionRange = lastReportedSelectionRange;
};

export const restoreSelectionRange = () => {
	let selection = document.getSelection();
	selection.removeAllRanges();
	selection.addRange(savedSelectionRange);
};

export const editingSelectTab = (tab) => {
	return {
		type: EDITING_SELECT_TAB,
		tab,
	};
};

export const editingStart = () => (dispatch, getState) => {
	const state = getState();
	if (!selectUserMayEdit(state)) {
		console.warn('This user is not allowed to edit!');
		return;
	}
	const card = selectActiveCard(state);
	if (!card || !card.id) {
		console.warn('There doesn\'t appear to be an active card.');
		return;
	}
	dispatch({type: EDITING_START, card: card});
};

export const editingCommit = () => (dispatch, getState) => {
	const state = getState();
	if (!selectUserMayEdit(state)) {
		console.warn('This user isn\'t allowed to edit!');
		return;
	}
	const underlyingCard = selectActiveCard(state);
	if (!underlyingCard || !underlyingCard.id) {
		console.warn('That card isn\'t legal');
		return;
	}

	const updatedCard = selectEditingCard(state);

	if (cardHasContent(updatedCard) && !updatedCard.published) {
		if (!window.confirm('The card has content but is unpublished. Do you want to continue?')) return;
	}

	let update = {};

	if (updatedCard.title != underlyingCard.title) update.title = updatedCard.title;
	if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
	if (updatedCard.name != underlyingCard.section) update.name = updatedCard.name;
	if (updatedCard.notes != underlyingCard.notes) update.notes = updatedCard.notes;
	if (updatedCard.todo != underlyingCard.todo) update.todo = updatedCard.todo;
	if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;
	if (updatedCard.published !== underlyingCard.published) update.published = updatedCard.published;
	if (updatedCard.body != underlyingCard.body) {
		let normalizedBody;
		try {    
			normalizedBody = normalizeBodyHTML(updatedCard.body);
		} catch(err) {
			alert('Couldn\'t save: invalid HTML: ' + err);
			return;
		}
		update.body = normalizedBody;
	}

	let [todoEnablements, todoDisablements, todoRemovals] = triStateMapDiff(underlyingCard.auto_todo_overrides || {}, updatedCard.auto_todo_overrides || {});
	if (todoEnablements.length) update.auto_todo_overrides_enablements = todoEnablements;
	if (todoDisablements.length) update.auto_todo_overrides_disablements = todoDisablements;
	if (todoRemovals.length) update.auto_todo_overrides_removals = todoRemovals;

	let [tagAdditions, tagDeletions] = arrayDiff(underlyingCard.tags || [], updatedCard.tags || []);
	if (tagAdditions.length) update.addTags = tagAdditions;
	if (tagDeletions.length) update.removeTags = tagDeletions;

	let [skippedLinksInboundAdditions, skippedLinksInboundDeletions] = arrayDiff(underlyingCard.auto_todo_skipped_links_inbound || [], updatedCard.auto_todo_skipped_links_inbound || []);
	if (skippedLinksInboundAdditions.length) update.add_skipped_link_inbound = skippedLinksInboundAdditions;
	if (skippedLinksInboundDeletions.length) update.remove_skipped_link_inbound = skippedLinksInboundDeletions;
	
	//modifyCard will fail if the update is a no-op.
	dispatch(modifyCard(underlyingCard, update, state.editor.substantive));

};

export const linkURL = (href) => (dispatch, getState) => {
	const state = getState();
	if (!state.editor.editing) return;
	//TODO: it's weird we do this here, it really should be done on the card-
	//editor component.
	restoreSelectionRange();
	if (href) {
		document.execCommand('createLink', null, href);
	} else {
		document.execCommand('unlink');
	}
};

export const linkCard = (cardID) => (dispatch, getState) => {
	const state = getState();
	if (!state.editor.editing) return;
	//TODO: it's weird we do this here, it really should be done on the card-
	//editor component.
	restoreSelectionRange();
	document.execCommand('createLink', null, cardID);
};

const replaceAsWithCardLinks = (body) => {
	//Replaces all a's with card-links.
	//TODO: consider modifying the actual nodes in place, which is more robust.;
	body = body.split('<a').join('<card-link');
	body = body.split('</a>').join('</card-link>');
	return body;
};

const replaceCardLinksWithAs = (body) => {
	//Inverse of replaceAwsWithCardLinks
	body = body.split('<card-link').join('<a');
	body = body.split('</card-link>').join('</a>');
	return body;
};

const hrefToCardAttribute = (cardLink) => {
  
	let cardAttribute = cardLink.getAttribute('card');
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
	if (href.startsWith('http://')) return;
	if (href.startsWith('https://')) return;

	cardLink.setAttribute('card', href);
	cardLink.removeAttribute('href');

};

const cardAttributeToHref = (a) => {

	let card = a.getAttribute('card');

	if (!card) return;

	a.setAttribute('href', card);
	a.removeAttribute('card');

};

const normalizeBodyFromContentEditable = (html) => {

	//Rewrite elements from content editable form to canonical form (which is
	//primarily replacing <a>'s with <card-link>.)

	//This transform should be the inverse, semantically, of normalizeBodyFromCotentEditable

	html = replaceAsWithCardLinks(html);

	//This is the part where we do live-node fix-ups of stuff that
	//contenteditable might have erroneously spewed in.

	let section = document.createElement('section');
	//TODO: catch syntax errors
	section.innerHTML = html;

	//createLink will have <a href='cardid'>. We will have changed the <a> to
	//<card-link> already, but the href should be a card attribute.
	section.querySelectorAll('card-link').forEach(hrefToCardAttribute);

	return section.innerHTML;
};

export const normalizeBodyToContentEditable = (html) => {
	//inverse transform of normalizeBodyFromContentEditable. contentEditable
	//expects links to be, for example, actual link elements. We only do
	//transforms that are necessary for Chrome's content editable to understand
	//our content. For example, although Chrome's content editable places <b>'s,
	//it understands that <strong>'s are the same thing for the purpose of
	//unbolding.

	html = replaceCardLinksWithAs(html);

	//This is the part where we do live-node fix-ups of stuff that
	//contenteditable might have erroneously spewed in.

	let section = document.createElement('section');
	//TODO: catch syntax errors
	section.innerHTML = html;

	section.querySelectorAll('a').forEach(cardAttributeToHref);

	return section.innerHTML;

};

const removeZombieSpans = (ele) => {
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
		for (let child of ele.children) {
			removeZombieSpans(child);
		}
	}

	let removedZombies = false;
	for (let child of Object.values(ele.childNodes)) {
		if (child.localName == 'span' || child.localName == 'font') {
			//Replace it with either just the text if it's only got 
			child.replaceWith(...child.childNodes);
			removedZombies = true;
		}
	}
	//Combine adjacent text nodes, otherwise when you add back in a space it
	//will show as &nbsp; because it will be between two runs not within one.
	if (removedZombies) ele.normalize();
};

const cleanUpTopLevelHTML = (html, tag = 'p') => {
	//Does deeper changes that require parsing.
	//1) make sure all text in top is within a p tag.
	//2) make sure that p elements don't have any line breaks inside.
	let section = document.createElement('section');
	section.innerHTML = html;
	let children = section.childNodes;
	for (let child of Object.values(children)) {
		if (child.nodeType == Node.TEXT_NODE) {
			if (isWhitespace(child.textContent)) {
				//It's all text content, just get rid of it
				child.parentNode.removeChild(child);
				continue;
			}
			//OK, it's not all whitespace, so wrap it in a default element.
			let ele = document.createElement(tag);
			ele.innerText = child.textContent.trim();
			child.parentNode.replaceChild(ele, child);
			//Deliberately drop dwon into the next processing step.
			child = ele;
		}
		if (child.nodeType == Node.ELEMENT_NODE) {
			if (isWhitespace(child.innerText)) {
				child.parentNode.removeChild(child);
				continue;
			}

			removeZombieSpans(child);

			let inner = child.innerHTML;
			inner = inner.trim();
			child.innerHTML = inner;

			if (child.localName == 'ol' || child.localName == 'ul') {
				child.innerHTML = cleanUpTopLevelHTML(child.innerHTML, 'li');
			}
		}

	}

	return section.innerHTML;

};

export const normalizeBodyHTML = (html) => {

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

	//Remove all line breaks. We'll put them back in.
	html = html.split('\n').join('');

	html = cleanUpTopLevelHTML(html);

	//Add in line breaks
	html = html.split('</p>').join('</p>\n');
	html = html.split('<ul>').join('<ul>\n');
	html = html.split('</ul>').join('</ul>\n');
	html = html.split('<ol>').join('<ol>\n');
	html = html.split('</ol>').join('</ol>\n');
	html = html.split('<li>').join('\t<li>');
	html = html.split('</li>').join('</li>\n');

	html = html.split('&nbsp;').join(' ');

	//Remove any extra linke breaks (which we might have added)
	//html = removeDoubleLineBreaks(html);

	return normalizeBodyFromContentEditable(html);

};

export const editingFinish = () => {
	return {type: EDITING_FINISH};
};

export const titleUpdated = (newTitle, fromContentEditable) => {
	if (!fromContentEditable) fromContentEditable = false;
	return {
		type: EDITING_TITLE_UPDATED,
		title:newTitle,
		fromContentEditable
	};
};

export const notesUpdated = (newNotes) => {
	return {
		type: EDITING_NOTES_UPDATED,
		notes:newNotes,
	};
};

export const todoUpdated = (newTodo) => {
	return {
		type: EDITING_TODO_UPDATED,
		todo: newTodo,
	};
};

var extractLinksTimeout;

export const bodyUpdated = (newBody, fromContentEditable) => (dispatch) => {
	//Make sure we have a timeout to extract links a bit of time after the last edit was made.
	if (extractLinksTimeout) window.clearTimeout(extractLinksTimeout);
	extractLinksTimeout = window.setTimeout(() => {
		extractLinksTimeout = 0;
		dispatch({type: EDITING_EXTRACT_LINKS});
	}, 1000);

	dispatch({
		type: EDITING_BODY_UPDATED,
		//We only run it if it's coming from contentEditable because
		//normalizeBodyHTML assumes the contnet is valid HTML, and if it's been
		//updated in the editor textbox, and for example the end says `</p`,
		//then it's not valid HTML.
		body: fromContentEditable ? normalizeBodyHTML(newBody) : newBody,
		fromContentEditable
	});
};

export const sectionUpdated = (newSection) => (dispatch, getState) => {
	const state = getState();
	const baseCard = selectActiveCard(state);
	const sections = selectSections(state);
	const currentlySubstantive = state.editor.substantive;
	if (baseCard && sections) {
		const oldSection = baseCard.section;
		let sectionKeys = Object.keys(sections);
		let oldSectionIndex = 1000;
		let newSectionIndex = 1000;
		for (let i = 0; i < sectionKeys.length; i++) {
			let sectionKey = sectionKeys[i];
			if (oldSection == sectionKey) oldSectionIndex = i;
			if (newSection == sectionKey) newSectionIndex = i;
		}

		//If the card has been moved to a more-baked section than before, set
		//substantive. If substantive is set and the section is being set back
		//to what it was, unset substantive.
		if (newSectionIndex < oldSectionIndex && !currentlySubstantive) {
			dispatch(substantiveUpdated(true, true));
		} else if(newSectionIndex == oldSectionIndex && currentlySubstantive) {
			dispatch(substantiveUpdated(false, true));
		}
	}

	dispatch({
		type: EDITING_SECTION_UPDATED,
		section: newSection
	});
};

export const slugAdded = (newSlug) => {
	return {
		type: EDITING_SLUG_ADDED,
		slug: newSlug
	};
};

export const nameUpdated = (newName) => {
	return {
		type: EDITING_NAME_UPDATED,
		name: newName
	};
};

export const substantiveUpdated = (checked, auto) => {
	return {
		type: EDITING_SUBSTANTIVE_UPDATED,
		checked,
		auto
	};
};

export const publishedUpdated = (published) => (dispatch, getState) => {

	const state = getState();
	const baseCard = selectActiveCard(state);
	const currentlySubstantive = state.editor.substantive;

	//If the base card wasn't published, and now is, and substantive isn't
	//already checked, check it. If we're setting to unpublished (as base card
	//is) and we're currently substantive, uncheck it.
	if (baseCard && !baseCard.published) {
		if (!currentlySubstantive && published) {
			dispatch(substantiveUpdated(true, true));
		} else if(currentlySubstantive && !published) {
			dispatch(substantiveUpdated(false, true));
		}
	}

	dispatch({
		type: EDITING_PUBLISHED_UPDATED,
		published,
	});
};

export const fullBleedUpdated = (fullBleed) => {
	return {
		type: EDITING_FULL_BLEED_UPDATED,
		fullBleed
	};
};

export const autoTodoOverrideEnabled = (todo) => {
	return {
		type: EDITING_AUTO_TODO_OVERRIDE_ENABLED,
		todo
	};
};

export const autoTodoOverrideDisabled = (todo) => {
	return {
		type: EDITING_AUTO_TODO_OVERRIDE_DISABLED,
		todo
	};
};

export const autoTodoOverrideRemoved = (todo) => {
	return {
		type: EDITING_AUTO_TODO_OVERRIDE_REMOVED,
		todo
	};
};

export const tagAdded = (tag) => {
	return {
		type: EDITING_TAG_ADDED,
		tag
	};
};

export const tagRemoved = (tag) => {
	return {
		type: EDITING_TAG_REMOVED,
		tag
	};
};

export const skippedLinkInboundAdded = (link) => {
	return {
		type: EDITING_SKIPPED_LINK_INBOUND_ADDED,
		link
	};
};

export const skippedLinkInboundRemoved = (link) => {
	return {
		type: EDITING_SKIPPED_LINK_INBOUND_REMOVED,
		link
	};
};
