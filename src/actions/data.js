export const UPDATE_CARDS = 'UPDATE_CARDS';
export const UPDATE_SECTIONS = 'UPDATE_SECTIONS';
export const UPDATE_TAGS = 'UPDATE_TAGS';
export const UPDATE_AUTHORS= 'UPDATE_AUTHORS';
export const UPDATE_TWEETS = 'UPDATE_TWEETS';
export const TWEETS_LOADING = 'TWEETS_LOADING';
export const MODIFY_CARD = 'MODIFY_CARD';
export const MODIFY_CARD_SUCCESS = 'MODIFY_CARD_SUCCESS';
export const MODIFY_CARD_FAILURE = 'MODIFY_CARD_FAILURE';
export const REORDER_STATUS = 'REORDER_STATUS';
export const SET_PENDING_SLUG = 'SET_PENDING_SLUG';
export const EXPECT_NEW_CARD = 'EXPECT_NEW_CARD';
export const NAVIGATED_TO_NEW_CARD = 'NAVIGATED_TO_NEW_CARD';

import {
	slugLegal,
	CARDS_COLLECTION,
	CARD_UPDATES_COLLECTION,
	SECTION_UPDATES_COLLECTION,
	SECTIONS_COLLECTION,
	TAGS_COLLECTION,
	TAG_UPDATES_COLLECTION,
	TWEETS_COLLECTION,
} from './database.js';

import {
	db,
	serverTimestampSentinel,
	arrayUnionSentinel,
	arrayRemoveSentinel
} from '../firebase.js';

import {
	navigateToCard
} from './app.js';

import {
	editingFinish,
	slugAdded,
	tagAdded
} from './editor.js';

import {
	newID,
	arrayRemove,
	arrayUnion,
	normalizeSlug,
	extractCardLinksFromBody,
} from '../util.js';

import {
	ensureAuthor
} from './comments.js';

import {
	refreshCardSelector,
	commitPendingCollectionModifications
} from './collection.js';

import {
	selectActiveSectionId,
	selectActiveCardIndex,
	selectUser,
	selectUserIsAdmin,
	selectFilters,
	selectDataIsFullyLoaded,
	getUserMayEditCard,
	selectLastSectionID,
	getUserMayEditSection,
	getUserMayEditTag,
	selectUserMayCreateCard,
	selectPendingNewCardID
} from '../selectors.js';

import {
	INVERSE_FILTER_NAMES,
	SET_NAMES,
	SORT_URL_KEYWORD,
	CONFIGURABLE_FILTER_URL_PARTS,
} from '../filters.js';

import {
	PERMISSION_EDIT_CARD
} from '../permissions.js';

import {
	CARD_TYPE_CONFIGURATION,
	TEXT_FIELD_CONFIGURATION,
	TEXT_FIELD_BODY,
	CARD_TYPE_CONTENT,
	CARD_TYPE_SECTION_HEAD,
	CARD_TYPE_WORKING_NOTES
} from '../card_fields.js';

//When a new tag is created, it is randomly assigned one of these values.
const TAG_COLORS = [
	//Indianred
	'#CD5C5C',
	//darkkhahki
	'#BDB76B',
	//limegreen
	'#32CD32',
	//darkcyan
	'#008B8B',
	//navy
	'#000080',
	//sandybrown
	'#F4A460',
	//gold
	'#FFD700',
	//darkmagenta
	'#8B008B',
	//royalblue
	'#4169E1',
];

const LEGAL_UPDATE_FIELDS =  Object.fromEntries(Object.keys(TEXT_FIELD_CONFIGURATION).concat([
	'name',
	'section',
	'full_bleed',
	'notes',
	'todo',
	'auto_todo_overrides_enablements',
	'auto_todo_overrides_disablements',
	'auto_todo_overrides_removals',
	'add_skipped_link_inbound',
	'remove_skipped_link_inbound',
	'add_editors',
	'remove_editors',
	'add_collaborators',
	'remove_collaborators',
	'addTags',
	'removeTags',
	'published'
]).map(key => [key,true]));

