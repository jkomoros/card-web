export const UPDATE_CARDS = 'UPDATE_CARDS';
export const UPDATE_SECTIONS = 'UPDATE_SECTIONS';
export const SHOW_CARD = 'SHOW_CARD';
export const SHOW_SECTION = 'SHOW_SECTION';
export const MODIFY_CARD = 'MODIFY_CARD';
export const MODIFY_CARD_SUCCESS = 'MODIFY_CARD_SUCCESS';
export const MODIFY_CARD_FAILURE = 'MODIFY_CARD_FAILURE';
export const REORDER_STATUS = 'REORDER_STATUS';

import {
  db,
  CARDS_COLLECTION,
  CARD_UPDATES_COLLECTION,
  SECTION_UPDATES_COLLECTION,
  SECTIONS_COLLECTION
} from './database.js';

import {
  navigateToCard
} from './app.js';

import {
  editingFinish,
  slugAdded
} from './editor.js';

import {
  randomString
} from './maintenance.js';

const LEGAL_UPDATE_FIELDS = new Map([
  ['title', true],
  ['body', true],
  ['name', true],
  ['section', true],
  ['full_bleed', true]
]);

export const modifyCard = (card, update, substantive) => (dispatch, getState) => {

  //Check to make sure card sin't being modified
  const state = getState();

  if (state.data.cardModificationPending) {
    console.log("Can't modify card; another card is being modified.")
    return;
  }

  if (!card || !card.id) {
    console.log("No id on card");
    return;
  }

  let keysCount = 0;

  for (let key of Object.keys(update)) {
    keysCount++;
    if (!LEGAL_UPDATE_FIELDS.has(key)) {
      console.log("Illegal field in update: " + key, update);
      return;
    }
  }

  if (keysCount == 0) {
    console.log("Nothing changed in update!");
    return;
  }

  dispatch(modifyCardAction(card.id));

  let updateObject = {
    ...update,
    substantive: substantive,
    timestamp: new Date()
  }

  let cardUpdateObject = {
    updated: new Date()
  }
  if (substantive) cardUpdateObject.updated_substantive = new Date();

  if (update.body !== undefined) {
    cardUpdateObject.body = update.body;
    cardUpdateObject.links = extractCardLinks(update.body);
  }

  if (update.title !== undefined) {
    cardUpdateObject.title = update.title;
  }

  //It's never legal to not have a name, so only update if it's not falsey.
  if (update.name) {
    //TODO: really we should verify that this name is legal--that is, either the id or one of the slugs.
    cardUpdateObject.name = update.name;
  }

  let sectionUpdated = false;

  if (update.section !== undefined) {
    if (!update.section) {
      if (!confirm("Orphaning this card will cause it to not be findable except with a direct link. OK?")) {
        console.log("User aborted because didn't confirm orphaning");
        dispatch(modifyCardFailure());
        return; 
      }
    }
    cardUpdateObject.section = update.section;
    sectionUpdated = true;
  }

  if (update.full_bleed !== undefined) {
    cardUpdateObject.full_bleed = update.full_bleed;
  }

  let batch = db.batch();

  let cardRef = db.collection(CARDS_COLLECTION).doc(card.id);

  let updateRef = cardRef.collection(CARD_UPDATES_COLLECTION).doc('' + Date.now());

  batch.set(updateRef, updateObject);
  batch.update(cardRef, cardUpdateObject);

  if (sectionUpdated) {
    //Need to update the section objects too.
    let newSection = cardUpdateObject.section;
    if (newSection) {
      let newSectionRef = db.collection(SECTIONS_COLLECTION).doc(newSection);
      let newSectionUpdateRef = newSectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
      let newSectionObject = {
        cards: firebase.firestore.FieldValue.arrayUnion(card.id),
        updated: new Date()
      }
      let newSectionUpdateObject = {
        timestamp: new Date(),
        add_card: card.id
      }
      batch.update(newSectionRef, newSectionObject);
      batch.set(newSectionUpdateRef, newSectionUpdateObject);
    }
    let oldSection = card.section;
    if (oldSection) {
      let oldSectionRef = db.collection(SECTIONS_COLLECTION).doc(oldSection);
      let oldSectionUpdateRef = oldSectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
      let oldSectionObject = {
        cards: firebase.firestore.FieldValue.arrayRemove(card.id),
        updated: new Date()
      }
      let oldSectionUpdateObject = {
        timestamp: new Date(),
        remove_card: card.id
      }
      batch.update(oldSectionRef, oldSectionObject);
      batch.set(oldSectionUpdateRef, oldSectionUpdateObject);
    }
  }

  batch.commit().then(() => dispatch(modifyCardSuccess()))
    .catch(err => dispatch(modifyCardFailure()))

}

