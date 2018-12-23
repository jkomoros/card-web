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
  CARD_UPDATES_COLLECTION
} from './database.js';

import {
  editingFinish
} from './editor.js';

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
    cardUpdateObject.body = body;
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

export const createCard = (section, id) => {

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
    notes: "",
    slugs: [],
    name: id,
    tags: []
  }

  let cardDocRef = db.collection(CARDS_COLLECTION).doc(id);

  let sectionRef = db.collection(SECTIONS_COLLECTION).doc(starterCard.section);

  //TODO: do a transaction here.
  //Check ot make sure that cardDoc id does not currently exist.
  //Then put the starter card, and add its id to the end of the section's cards list.
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