export const modifyCard = (card, update, substantive, optBatch) => (dispatch, getState) => {

	//If optBatch is provided, then it will not create a batch and instead make
	//the modifications on it, and then NOT commit it. If optBatch is not
	//provided, it will create a batch and commit it before returning.

	//Check to make sure card sin't being modified
	const state = getState();

	if (state.data.cardModificationPending) {
		console.log('Can\'t modify card; another card is being modified.');
		return;
	}

	if (!card || !card.id) {
		console.log('No id on card');
		return;
	}

	const user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!getUserMayEditCard(state, card.id)) {
		console.log('User isn\'t allowed to edit the given card');
		return;
	}

	let keysCount = 0;

	for (let key of Object.keys(update)) {
		keysCount++;
		if (!LEGAL_UPDATE_FIELDS[key]) {
			console.log('Illegal field in update: ' + key, update);
			return;
		}
	}

	if (keysCount == 0) {
		console.log('Nothing changed in update!');
		return;
	}

	dispatch(modifyCardAction(card.id));

	let updateObject = {
		...update,
		substantive: substantive,
		timestamp: serverTimestampSentinel()
	};

	let cardUpdateObject = {
		updated: serverTimestampSentinel()
	};
	if (substantive) cardUpdateObject.updated_substantive = serverTimestampSentinel();

	for (let field of Object.keys(TEXT_FIELD_CONFIGURATION)) {
		if (update[field] === undefined) continue;
		cardUpdateObject[field] = update[field];
		if (field != TEXT_FIELD_BODY) continue;
		let linkInfo = extractCardLinksFromBody(update[field]);
		cardUpdateObject.links = linkInfo[0];
		cardUpdateObject.links_text = linkInfo[1];
	}

	if (update.notes !== undefined) {
		cardUpdateObject.notes = update.notes;
	}

	if (update.todo !== undefined) {
		cardUpdateObject.todo = update.todo;
	}

	if (update.published !== undefined) {
		cardUpdateObject.published = update.published;
	}

	//It's never legal to not have a name, so only update if it's not falsey.
	if (update.name) {
		//TODO: really we should verify that this name is legal--that is, either the id or one of the slugs.
		cardUpdateObject.name = update.name;
	}

	const CARD_TYPE_CONFIG = CARD_TYPE_CONFIGURATION[update.card_type || card.card_type];

	let sectionUpdated = false;

	if (update.section !== undefined) {
		if (!update.section) {
			if (!CARD_TYPE_CONFIG.invertOrphanWarning && !confirm('Orphaning this card will cause it to not be findable except with a direct link. OK?')) {
				console.log('User aborted because didn\'t confirm orphaning');
				dispatch(modifyCardFailure());
				return; 
			}
		} else {
			if (CARD_TYPE_CONFIG.invertOrphanWarning && !confirm('This is a card type that typcially is not in a section, but you\'re adding it to a section. OK?')) {
				console.log('User aborted because didn\'t confirm not orphaning');
				dispatch(modifyCardFailure());
				return; 
			}
			if (!getUserMayEditSection(state, update.section)) {
				console.log('The user cannot modify the section the card is moving to');
				return;
			}
		}
		if (card.section) {
			if (!getUserMayEditSection(state, card.section)) {
				console.log('The section the card is leaving is not one the user has edit access for');
				return;
			}
		}
		cardUpdateObject.section = update.section;
		sectionUpdated = true;
	}

	if (update.full_bleed !== undefined) {
		cardUpdateObject.full_bleed = update.full_bleed;
	}

	if (update.addTags || update.removeTags) {
		let tags = card.tags;
		if (update.removeTags) {
			for (let tag of update.removeTags) {
				if (!getUserMayEditTag(state, tag)) {
					console.log('User is not allowed to edit tag: ' + tag);
					return;
				}
			}
			tags = arrayRemove(tags, update.removeTags);
		}
		if (update.addTags) {
			for (let tag of update.addTags) {
				if (!getUserMayEditTag(state, tag)) {
					console.log('User is not allowed to edit tag: ' + tag);
					return;
				}
			}
			tags = arrayUnion(tags, update.addTags);
		}
		cardUpdateObject.tags = tags;
	}

	if (update.add_skipped_link_inbound || update.remove_skipped_link_inbound) {
		let skippedLinksInbound = card.auto_todo_skipped_links_inbound;
		if (update.remove_skipped_link_inbound) skippedLinksInbound = arrayRemove(skippedLinksInbound, update.remove_skipped_link_inbound);
		if (update.add_skipped_link_inbound) skippedLinksInbound = arrayUnion(skippedLinksInbound, update.add_skipped_link_inbound);
		cardUpdateObject.auto_todo_skipped_links_inbound = skippedLinksInbound;
	}

	if (update.add_editors || update.remove_editors) {
		let editors = card.permissions[PERMISSION_EDIT_CARD];
		if (update.remove_editors) editors = arrayRemove(editors, update.remove_editors);
		if (update.add_editors) {
			if (!confirm('You\'ve added editors. Those users will be able to edit this card. OK?')) {
				console.log('User aborted because didn\'t confirm editing');
				dispatch(modifyCardFailure());
				return;
			}
			editors = arrayUnion(editors, update.add_editors);
		}
		cardUpdateObject['permissions.' + PERMISSION_EDIT_CARD] = editors;
	}

	if (update.add_collaborators || update.remove_collaborators) {
		let collaborators = card.collaborators;
		if (update.remove_collaborators) collaborators = arrayRemove(collaborators, update.remove_collaborators);
		if (update.add_collaborators) collaborators = arrayUnion(collaborators, update.add_collaborators);
		cardUpdateObject.collaborators = collaborators;
	}

	if (update.auto_todo_overrides_enablements || update.auto_todo_overrides_disablements || update.auto_todo_overrides_removals) {
		let overrides = {...card.auto_todo_overrides || {}};
		if (update.auto_todo_overrides_enablements) update.auto_todo_overrides_enablements.forEach(key => overrides[key] = true);
		if (update.auto_todo_overrides_disablements) update.auto_todo_overrides_disablements.forEach(key => overrides[key] = false);
		if (update.auto_todo_overrides_removals) update.auto_todo_overrides_removals.forEach(key => delete overrides[key]);
		cardUpdateObject.auto_todo_overrides = overrides;
	}

	let batch = optBatch || db.batch();

	let cardRef = db.collection(CARDS_COLLECTION).doc(card.id);

	let updateRef = cardRef.collection(CARD_UPDATES_COLLECTION).doc('' + Date.now());

	batch.set(updateRef, updateObject);
	batch.update(cardRef, cardUpdateObject);

	ensureAuthor(batch, user);

	if (sectionUpdated) {
		//Need to update the section objects too.
		let newSection = cardUpdateObject.section;
		if (newSection) {
			let newSectionRef = db.collection(SECTIONS_COLLECTION).doc(newSection);
			let newSectionUpdateRef = newSectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
			let newSectionObject = {
				cards: arrayUnionSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let newSectionUpdateObject = {
				timestamp: serverTimestampSentinel(),
				add_card: card.id
			};
			batch.update(newSectionRef, newSectionObject);
			batch.set(newSectionUpdateRef, newSectionUpdateObject);
		}
		let oldSection = card.section;
		if (oldSection) {
			let oldSectionRef = db.collection(SECTIONS_COLLECTION).doc(oldSection);
			let oldSectionUpdateRef = oldSectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
			let oldSectionObject = {
				cards: arrayRemoveSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let oldSectionUpdateObject = {
				timestamp: serverTimestampSentinel(),
				remove_card: card.id
			};
			batch.update(oldSectionRef, oldSectionObject);
			batch.set(oldSectionUpdateRef, oldSectionUpdateObject);
		}
	}

	if (update.addTags && update.addTags.length) {
		for (let tagName of update.addTags) {
			let tagRef = db.collection(TAGS_COLLECTION).doc(tagName);
			let tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc('' + Date.now());
			let newTagObject = {
				cards: arrayUnionSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let newTagUpdateObject = {
				timestamp: serverTimestampSentinel(),
				add_card: card.id
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if (update.removeTags && update.removeTags.length) {
		for (let tagName of update.removeTags) {
			let tagRef = db.collection(TAGS_COLLECTION).doc(tagName);
			let tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc('' + Date.now());
			let newTagObject = {
				cards: arrayRemoveSentinel(card.id),
				updated: serverTimestampSentinel()
			};
			let newTagUpdateObject = {
				timestamp: serverTimestampSentinel(),
				remove_card: card.id
			};
			batch.update(tagRef, newTagObject);
			batch.set(tagUpdateRef, newTagUpdateObject);
		}
	}

	if(!optBatch) batch.commit().then(() => dispatch(modifyCardSuccess()))
		.catch((err) => dispatch(modifyCardFailure(err)));

};

export const reorderCard = (card, newIndex) => async (dispatch, getState) => {

	const state = getState();

	if (!card || !card.id || !card.section) {
		console.log('That card isn\'t valid');
		return;
	}

	if (!getUserMayEditSection(state, card.section)) {
		console.log('The user does not have permission to edit that section');
		return;
	}

	let section = state.data.sections[card.section];

	if (!section) {
		console.log('That card\'s section was not valid');
		return;
	}

	//newIndex is relative to the overall collection size; redo to be newIndex
	let startCards = section.start_cards || [];
	let effectiveIndex = newIndex - startCards.length;

	if (effectiveIndex < 0) {
		console.log('Effective index is less than 0');
		return;
	}

	if (effectiveIndex > (section.cards.length - 1)) {
		console.log('Effective index is greater than length');
		return;
	}

	dispatch(reorderStatus(true));

	await db.runTransaction(async transaction => {
		let sectionRef = db.collection(SECTIONS_COLLECTION).doc(card.section);
		let doc = await transaction.get(sectionRef);
		if (!doc.exists) {
			throw 'Doc doesn\'t exist!';
		}
		let cards = doc.data().cards || [];
		let trimmedCards = [];
		let foundInSection = false;
		for (let val of Object.values(cards)) {
			if (val == card.id) {
				if (foundInSection) {
					throw 'Card was found in the section cards list twice';
				}
				foundInSection = true;
				continue;
			}
			trimmedCards.push(val);
		}

		if (!foundInSection) throw 'Card was not found in section\'s card list';

		let result;

		if (effectiveIndex == 0) {
			result = [card.id, ...trimmedCards];
		} else if (effectiveIndex >= trimmedCards.length) {
			result = [...trimmedCards, card.id];
		} else {
			result = [...trimmedCards.slice(0,effectiveIndex), card.id, ...trimmedCards.slice(effectiveIndex)];
		}
		transaction.update(sectionRef, {cards: result, updated: serverTimestampSentinel()});
		let sectionUpdateRef = sectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
		transaction.set(sectionUpdateRef, {timestamp: serverTimestampSentinel(), cards: result});
	}).then(() => dispatch(reorderStatus(false))).catch(() => dispatch(reorderStatus(false)));

	//We don't need to tell the store anything, because firestore will tell it
	//automatically.

};

const setPendingSlug = (slug) => {
	return {
		type:SET_PENDING_SLUG,
		slug
	};
};

export const addSlug = (cardId, newSlug) => async (dispatch, getState) => {
 
	newSlug = normalizeSlug(newSlug);

	if (!newSlug) {
		console.log('Must provide a legal slug');
		return;
	}

	let state = getState();
	const isEditingCard = state.editor.card && state.editor.card.id == cardId;

	//slugLegal is a http callable, and it might take multiple seconds if the
	//cloud function is cold.
	dispatch(setPendingSlug(newSlug));

	let result;
	try {
		result = await slugLegal(newSlug);
	} catch(err) {
		dispatch(setPendingSlug(''));
		console.warn(err);
		return;
	}

	if (!result.legal) {
		console.log(result.reason);
		dispatch(setPendingSlug(''));
		return;
	}

	let batch = db.batch();
	const cardRef = db.collection(CARDS_COLLECTION).doc(cardId);
	batch.update(cardRef, {
		slugs: arrayUnionSentinel(newSlug),
		updated: serverTimestampSentinel(),
	});

	await batch.commit();

	dispatch(setPendingSlug(''));

	if (isEditingCard) {
		//We're editing this card, update it in the state.
		dispatch(slugAdded(newSlug));
	}

};

const reservedCollectionName = (state, name) => {

	if (!selectDataIsFullyLoaded(state)) {
		console.warn('Sections not loaded');
		return true;
	}

	if (name == SORT_URL_KEYWORD) return true;

	//Filters already contains section names if data is fully loaded.
	const filters = selectFilters(state) || {};

	let keys = [...Object.keys(filters), ...Object.keys(INVERSE_FILTER_NAMES), ...SET_NAMES, ...Object.keys(CONFIGURABLE_FILTER_URL_PARTS)];

	for (let key of keys) {
		if (name == key) return true;
	}
	return false;
};

export const createTag = (name, displayName) => async (dispatch, getState) => {

	if (!name) {
		console.warn('No short name provided');
		return;
	}

	name = normalizeSlug(name);

	const state = getState();

	if (reservedCollectionName(state, name)) {
		console.warn('That name is reserved');
		return;
	}

	if (!name) {
		console.warn('Tag name invalid');
		return;
	}

	if (!displayName) {
		console.warn('No short name provided');
		return;
	}

	let user = selectUser(state);

	if (!user) {
		console.warn('No user logged in');
		return;
	}

	if (!selectUserIsAdmin(state)) {
		console.log('User isn\'t admin!');
		return;
	}

	let tagRef = db.collection(TAGS_COLLECTION).doc(name);

	let tag = await tagRef.get();

	if (tag.exists) {
		console.warn('A tag with that name already exists');
		return;
	}

	let startCardId = 'tag-' + name;
	let startCardRef = db.collection(CARDS_COLLECTION).doc(startCardId);

	let card = await startCardRef.get();

	if (card.exists) {
		console.warn('A card with that id already exists');
		return;
	}

	//Randomly pick a tag color to start with. If an admin wants to edit it they
	//can just edit it by hand in the DB.
	let color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];

	let batch = db.batch();

	batch.set(tagRef, {
		cards: [],
		start_cards: [startCardId],
		title:displayName,
		updated: serverTimestampSentinel(),
		color: color,
	});

	let cardObject = defaultCardObject(startCardId, user, '', CARD_TYPE_SECTION_HEAD);
	cardObject.title = displayName;
	cardObject.subtitle = displayName + ' is a topical tag';

	batch.set(startCardRef, cardObject);

	batch.commit().then(dispatch(tagAdded(name)));

};

//exported entireoly for initialSetUp in maintence.js
export const defaultCardObject = (id, user, section, cardType) => {
	return {
		created: serverTimestampSentinel(),
		updated: serverTimestampSentinel(),
		author: user.uid,
		permissions: {
			[PERMISSION_EDIT_CARD]: [],
		},
		collaborators: [],
		updated_substantive: serverTimestampSentinel(),
		updated_message: serverTimestampSentinel(),
		//star_count is sum of star_count_manual, tweet_favorite_count, tweet_retweet_count.
		star_count: 0,
		//star_count_manual is the count of stars in the stars collection (as
		//opposed to faux stars that are tweet enagement actions)
		star_count_manual: 0,
		//The sum of favorite counts for all tweets for this card
		tweet_favorite_count: 0,
		//The sum of retweet counts for all tweets for this card
		tweet_retweet_count: 0,
		thread_count: 0,
		thread_resolved_count: 0,
		title: '',
		section: section,
		body: '',
		links: [],
		//a map of cardid => the text of the link in this card that points to it
		links_text: {},
		links_inbound: [],
		//a map of cardid => the text that THAT card uses to link to THIS card
		links_inbound_text: {},
		card_type: cardType,
		notes: '',
		todo: '',
		slugs: [],
		name: id,
		tags: [],
		published: false,
		auto_todo_overrides: {},
		auto_todo_skipped_links_inbound: [],
		//Defaul to epoch 1970 for things not yet tweeted
		last_tweeted: new Date(0),
		tweet_count: 0
	};
};

export const createWorkingNotesCard = () => async (dispatch, getState) => {

	//NOTE: if you modify this method you probably also want to modify
	//createCard, too.

	const state = getState();

	let id = newID();

	let user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	let obj = defaultCardObject(id, user, '', CARD_TYPE_WORKING_NOTES);

	let cardDocRef = db.collection(CARDS_COLLECTION).doc(id);


	//Tell card-view to expect a new card to be loaded, and when data is
	//fully loaded again, it will then trigger the navigation.
	dispatch({
		type: EXPECT_NEW_CARD,
		ID: id,
		noSectionChange: true,
	});

	//Check to make sure the ID is legal. Note that the id and slugs are in the
	//same ID space, so we can reuse slugLegal. Note that slugLegal could take
	//up to 10 seconds to complete if the cloud function is not pre-warmed.
	const result = await slugLegal(id);
	if (!result.legal) {
		console.log('ID is already taken: ' + result.reason);
		//Tell it to not expect the card to be inserted anymore
		dispatch({
			type:NAVIGATED_TO_NEW_CARD,
		});
		return;
	}

	const batch = db.batch();


	ensureAuthor(batch, user);
	batch.set(cardDocRef, obj);

	batch.commit();

	//updateCards will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(waiting only for the card, not section, since no section will be updated)
};

//createCard creates an inserts a new card. see also createWorkingNotesCard
//which is similar but simpler.
export const createCard = (opts) => async (dispatch, getState) => {

	//NOTE: if you modify this card you likely also want to modify
	//createWorkingNotesCard too

	//newCard creates and inserts a new card in the givne section with the given id.

	const state = getState();

	const lastSectionID = selectLastSectionID(state);

	let cardType = opts.cardType || CARD_TYPE_CONTENT;
	let section = opts.section || lastSectionID;
	let id = opts.id;
	let noNavigate = opts.noNavigate || false;
	let title = opts.title || '';

	if (!cardType) cardType = CARD_TYPE_CONTENT;

	if (!section) section = lastSectionID;
	if (!section) {
		console.log('No last section ID');
		return;
	}

	if (!getUserMayEditSection(state, section)) {
		console.log('User doesn\'t have edit permission for section the card will be added to.');
		return;
	}

	if (id) {
		id = normalizeSlug(id);
	} else {
		id = newID();
	}
  
	if (!id) {
		console.log('Id provided was not legal');
		return;
	}

	let user = selectUser(state);

	if (!user) {
		console.log('No user');
		return;
	}

	if (!selectUserMayCreateCard(state)) {
		console.log('User isn\'t allowed to create card');
		return;
	}

	let appendMiddle = false; 
	let appendIndex = 0;
	if (selectActiveSectionId(state) == section) {
		appendMiddle = true;
		appendIndex = selectActiveCardIndex(state);
	}

	let obj = defaultCardObject(id, user, section, cardType);
	obj.title = title;

	let cardDocRef = db.collection(CARDS_COLLECTION).doc(id);

	if (!noNavigate) {
		//Tell card-view to expect a new card to be loaded, and when data is
		//fully loaded again, it will then trigger the navigation.
		dispatch({
			type: EXPECT_NEW_CARD,
			ID: id,
		});
	}

	//Check to make sure the ID is legal. Note that the id and slugs are in the
	//same ID space, so we can reuse slugLegal. Note that slugLegal could take
	//up to 10 seconds to complete if the cloud function is not pre-warmed.
	const result = await slugLegal(id);
	if (!result.legal) {
		console.log('ID is already taken: ' + result.reason);
		if (!noNavigate) {
			//Tell it to not expect the card to be inserted anymore
			dispatch({
				type:NAVIGATED_TO_NEW_CARD,
			});
		}
		return;
	}

	let sectionRef = db.collection(SECTIONS_COLLECTION).doc(obj.section);

	await db.runTransaction(async transaction => {
		let sectionDoc = await transaction.get(sectionRef);
		if (!sectionDoc.exists) {
			throw 'Doc doesn\'t exist!';
		}
		var newArray = [...sectionDoc.data().cards, id];
		if (appendMiddle) {
			let current = sectionDoc.data().cards;
			newArray = [...current.slice(0,appendIndex), id, ...current.slice(appendIndex)];
		}
		ensureAuthor(transaction, user);
		transaction.update(sectionRef, {cards: newArray, updated: serverTimestampSentinel()});
		let sectionUpdateRef = sectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
		transaction.set(sectionUpdateRef, {timestamp: serverTimestampSentinel(), cards: newArray});
		transaction.set(cardDocRef, obj);
	});

	//updateSections will be called and update the current view. card-view's
	//updated will call navigateToNewCard once the data is fully loaded again
	//(if EXPECT_NEW_CARD was dispatched above)
};

export const navigateToNewCard = () => (dispatch, getState) => {
	const ID = selectPendingNewCardID(getState());
	if (!ID) return;
	//navigateToNewCard is called when the expected cards/sections are loaded.
	//Ensure that we have the up-to-date sections loaded. The case of adding a
	//card to the current secitno works fine because updateSections will have
	//called refreshCardSelector with force. But it doesn't work automatically
	//for working-notes being added when viewinng working ntoes, since those
	//cards are all oprhaned.
	dispatch(commitPendingCollectionModifications());
	//navigateToCard will intiate a chain of actions that culminates in
	//showCard, where we will note that we navigated to new card so we don't do
	//it again.
	dispatch(navigateToCard(ID));
};

export const navigatedToNewCard = () => {
	return {
		type:NAVIGATED_TO_NEW_CARD,
	};
};

const modifyCardAction = (cardId) => {
	return {
		type: MODIFY_CARD,
		cardId,
	};
};

const modifyCardSuccess = () => (dispatch, getState) => {
	const state = getState();
	if (state.editor.editing) {
		dispatch(editingFinish());
	}
	dispatch({
		type:MODIFY_CARD_SUCCESS,
	});
};

const modifyCardFailure = (err) => {
	console.warn(err);
	return {
		type: MODIFY_CARD_FAILURE,
		error: err,
	};
};

export const reorderStatus = (pending) => {
	return {
		type: REORDER_STATUS,
		pending
	};
};

export const updateSections = (sections) => (dispatch, getState) => {
	dispatch({
		type: UPDATE_SECTIONS,
		sections,
	});

	//If the update is a single section updating and it's the one currently
	//visible then we should update collections. This could happen for example
	//if a new card is added, or if cards are reordered.
	const currentSectionId = selectActiveSectionId(getState());
	const force = Object.keys(sections).length == 1 && sections[currentSectionId];

	dispatch(refreshCardSelector(force));
};

export const updateAuthors = (authors) => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (user && user.uid) {
		const authorRec = authors[user.uid];
		if (authorRec) {
			if ((!authorRec.displayName || !authorRec.photoURL) && (user.displayName || user.photoURL)) {
				//there's an author rec for our user, but it's missing
				//displayName or photoURL, and we have them. This could happen
				//if a user was manually listed as a collaborator or editor
				//without already being in the authors table. We should ensure
				//author!
				console.log('Saving extra author information because our authors rec was missing it');
				let batch = db.batch();
				ensureAuthor(batch, user);
				//don't need to wait for it resolve
				batch.commit();
			}
		}
	}

	dispatch({
		type: UPDATE_AUTHORS,
		authors
	});
};

export const updateTags = (tags) => (dispatch) => {
	dispatch({
		type:UPDATE_TAGS,
		tags,
	});
	dispatch(refreshCardSelector(false));
};

export const updateCards = (cards, unpublished) => (dispatch) => {
	dispatch({
		type:UPDATE_CARDS,
		cards,
		unpublished
	});
	dispatch(refreshCardSelector(false));
};

export const fetchTweets = (card) => async (dispatch) => {

	if (!card || Object.values(card).length == 0) return;

	dispatch({
		type: TWEETS_LOADING,
		loading: true,
	});

	//This query requires an index, defined in firestore.indexes.json
	const snapshot = await db.collection(TWEETS_COLLECTION).where('card', '==', card.id).where('archived', '==', false).orderBy('created', 'desc').get();

	if (snapshot.empty) {
		dispatch({
			type: UPDATE_TWEETS,
			loading: false,
		});
		return;
	}

	const tweets = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()]));

	dispatch({
		type: UPDATE_TWEETS,
		tweets
	});
};

