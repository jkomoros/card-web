//selectRawCards is duplicated from selectors.js
const selectRawCards = (state) => state.data ? state.data.cards : {};
const selectPendingNewCardID = (state) => state.data ? state.data.pendingNewCardID : '';
const selectPendingNewCardType = (state) => state.data ? state.data.pendingNewCardType : '';

//getCardExists checks if the card with the given ID is known to exist. This is
//typicaly because a card with that ID is in the set of cards on the client, but
//also might be because we just created that card and know it will exist soon
//even though it's not yet on the client.
export const getCardExists = (state, cardID) => {
	if (cardID == selectPendingNewCardID(state)) return true;
	return Object.keys(selectRawCards(state)).some(key => key === cardID);
};

//Returns the cardType for the card with the given ID. It looks over the set of
//cards in client, but also will return the pendingNewCardType if the cardID
//matches. See also getCardExists.
export const getCardType = (state, cardID) => {
	if (cardID == selectPendingNewCardID(state)) return selectPendingNewCardType(state);
	const cards = selectRawCards(state);
	const card = cards[cardID] || {};
	return card.card_type || '';
};