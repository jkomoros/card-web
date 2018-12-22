export const UPDATE_CARDS = 'UPDATE_CARDS';
export const SHOW_CARD = 'SHOW_CARD';

export const loadAll = () => async (dispatch, getState) => {
  dispatch(await loadCards());
  dispatch(showNewCard())
}

async function loadCards() {
  const resp = await fetch(`/src/data/cards.json`);
  const data = await resp.json();
  return {
    type: UPDATE_CARDS,
    cards: data.cards
  }
}

export const showNewCard = () => (dispatch, getState) => {

  const cards = getState().data.cards;

  let keys = Object.keys(cards);

  dispatch({type:SHOW_CARD, card:keys[0]})
}

