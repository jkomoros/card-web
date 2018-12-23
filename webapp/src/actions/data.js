export const UPDATE_CARDS = 'UPDATE_CARDS';
export const UPDATE_SECTIONS = 'UPDATE_SECTIONS';
export const SHOW_CARD = 'SHOW_CARD';
export const SHOW_SECTION = 'SHOW_SECTION';

export const newCard = (section, id) => {

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

