export const UPDATE_CARDS = 'UPDATE_CARDS';
export const SHOW_CARD = 'SHOW_CARD';

const CARDS_COLLECTION = 'cards';

const db = firebase.firestore();

db.settings({
  timestampsInSnapshots:true,
})

export const connectLiveCards = (store) => {
  db.collection(CARDS_COLLECTION).onSnapshot(snapshot => {

    let cards = {};

    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') return;
      let doc = change.doc;
      let id = doc.id;
      let card = doc.data();
      card.id = id;
      cards[id] = card;
    })

    store.dispatch(updateCards(cards));

  });
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

export const showNewCard = () => (dispatch, getState) => {

  const cards = getState().data.cards;

  let keys = Object.keys(cards);

  dispatch(showCard(keys[0]))
}

