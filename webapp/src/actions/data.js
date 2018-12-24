export const UPDATE_CARDS = 'UPDATE_CARDS';
export const UPDATE_SECTIONS = 'UPDATE_SECTIONS';
export const SHOW_CARD = 'SHOW_CARD';
export const SHOW_SECTION = 'SHOW_SECTION';
export const MODIFY_CARD = 'MODIFY_CARD';
export const MODIFY_CARD_SUCCESS = 'MODIFY_CARD_SUCCESS';
export const MODIFY_CARD_FAILURE = 'MODIFY_CARD_FAILURE';

import {
  db,
  CARDS_COLLECTION,
  CARD_UPDATES_COLLECTION,
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
  ['body', true]
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

  if (update.body) {
    cardUpdateObject.body = update.body;
    cardUpdateObject.links = extractCardLinks(update.body);
  }

  if (update.title) {
    cardUpdateObject.title = update.title;
  }

  let batch = db.batch();

  let cardRef = db.collection(CARDS_COLLECTION).doc(card.id);

  let updateRef = cardRef.collection(CARD_UPDATES_COLLECTION).doc('' + Date.now());

  batch.set(updateRef, updateObject);
  batch.update(cardRef, cardUpdateObject);

  batch.commit().then(() => dispatch(modifyCardSuccess()))
    .catch(err => dispatch(modifyCardFailure()))

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

  let snapshot = await db.collection(CARDS_COLLECTION).where('slugs', 'array_contains', newSlug).get();
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
    transaction.update(cardRef, {slugs: newArray});
  });

  let state = getState();
  if (state.editor.card && state.editor.card.id == cardId) {
    //We're editing this card, update it in the state.
    dispatch(slugAdded(newSlug))
  }

}

export const createCard = (section, id) => async (dispatch) => {

  //newCard creates and inserts a new card in the givne section with the given id.

  if (!section) section = 'stubs';
  if (!id) id = randomString(6);

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
    transaction.update(sectionRef, {cards: newArray});
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

