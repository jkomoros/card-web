
import {
	arrayRemove,
	arrayUnion,
	extractCardLinksFromBody,
	reasonCardTypeNotLegalForCard,
} from './util.js';

import {
	getUserMayEditSection,
	getUserMayEditTag,
} from './selectors.js';

import {
	PERMISSION_EDIT_CARD
} from './permissions.js';

import {
	CARD_TYPE_CONFIGURATION,
	TEXT_FIELD_CONFIGURATION,
	TEXT_FIELD_BODY,
	fontSizeBoosts
} from './card_fields.js';

import {
	normalizeBodyHTML
} from './contenteditable.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from './card_finishers.js';

import {
	references,
	applyReferencesDiff,
	referencesEntriesDiff
} from './references.js';

import {
	imageBlocksEquivalent,
	getImagesFromCard,
} from './images.js';

import {
	arrayDiff,
	cardHasContent,
	triStateMapDiff,
} from './util.js';

const FREE_TEXT_FIELDS = Object.fromEntries([...Object.keys(TEXT_FIELD_CONFIGURATION).filter(key => !TEXT_FIELD_CONFIGURATION[key].readOnly), 'todo', 'notes'].map(item => [item, true]));

//Images can't be merged correctly (only overwritten) because they aren't
//diffed. Mainly free text fields, but also the images field.
const NON_AUTOMATIC_MERGE_FIELDS = Object.fromEntries(Object.keys(FREE_TEXT_FIELDS).concat(
	['images']
).map(key => [key, true]));

const LEGAL_UPDATE_FIELDS =  Object.fromEntries(Object.keys(NON_AUTOMATIC_MERGE_FIELDS).concat([
	'name',
	'section',
	'full_bleed',
	'auto_todo_overrides_enablements',
	'auto_todo_overrides_disablements',
	'auto_todo_overrides_removals',
	'add_editors',
	'remove_editors',
	'add_collaborators',
	'remove_collaborators',
	'addTags',
	'removeTags',
	'published',
	'card_type',
	'font_size_boost',
	'references_diff',
]).map(key => [key,true]));

//Returns true if the user has said to proceed to any confirmation warnings (if
//any), false if the user has said to not proceed.
export const confirmationsForCardDiff = (update, updatedCard) => {
	const CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[update.card_type || updatedCard.card_type];
	if (CARD_TYPE_CONFIG.publishedByDefault) {
		if (!updatedCard.published) {
			if (!window.confirm('This card is of a type that is typically always published, but it\'s not currently published. Do you want to continue?')) return false;
		}
	} else if (CARD_TYPE_CONFIG.invertContentPublishWarning) {
		if (updatedCard.published) {
			if (!window.confirm('The card is of a type that is not typically published but you\'re publishing it. Do you want to continue?')) return false;
		}
	} else {
		if (cardHasContent(updatedCard) && !updatedCard.published) {
			if (!window.confirm('The card has content but is unpublished. Do you want to continue?')) return false;
		}
	}
	for (const img of getImagesFromCard(updatedCard)) {
		if (img.height === undefined || img.width === undefined) {
			alert('One of the images does not yet have its height/width set yet. It might still be loading. Try removing it and readding it.');
			return false;
		}
	}

	if (update.section !== undefined || update.card_type !== undefined) {
		let section = update.section === undefined ? updatedCard.section : update.section;
		if (!section){
			if (!CARD_TYPE_CONFIG.orphanedByDefault && !confirm('This card being orphaned will cause it to not be findable except with a direct link. OK?')) {
				return false;
			}
		} else {
			if (CARD_TYPE_CONFIG.orphanedByDefault && !confirm('This is a card type that typcially is not in a section, but with this edit it will be in a section. OK?')) {
				return false;
			}
		}
	}

	return true;
};