export const reorderCard = (card, newIndex) => async (dispatch, getState) => {

  const state = getState();

  if (!card || !card.id || !card.section) {
    console.log("That card isn't valid");
    return
  }

  let section = state.data.sections[card.section];

  if (!section) {
    console.log("That card's section was not valid");
    return;
  }

  //newIndex is relative to the overall collection size; redo to be newIndex
  let startCards = section.start_cards || [];
  let effectiveIndex = newIndex - startCards.length;

  if (effectiveIndex < 0) {
    console.log("Effective index is less than 0");
    return;
  }

  if (effectiveIndex > (section.cards.length - 1)) {
    console.log("Effective index is greater than length");
    return;
  }

  dispatch(reorderStatus(true));

  await db.runTransaction(async transaction => {
    let sectionRef = db.collection(SECTIONS_COLLECTION).doc(card.section);
    let doc = await transaction.get(sectionRef);
    if (!doc.exists) {
      throw "Doc doesn't exist!"
    }
    let cards = doc.data().cards || [];
    let trimmedCards = [];
    let foundInSection = false;
    for (let val of Object.values(cards)) {
      if (val == card.id) {
        if (foundInSection) {
          throw "Card was found in the section cards list twice";
        }
        foundInSection = true;
        continue;
      }
      trimmedCards.push(val);
    }

    if (!foundInSection) throw "Card was not found in section's card list";

    let result;

    if (effectiveIndex == 0) {
      result = [card.id, ...trimmedCards];
    } else if (effectiveIndex >= trimmedCards.length) {
      result = [...trimmedCards, card.id];
    } else {
      result = [...trimmedCards.slice(0,effectiveIndex), card.id, ...trimmedCards.slice(effectiveIndex)];
    }
    transaction.update(sectionRef, {cards: result, updated: new Date()});
    let sectionUpdateRef = sectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
    transaction.set(sectionUpdateRef, {timestamp: new Date(), cards: result});
  }).then(() => dispatch(reorderStatus(false))).catch(() => dispatch(reorderStatus(false)));

  //We don't need to tell the store anything, because firestore will tell it
  //automatically.

}

const extractCardLinks = (body) => {
  let ele = document.createElement("section");
  ele.innerHTML = body;
  let result = [];
  let nodes = ele.querySelectorAll("a[card]");
  nodes.forEach(link => result.push(link.getAttribute('card')));
  return result;
}

export const addSlug = (cardId, newSlug) => async (dispatch, getState) => {
 
  if (!newSlug) {
    console.log("Must provide a slug");
    return;
  }

  newSlug = newSlug.toLowerCase();
  newSlug = newSlug.split(" ").join("-");
  newSlug = newSlug.split("_").join("-");

  let doc = await db.collection(CARDS_COLLECTION).doc(newSlug).get();

  if (doc.exists) {
    console.log("That slug is already the id of another item");
    return;
  }

  let snapshot = await db.collection(CARDS_COLLECTION).where('slugs', 'array-contains', newSlug).get();
  if (snapshot.size > 0) {
    console.log('Another document already has that slug');
    return;
  }

  await db.runTransaction(async transaction => {
    let cardRef = db.collection(CARDS_COLLECTION).doc(cardId);
    let doc = await transaction.get(cardRef);
    if (!doc.exists) {
      throw "Doc doesn't exist!"
    }
    let slugs = doc.data().slugs || [];

    var newArray = [...slugs, newSlug];
    transaction.update(cardRef, {slugs: newArray, updated: new Date()});
  });

  let state = getState();
  if (state.editor.card && state.editor.card.id == cardId) {
    //We're editing this card, update it in the state.
    dispatch(slugAdded(newSlug))
  }

}

export const createCard = (section, id) => async (dispatch, getState) => {

  //newCard creates and inserts a new card in the givne section with the given id.

  if (!section) section = 'stubs';
  if (!id) id = randomString(6);

  let state = getState();

  let appendMiddle = false; 
  let appendIndex = 0;
  if (state.data.activeSectionId == section) {
    appendMiddle = true;
    appendIndex = state.data.activeCardIndex;
  }

  let obj = {
    created: new Date(),
    updated: new Date(),
    updated_substantive: new Date(),
    title: "",
    section: section,
    body: "",
    links: [],
    links_inbound: [],
    card_type: 'content',
    notes: "",
    slugs: [],
    name: id,
    tags: []
  }

  let cardDocRef = db.collection(CARDS_COLLECTION).doc(id);

  let doc = await cardDocRef.get();

  if (doc.exists) {
    console.log("Add failed: a card with that ID already exists");
    return;
  }

  let sectionRef = db.collection(SECTIONS_COLLECTION).doc(obj.section);

  await db.runTransaction(async transaction => {
    let sectionDoc = await transaction.get(sectionRef);
    if (!sectionDoc.exists) {
      throw "Doc doesn't exist!"
    }
    var newArray = [...sectionDoc.data().cards, id];
    if (appendMiddle) {
      let current = sectionDoc.data().cards;
      newArray = [...current.slice(0,appendIndex), id, ...current.slice(appendIndex)];
    }
    transaction.update(sectionRef, {cards: newArray, updated: new Date()});
    let sectionUpdateRef = sectionRef.collection(SECTION_UPDATES_COLLECTION).doc('' + Date.now());
    transaction.set(sectionUpdateRef, {timestamp: new Date(), cards: newArray});
    transaction.set(cardDocRef, obj);
  })

  dispatch(navigateToCard(id));
}

const modifyCardAction = (cardId) => {
  return {
    type: MODIFY_CARD,
    cardId,
  }
}

const modifyCardSuccess = () => (dispatch, getState) => {
  const state = getState();
  if (state.editor.editing) {
    dispatch(editingFinish());
  }
  dispatch({
    type:MODIFY_CARD_SUCCESS,
  })
}

const modifyCardFailure = (err) => {
  return {
    type: MODIFY_CARD_FAILURE,
    error: err,
  }
}

export const reorderStatus = (pending) => {
  return {
    type: REORDER_STATUS,
    pending
  }
}

export const updateSections = (sections) => {
  return {
    type: UPDATE_SECTIONS,
    sections,
  }
}

export const updateCards = (cards) => {
  return {
    type:UPDATE_CARDS,
    cards,
  }
}

export const showCard = (cardId) => {
  return {
    type: SHOW_CARD,
    card: cardId
  }
}

export const showSection = (sectionId) => {
  return {
    type: SHOW_SECTION,
    section: sectionId
  }
}

export const showNewCard = () => (dispatch, getState) => {

  const cards = getState().data.cards;

  let keys = Object.keys(cards);

  dispatch(showCard(keys[0]))
}

