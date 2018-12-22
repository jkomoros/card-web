export const UPDATE_CARDS = 'UPDATE_CARDS';
export const SHOW_CARD = 'SHOW_CARD';

export const loadAll = () => async (dispatch, getState) => {
  dispatch(await loadCards());
  dispatch(showNewCard())
}

const CARDS_COLLECTION = 'cards';

const db = firebase.firestore();

db.settings({
  timestampsInSnapshots:true,
})

async function loadCards() {

  const snapshot = await db.collection(CARDS_COLLECTION).get();

  let cards = {};

  snapshot.forEach((doc) => {
    let id = doc.id;
    let card = doc.data();
    card.id = id;
    console.log(card);
    cards[id] = card
  })

  return {
    type: UPDATE_CARDS,
    cards,
  }
}

export const showCard = (cardId) => {
  return {
    type: SHOW_CARD,
    card: cardId
  }
}

export const showNewCard = () => (dispatch, getState) => {

  const cards = getState().data.cards;

  let keys = Object.keys(cards);

  dispatch(showCard(keys[0]))
}