export const generateCardDiff = (underlyingCard, updatedCard) => {

	if (!underlyingCard) underlyingCard = {};
	if (!updatedCard) updatedCard = {};

	if (underlyingCard === updatedCard) return {};

	let update = {};

	for (let field of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		if (updatedCard[field] == underlyingCard[field]) continue;
		const config = TEXT_FIELD_CONFIGURATION[field];
		if (config.readOnly) continue;
		let value = updatedCard[field];
		if (config.html) {
			try {
				value = normalizeBodyHTML(value);
			} catch(err) {
				throw new Error('Couldn\'t save: invalid HTML: ' + err);
			}
		}
		update[field] = value;
		if (field !== TEXT_FIELD_BODY) continue;
		let linkInfo = extractCardLinksFromBody(value);
		references(updatedCard).setLinks(linkInfo);
	}

	if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
	if (updatedCard.name != underlyingCard.name) update.name = updatedCard.name;
	if (updatedCard.notes != underlyingCard.notes) update.notes = updatedCard.notes;
	if (updatedCard.todo != underlyingCard.todo) update.todo = updatedCard.todo;
	if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;
	if (updatedCard.published !== underlyingCard.published) update.published = updatedCard.published;
	if (updatedCard.card_type !== underlyingCard.card_type) update.card_type = updatedCard.card_type;

	let [todoEnablements, todoDisablements, todoRemovals] = triStateMapDiff(underlyingCard.auto_todo_overrides || {}, updatedCard.auto_todo_overrides || {});
	if (todoEnablements.length) update.auto_todo_overrides_enablements = todoEnablements;
	if (todoDisablements.length) update.auto_todo_overrides_disablements = todoDisablements;
	if (todoRemovals.length) update.auto_todo_overrides_removals = todoRemovals;

	let [tagAdditions, tagDeletions] = arrayDiff(underlyingCard.tags || [], updatedCard.tags || []);
	if (tagAdditions.length) update.addTags = tagAdditions;
	if (tagDeletions.length) update.removeTags = tagDeletions;

	let [editorAdditions, editorDeletions] = arrayDiff((underlyingCard.permissions && underlyingCard.permissions[PERMISSION_EDIT_CARD] ? underlyingCard.permissions[PERMISSION_EDIT_CARD] : []), (updatedCard.permissions && updatedCard.permissions[PERMISSION_EDIT_CARD] ? updatedCard.permissions[PERMISSION_EDIT_CARD] : []));
	if (editorAdditions.length) update.add_editors = editorAdditions;
	if (editorDeletions.length) update.remove_editors = editorDeletions;

	let [collaboratorAdditions, collaboratorDeletions] = arrayDiff(underlyingCard.collaborators || [], updatedCard.collaborators || []);
	if (collaboratorAdditions.length) update.add_collaborators = collaboratorAdditions;
	if (collaboratorDeletions.length) update.remove_collaborators = collaboratorDeletions;

	if (!imageBlocksEquivalent(underlyingCard, updatedCard)) update.images = updatedCard.images;

	//references might have changed outside of this function, or because the
	//body changed and we extracted links.
	if (!references(underlyingCard).equivalentTo(updatedCard)) update.references_diff = referencesEntriesDiff(underlyingCard, updatedCard);

	return update;
};

export const cardDiffHasChanges = (diff) => {
	if (!diff) return false;
	return Object.keys(diff).length > 0;
};

export const cardDiffDescription = (diff) => {
	if (!cardDiffHasChanges(diff)) return '';
	return JSON.stringify(diff, '', 2);
};

//Returns a diff that includes only fields that were modified between original
//and snapshot and then shadowed by changes between snapshot and current.
export const overshadowedDiffChanges = (original, snapshot, current) => {
	const snapshotDiff = generateCardDiff(original, snapshot);
	const currentDiff = generateCardDiff(snapshot, current);
	const result = {};
	for (const [field, change] of Object.entries(currentDiff)) {
		if (!NON_AUTOMATIC_MERGE_FIELDS[field]) continue;
		if (snapshotDiff[field] === undefined) continue;
		result[field] = change;
	}
	return result;
};

//generateFinalCardDiff is like generateCardDiff but also handles fields set by cardFinishers and font size boosts.
export const generateFinalCardDiff = async (state, underlyingCard, rawUpdatedCard) => {

	const cardFinisher = CARD_TYPE_EDITING_FINISHERS[rawUpdatedCard.card_type];

	//updatedCard is a copy so may be modified
	const updatedCard = {...rawUpdatedCard};

	try {
		if(cardFinisher) cardFinisher(updatedCard, state);
	} catch(err) {
		throw new Error('The card finisher threw an error: ' + err);
	}

	//Throw out any boosts that might have been applied to an old card type.
	if (updatedCard.card_type != underlyingCard.card_type) updatedCard.font_size_boost = {};

	updatedCard.font_size_boost = await fontSizeBoosts(updatedCard);

	const update = generateCardDiff(underlyingCard, updatedCard);

	if (Object.keys(updatedCard.font_size_boost).length != Object.keys(underlyingCard.font_size_boost || {}).length || Object.entries(updatedCard.font_size_boost).some(entry => (underlyingCard.font_size_boost || {})[entry[0]] != entry[1])) update.font_size_boost = updatedCard.font_size_boost;

	return update;
};

