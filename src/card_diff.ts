
import {
	applyCardFlags,
	arrayRemoveUtil,
	arrayUnionUtil,
	diffCardFlags,
	extractCardLinksFromBody,
	innerTextForHTML,
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
	fontSizeBoosts
} from './card_fields.js';

import {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
} from './type_constants.js';

import {
	normalizeBodyHTML
} from './contenteditable.js';

import {
	CARD_TYPE_EDITING_FINISHERS
} from './card_finishers.js';

import {
	references,
	applyReferencesDiff,
	referencesEntriesDiff,
	referencesCardsDiff,
	isExpandedReferenceDelete
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

import {
	isDeleteSentinel,
	isServerTimestampSentinel,
	currentTimestamp,
} from './firebase.js';

import {
	deleteField
} from 'firebase/firestore';

import {
	State,
	Card,
	CardID,
	CardDiff,
	CardUpdate,
	OptionalFieldsCard,
	CardLike,
	DottedCardUpdate,
	FirestoreLeafValue,
	autoTODOTypeArray,
	cardFieldTypeEditableSchema,
	ReferencesEntriesDiff,
	SuggestionDiff,
	Suggestion,
	TagInfos,
	SuggestionDiffCreateCard,
	CardFlags,
	ReferenceType,
	TagID,
	AutoTODOType
} from './types.js';

import {
	TypedObject
} from './typed_object.js';

import {
	TemplateResult,
	html
} from 'lit';

//descriptionForReferencesDiff and descriptionForSuggestionDiffCards assumes tag-list is imported, so make sure
import './components/tag-list.js';

//A JS-native version of the allowed fields in type NonAutoMergeableCardDiff
const NON_AUTOMATIC_MERGE_FIELDS : {[cardDiffFields : string]: true} = {
	title : true,
	title_alternates : true,
	body : true,
	subtitle : true,
	todo : true,
	notes : true,
	external_link: true,
	images : true,
};

export const descriptionForReferencesDiff = (diff : ReferencesEntriesDiff, cardInfos : TagInfos) : TemplateResult[] => {
	//For space, we'll combine the summary by similar reference types.
	const cardsByReferenceTypeAdditions : {[ref in ReferenceType]+?: CardID[]} = {};
	const cardsByReferenceTypeDeletions : {[ref in ReferenceType]+? : CardID[]} = {};
	for (const item of diff) {
		const map = isExpandedReferenceDelete(item) ? cardsByReferenceTypeDeletions : cardsByReferenceTypeAdditions;
		let arr = map[item.referenceType];
		if (!arr) {
			arr = [];
			map[item.referenceType] = arr;
		}
		arr.push(item.cardID);
	}
	const result : TemplateResult[] = [];
	for (const [referenceType, cards] of TypedObject.entries(cardsByReferenceTypeAdditions)) {
		if (!cards) continue;
		result.push(html`Add <strong>${referenceType}</strong> reference${cards.length > 1 ? 's' : ''} pointing to <tag-list .tags=${cards} .tagInfos=${cardInfos} .tapEvents=${true} .inline=${true}></tag-list>`);
	}
	for (const [referenceType, cards] of TypedObject.entries(cardsByReferenceTypeDeletions)) {
		if (!cards) continue;
		result.push(html`Remove <strong>${referenceType}</strong> reference${cards.length > 1 ? 's' : ''} pointing to <tag-list .tags=${cards} .tagInfos=${cardInfos} .tapEvents=${true} .inline=${true}></tag-list>`);
	}
	return result;
};

export const descriptionForCardDiff = (update : CardDiff, cardInfos : TagInfos): TemplateResult[] => {

	let flagsMessages : string[] = [];

	const pieces : {[key in keyof CardDiff]+?: TemplateResult[]} = {};
	for (const [key, value] of TypedObject.entries(update)) {
		if (key == 'references_diff') {
			pieces[key] = descriptionForReferencesDiff(value as ReferencesEntriesDiff, cardInfos);
			continue;
		}

		if (key == 'set_flags') {
			flagsMessages = [...flagsMessages, ...TypedObject.entries(value as CardFlags).map(entry => `Set flag ${entry[0]} to ${JSON.stringify(entry[1])}`)];
			//We'll set the message at the end
			continue;
		}

		if (key == 'remove_flags') {
			flagsMessages = [...flagsMessages, ...TypedObject.keys(value as CardFlags).map(key => `Remove flag ${key}`)];
			//We'll set the message at the end
			continue;
		}

		if (key == 'add_tags') {
			pieces[key] = (value as TagID[]).map(key => html`Add tag <strong>${key}</strong>`);
			continue;
		}

		if (key == 'remove_tags') {
			pieces[key] = (value as TagID[]).map(key => html`Remove tag <strong>${key}</strong>`);
			continue;
		}

		//TODO: the wording of these messages is confusing for the prioritized
		//key, whose specific values are very idiosyncratic.

		if (key == 'auto_todo_overrides_removals') {
			pieces[key] = (value as AutoTODOType[]).map(value => {
				if (value == 'prioritized') return html`Un-prioritize card`;
				return html`Set back to auto ${value} TODO`;
			});
			continue;
		}

		if (key == 'auto_todo_overrides_disablements') {
			pieces[key] = (value as AutoTODOType[]).map(value => {
				if (value == 'prioritized') return html`Prioritize card`;
				return html`Set TODO ${value} off`;
			});
			continue;
		}

		if (key == 'auto_todo_overrides_enablements') {
			pieces[key] = (value as AutoTODOType[]).map(value => {
				if (value == 'prioritized') return html`Un-prioritize card`;
				return html`Set TODO ${value} on`;
			});
			continue;
		}

		const editableFieldParseResult = cardFieldTypeEditableSchema.safeParse(key);
		if (editableFieldParseResult.success) {
			const editableField = editableFieldParseResult.data;
			const fieldConfig = TEXT_FIELD_CONFIGURATION[editableField];
			const fieldValue = value as string;
			let plainFieldValue = fieldConfig.html ? innerTextForHTML(fieldValue) : fieldValue;
			if (plainFieldValue.length > BODY_SUMMARY_LENGTH) plainFieldValue = plainFieldValue.slice(0, BODY_SUMMARY_LENGTH) + '...';
			pieces[key] = [html`Set <strong>${editableField}</strong> to "<span title=${fieldValue}>${plainFieldValue}</span>"`];
			continue;
		}

		//TODO: handle non diffable fields
		pieces[key] = [html`Set <strong>${key}</strong> to ${JSON.stringify(value, null, '\t')}`];
	}

	if (flagsMessages.length) {
		//We set these specially since set_Flags and remove_flags both show
		//similarly to a user (but with different tool tips) and we don't awnt
		//to have a visible dupe if both set_flags and remove_flags are set
		//(which is rare, but possible)
		pieces['set_flags'] =[html`Minor <span title=${flagsMessages.join('\n')}>bookkeeping changes</span>`];
	}

	return Object.values(pieces).flat();


};

const descriptionForSuggestionDiffCards = (cards: CardID[], diff : CardDiff, cardInfos : TagInfos) : TemplateResult => {
	return html`For the card${cards.length > 1 ? 's' : ''} <tag-list .tags=${cards} .tagInfos=${cardInfos} .tapEvents=${true} .inline=${true}></tag-list>
		<ul>
			${descriptionForCardDiff(diff, cardInfos).map(tmpl => html`<li>${tmpl}</li>`)}
		</ul>
	`;
};

//At how many characters should we show?
const BODY_SUMMARY_LENGTH = 200;

const descriptionForCreateCard = (diff : SuggestionDiffCreateCard) : TemplateResult => {
	const mainPart = html`Create card`;
	const typePart = diff.card_type ? html` of type <strong>${diff.card_type}</strong>` : html``;
	const titlePart = diff.title ? html` with title ${diff.title}` : html``;
	let bodyPart = html``;
	if (diff.body) {
		let plainBody = innerTextForHTML(diff.body);
		if (plainBody.length > BODY_SUMMARY_LENGTH) plainBody = plainBody.slice(0, BODY_SUMMARY_LENGTH) + '...';
		bodyPart = html` with body "<span title=${diff.body}>${plainBody}</span>"`;
	}
	return html`${mainPart}${typePart}${titlePart}${bodyPart}. `;
};

const descriptionForSuggestionDiff = (suggestion : Suggestion, diff : SuggestionDiff, cardInfos : TagInfos) : TemplateResult => {
	//TODO: if createCard, then modify tagInfos too.
	const newCardDiff = diff.createCard ? descriptionForCreateCard(diff.createCard) : html``;
	const keyCardsDiff = diff.keyCards ? descriptionForSuggestionDiffCards(suggestion.keyCards, diff.keyCards, cardInfos) : html``;
	const supportingCardsDiff = diff.supportingCards ? descriptionForSuggestionDiffCards(suggestion.supportingCards, diff.supportingCards, cardInfos) : html``;
	return html`
		${newCardDiff ? html`<p>${newCardDiff}</p>` : html``}
		${keyCardsDiff ? html`<p>${keyCardsDiff}</p>` : html``}
		${supportingCardsDiff ? html`<p>${supportingCardsDiff}</p>` : html``}
	`;
};

type SuggestionDescription = {
	primary?: TemplateResult,
	alternate?: TemplateResult,
	rejection?: TemplateResult
};

export const descriptionForSuggestion = (suggestion : Suggestion | undefined, cardInfos : TagInfos) : SuggestionDescription => {
	if (!suggestion) return {};
	const result : SuggestionDescription = {
		primary: descriptionForSuggestionDiff(suggestion, suggestion.action, cardInfos),
	};
	if (suggestion.alternateAction) result.alternate = descriptionForSuggestionDiff(suggestion, suggestion.alternateAction, cardInfos);
	if (suggestion.rejection) result.rejection = descriptionForSuggestionDiff(suggestion, suggestion.rejection, cardInfos);
	return result;
};

//Returns true if the user has said to proceed to any confirmation warnings (if
//any), false if the user has said to not proceed.
export const confirmationsForCardDiff = (update :CardDiff, updatedCard : Card) => {
	const CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[update.card_type || updatedCard.card_type];
	if (!CARD_TYPE_CONFIG) throw new Error('No card config');
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
		const section = update.section === undefined ? updatedCard.section : update.section;
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

export const generateCardDiff = (underlyingCardIn : Card | null | undefined, updatedCardIn : Card | undefined | null, normalizeHTMLFields  = false) : CardDiff => {

	const underlyingCard : OptionalFieldsCard = underlyingCardIn || {};
	const updatedCard : OptionalFieldsCard = updatedCardIn || {};

	if (underlyingCard === updatedCard) return {};

	const update : CardDiff = {};

	for (const field of cardFieldTypeEditableSchema.options) {
		if (updatedCard[field] == underlyingCard[field]) continue;
		const config = TEXT_FIELD_CONFIGURATION[field];
		if (config.readOnly) continue;
		let value = updatedCard[field] || '';
		if (config.html && normalizeHTMLFields) {
			try {
				value = normalizeBodyHTML(value);
			} catch(err) {
				throw new Error('Couldn\'t save: invalid HTML: ' + err);
			}
		}
		update[field] = value;
		if (field !== 'body') continue;
		const linkInfo = extractCardLinksFromBody(value);
		references(updatedCard).setLinks(linkInfo);
	}

	if (updatedCard.section != underlyingCard.section) update.section = updatedCard.section;
	if (updatedCard.name != underlyingCard.name) update.name = updatedCard.name;
	if (updatedCard.notes != underlyingCard.notes) update.notes = updatedCard.notes;
	if (updatedCard.todo != underlyingCard.todo) update.todo = updatedCard.todo;
	if (updatedCard.full_bleed != underlyingCard.full_bleed) update.full_bleed = updatedCard.full_bleed;
	if (updatedCard.published !== underlyingCard.published) update.published = updatedCard.published;
	if (updatedCard.card_type !== underlyingCard.card_type) update.card_type = updatedCard.card_type;
	if (updatedCard.sort_order !== underlyingCard.sort_order) update.sort_order = updatedCard.sort_order;

	const [todoEnablements, todoDisablements, todoRemovals] = triStateMapDiff(underlyingCard.auto_todo_overrides || {}, updatedCard.auto_todo_overrides || {});
	if (todoEnablements.length) update.auto_todo_overrides_enablements = autoTODOTypeArray.parse(todoEnablements);
	if (todoDisablements.length) update.auto_todo_overrides_disablements = autoTODOTypeArray.parse(todoDisablements);
	if (todoRemovals.length) update.auto_todo_overrides_removals = autoTODOTypeArray.parse(todoRemovals);

	const [tagAdditions, tagDeletions] = arrayDiff(underlyingCard.tags || [], updatedCard.tags || []);
	if (tagAdditions.length) update.add_tags = tagAdditions;
	if (tagDeletions.length) update.remove_tags = tagDeletions;

	const [editorAdditions, editorDeletions] = arrayDiff((underlyingCard.permissions && underlyingCard.permissions[PERMISSION_EDIT_CARD] ? underlyingCard.permissions[PERMISSION_EDIT_CARD] : []), (updatedCard.permissions && updatedCard.permissions[PERMISSION_EDIT_CARD] ? updatedCard.permissions[PERMISSION_EDIT_CARD] : []));
	if (editorAdditions.length) update.add_editors = editorAdditions;
	if (editorDeletions.length) update.remove_editors = editorDeletions;

	const [collaboratorAdditions, collaboratorDeletions] = arrayDiff(underlyingCard.collaborators || [], updatedCard.collaborators || []);
	if (collaboratorAdditions.length) update.add_collaborators = collaboratorAdditions;
	if (collaboratorDeletions.length) update.remove_collaborators = collaboratorDeletions;

	const [set_flags, remove_flags] = diffCardFlags(underlyingCard.flags, updatedCard.flags);
	if (set_flags) update.set_flags = set_flags;
	if (remove_flags) update.remove_flags = remove_flags;

	if (!imageBlocksEquivalent(underlyingCard, updatedCard)) update.images = updatedCard.images;

	//references might have changed outside of this function, or because the
	//body changed and we extracted links.
	if (!references(underlyingCard).equivalentTo(updatedCard)) update.references_diff = referencesEntriesDiff(underlyingCard, updatedCard);

	return update;
};

export const cardDiffHasChanges = (diff : CardDiff) : boolean => {
	if (!diff) return false;
	return Object.keys(diff).length > 0;
};

export const cardDiffDescription = (diff : CardDiff) : string => {
	if (!cardDiffHasChanges(diff)) return '';
	return JSON.stringify(diff, null, 2);
};

//Returns a diff that includes only fields that were modified between original
//and snapshot and then shadowed by changes between snapshot and current.
export const overshadowedDiffChanges = (original : Card | null, snapshot : Card | null, current : Card | null) : CardDiff => {
	const snapshotDiff = generateCardDiff(original, snapshot);
	const currentDiff = generateCardDiff(snapshot, current);
	return Object.fromEntries(TypedObject.entries(currentDiff).filter(entry => !NON_AUTOMATIC_MERGE_FIELDS[entry[0]] && snapshotDiff[entry[0]] !== undefined));
};

//generateFinalCardDiff is like generateCardDiff but also handles fields set by cardFinishers and font size boosts.
export const generateFinalCardDiff = async (state : State, underlyingCard : Card, rawUpdatedCard : Card) : Promise<CardDiff> => {

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

	const update = generateCardDiff(underlyingCard, updatedCard, true);

	if (Object.keys(updatedCard.font_size_boost).length != Object.keys(underlyingCard.font_size_boost || {}).length || TypedObject.entries(updatedCard.font_size_boost).some(entry => (underlyingCard.font_size_boost || {})[entry[0]] != entry[1])) update.font_size_boost = updatedCard.font_size_boost;

	return update;
};

//applyCardFirebaseUpdate takes a firebaseUpdate (like the one returned from
//applyCardDiff) and applies it to baseCard to generate a new cloned card
//update. FirebaseUpdates are like normal objects, but might have dotted-string
//keys (representing deeper layers in the object) and deleteSentinels. This
//method only clones as deeply down into the objects as it needs to. If
//replaceTimestampSentinels is true, then every time it sees a
//serverTimestampSentinel in the firebaseUpdate, it will instead put in a
//currentTimestamp()>
export const applyCardFirebaseUpdate = (baseCard : Card, firebaseUpdate : CardUpdate, replaceTimestampSentinels  = false) : Card => {
	//TODO: test this.

	//This clone is only one layer deep!
	const result = {...baseCard};
	for (const [key, value] of Object.entries(firebaseUpdate)) {
		setFirebaseValueOnObj(result, key.split('.'), value, replaceTimestampSentinels);
	}
	return result;
};

//Similar to util.ts:setValueOnObj
const setFirebaseValueOnObj = (obj : {[field : string]: unknown}, fieldParts : string[], value : FirestoreLeafValue, replaceTimestampSentinels  = false) => {
	//Obj is an object it's OK to modify, but no other subobjects are.

	const firstFieldPart = fieldParts[0];
	//Modifies obj in place.
	if (fieldParts.length == 1) {
		//Base case, operate in place.
		if (isDeleteSentinel(value)) {
			delete obj[firstFieldPart];
			return;
		}
		if (isServerTimestampSentinel(value)) {
			obj[firstFieldPart] = currentTimestamp();
			return;
		}
		obj[firstFieldPart] = value;
		return;
	} 
	//If descending into sub-oject, create a copy for that field before descending!
	//And create a new sub object if necessary
	const newObj = obj[firstFieldPart] && typeof obj[firstFieldPart] == 'object' ? {...(obj[firstFieldPart] as object)} : {};
	obj[firstFieldPart] = newObj;
	setFirebaseValueOnObj(newObj, fieldParts.slice(1), value, replaceTimestampSentinels);
};

//applyCardDiff returns a cardFirebaseUpdate object with only the fields that
//change in diff set. This function does not do any validation that these
//changes are legal. You can apply this change ot an underlying card with
//applyCardFirebaseUpdate.
export const applyCardDiff = (underlyingCard : Card, diff : CardDiff) : CardUpdate => {

	const cardUpdateObject : CardUpdate = {};

	for (const field of cardFieldTypeEditableSchema.options) {
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

	if (diff.sort_order !== undefined) {
		cardUpdateObject.sort_order = diff.sort_order;
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

	if (diff.set_flags || diff.remove_flags) {
		cardUpdateObject.flags = applyCardFlags(underlyingCard.flags ,diff.set_flags, diff.remove_flags);
	}

	if (diff.add_tags || diff.remove_tags) {
		let tags = underlyingCard.tags;
		if (diff.remove_tags) {
			tags = arrayRemoveUtil(tags, diff.remove_tags);
		}
		if (diff.add_tags) {
			tags = arrayUnionUtil(tags, diff.add_tags);
		}
		cardUpdateObject.tags = tags;
	}

	if (diff.add_editors || diff.remove_editors) {
		let editors = underlyingCard.permissions[PERMISSION_EDIT_CARD] || [];
		if (diff.remove_editors) editors = arrayRemoveUtil(editors, diff.remove_editors);
		if (diff.add_editors) {
			editors = arrayUnionUtil(editors, diff.add_editors);
		}
		cardUpdateObject['permissions.' + PERMISSION_EDIT_CARD] = editors;
	}

	if (diff.add_collaborators || diff.remove_collaborators) {
		let collaborators = underlyingCard.collaborators;
		if (diff.remove_collaborators) collaborators = arrayRemoveUtil(collaborators, diff.remove_collaborators);
		if (diff.add_collaborators) collaborators = arrayUnionUtil(collaborators, diff.add_collaborators);
		cardUpdateObject.collaborators = collaborators;
	}

	if (diff.auto_todo_overrides_enablements || diff.auto_todo_overrides_disablements || diff.auto_todo_overrides_removals) {
		const overrides = {...underlyingCard.auto_todo_overrides || {}};
		if (diff.auto_todo_overrides_enablements) diff.auto_todo_overrides_enablements.forEach(key => overrides[key] = true);
		if (diff.auto_todo_overrides_disablements) diff.auto_todo_overrides_disablements.forEach(key => overrides[key] = false);
		if (diff.auto_todo_overrides_removals) diff.auto_todo_overrides_removals.forEach(key => delete overrides[key]);
		cardUpdateObject.auto_todo_overrides = overrides;
	}

	return cardUpdateObject;
};


//validateCardDiff returns true if sections update. It throws an error if the diff isn't valid or was rejected by a user.
export const validateCardDiff = (state : State, underlyingCard : Card, diff : CardDiff) => {

	for (const field of cardFieldTypeEditableSchema.options) {
		if (diff[field] === undefined) continue;
		const config = TEXT_FIELD_CONFIGURATION[field];
		if (!config.validator) continue;
		const err = config.validator(diff[field], diff.card_type || underlyingCard.card_type);
		if (!err) continue;
		throw new Error(`Field ${field} didn't pass the validator: ${err}`);
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

	if (diff.add_tags || diff.remove_tags) {
		if (diff.remove_tags) {
			for (const tag of diff.remove_tags) {
				if (!getUserMayEditTag(state, tag)) {
					throw new Error('User is not allowed to edit tag: ' + tag);
				}
			}
		}
		if (diff.add_tags) {
			for (const tag of diff.add_tags) {
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

//Returns an object of cardID -> firebaseUpdate to make to bring the
//inboundLinks to parity based on the change in beforeCard to afterCard.
export const inboundLinksUpdates = (cardID : CardID, beforeCard : CardLike | null, afterCard : CardLike) : {[id : CardID] : DottedCardUpdate } => {

	const [changes, deletions] = referencesCardsDiff(beforeCard, afterCard);

	if (Object.keys(changes).length === 0 && Object.keys(deletions).length === 0) return {};

	const updatesToApply : {[id : CardID] : DottedCardUpdate } = {};

	if (Object.keys(changes).length) {
		const afterReferencesInfo = afterCard[REFERENCES_INFO_CARD_PROPERTY] || {};
		const afterReferences = afterCard[REFERENCES_CARD_PROPERTY] || {};
		for (const otherCardID of Object.keys(changes)) {
			const update = {
				//I have confirmed that multiple sets like this (to an object)
				//int he same transaction won't stomp on each others edits but
				//will accumulate.
				[REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferencesInfo[otherCardID],
				[REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: afterReferences[otherCardID],
			};
			updatesToApply[otherCardID] = update;
		}
	}

	//These deletions are only if the _entire_ block of references for that
	//cardID is gone; if only some of the keys are gone, that counts as a
	//modification and is properly handled above, and also means we can safely
	//remove the boolean value too.
	for (const otherCardID of Object.keys(deletions)) {
		const update = {
			[REFERENCES_INFO_INBOUND_CARD_PROPERTY + '.' + cardID]: deleteField(),
			[REFERENCES_INBOUND_CARD_PROPERTY + '.' + cardID]: deleteField(),
		};
		updatesToApply[otherCardID] = update;
	}

	return updatesToApply;
};