//applyCardDiff returns a cardUpdate object with only the fields that change in
//diff set. You can modify a card object to be the new one with,
//{...underlyingCard, ...cardUpdate}. This function does not do any validation
//that these changes are legal.
export const applyCardDiff = (underlyingCard, diff) => {

	const cardUpdateObject = {};

	for (let field of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		if (diff[field] === undefined) continue;
		cardUpdateObject[field] = diff[field];
	}

	if (diff.references_diff !== undefined) {
		const cardCopy = {...underlyingCard};
		const refs = references(cardCopy);
		refs.applyEntriesDiff(diff.references_diff);
		//NOTE: this is where the raw references property values are also updated
		applyReferencesDiff(underlyingCard, cardCopy, cardUpdateObject);
	}

	if (diff.notes !== undefined) {
		cardUpdateObject.notes = diff.notes;
	}

	if (diff.todo !== undefined) {
		cardUpdateObject.todo = diff.todo;
	}

	if (diff.published !== undefined) {
		cardUpdateObject.published = diff.published;
	}

	if (diff.font_size_boost !== undefined) {
		cardUpdateObject.font_size_boost = diff.font_size_boost;
	}

	if (diff.images !== undefined) {
		cardUpdateObject.images = diff.images;
	}

	//It's never legal to not have a name, so only update if it's not falsey.
	if (diff.name) {
		//TODO: really we should verify that this name is legal--that is, either the id or one of the slugs.
		cardUpdateObject.name = diff.name;
	}


	if (diff.section !== undefined) {
		cardUpdateObject.section = diff.section;
	}

	if (diff.card_type !== undefined) {
		cardUpdateObject.card_type = diff.card_type;
	}

	if (diff.full_bleed !== undefined) {
		cardUpdateObject.full_bleed = diff.full_bleed;
	}

	if (diff.addTags || diff.removeTags) {
		let tags = underlyingCard.tags;
		if (diff.removeTags) {
			tags = arrayRemove(tags, diff.removeTags);
		}
		if (diff.addTags) {
			tags = arrayUnion(tags, diff.addTags);
		}
		cardUpdateObject.tags = tags;
	}

	if (diff.add_editors || diff.remove_editors) {
		let editors = underlyingCard.permissions[PERMISSION_EDIT_CARD];
		if (diff.remove_editors) editors = arrayRemove(editors, diff.remove_editors);
		if (diff.add_editors) {
			editors = arrayUnion(editors, diff.add_editors);
		}
		cardUpdateObject['permissions.' + PERMISSION_EDIT_CARD] = editors;
	}

	if (diff.add_collaborators || diff.remove_collaborators) {
		let collaborators = underlyingCard.collaborators;
		if (diff.remove_collaborators) collaborators = arrayRemove(collaborators, diff.remove_collaborators);
		if (diff.add_collaborators) collaborators = arrayUnion(collaborators, diff.add_collaborators);
		cardUpdateObject.collaborators = collaborators;
	}

	if (diff.auto_todo_overrides_enablements || diff.auto_todo_overrides_disablements || diff.auto_todo_overrides_removals) {
		let overrides = {...underlyingCard.auto_todo_overrides || {}};
		if (diff.auto_todo_overrides_enablements) diff.auto_todo_overrides_enablements.forEach(key => overrides[key] = true);
		if (diff.auto_todo_overrides_disablements) diff.auto_todo_overrides_disablements.forEach(key => overrides[key] = false);
		if (diff.auto_todo_overrides_removals) diff.auto_todo_overrides_removals.forEach(key => delete overrides[key]);
		cardUpdateObject.auto_todo_overrides = overrides;
	}

	return cardUpdateObject;
};


//validateCardDiff returns true if sections update. It throws an error if the diff isn't valid or was rejected by a user.
export const validateCardDiff = (state, underlyingCard, diff) => {
	for (let key of Object.keys(diff)) {
		if (!LEGAL_UPDATE_FIELDS[key]) {
			throw new Error('Illegal field in update: ' + key, diff);
		}
	}

	if (diff.references_diff !== undefined) {
		const cardCopy = {...underlyingCard};
		const refs = references(cardCopy);
		const reason = refs.mayNotApplyEntriesDiffReason(state, diff.references_diff);
		if (reason) {
			throw new Error('References diff created error: ' + reason);
		}
	}

	if (diff.card_type !== undefined) {
		const illegalReason = reasonCardTypeNotLegalForCard(underlyingCard, diff.card_type);
		if (illegalReason) {
			throw new Error('Can\'t change the card_type: ' + illegalReason);
		}
	}

	if (diff.addTags || diff.removeTags) {
		if (diff.removeTags) {
			for (let tag of diff.removeTags) {
				if (!getUserMayEditTag(state, tag)) {
					throw new Error('User is not allowed to edit tag: ' + tag);
				}
			}
		}
		if (diff.addTags) {
			for (let tag of diff.addTags) {
				if (!getUserMayEditTag(state, tag)) {
					throw new Error('User is not allowed to edit tag: ' + tag);
				}
			}
		}
	}

	if (diff.add_editors) {
		if (!confirm('You\'ve added editors. Those users will be able to edit this card. OK?')) {
			throw new Error('User aborted because didn\'t confirm editing');
		}
	}

	if (diff.section !== undefined) {
		if (diff.section) {
			if (!getUserMayEditSection(state, diff.section)) {
				throw new Error('The user cannot modify the section the card is moving to');
			}
		}
		if (underlyingCard.section) {
			if (!getUserMayEditSection(state, underlyingCard.section)) {
				throw new Error('The section the card is leaving is not one the user has edit access for');
			}
		}
		return true;
	}

	return false;
};