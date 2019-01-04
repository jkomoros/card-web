export const FIND_DIALOG_OPEN = 'FIND_DIALOG_OPEN';
export const FIND_DIALOG_CLOSE ='FIND_DIALOG_CLOSE';
export const FIND_UPDATE_QUERY = 'FIND_UPDATE_QUERY';
export const FIND_CARD_TO_LINK = 'FIND_CARD_TO_LINK';

export const openFindDialog = () => {
  return {
    type: FIND_DIALOG_OPEN
  }
}

export const closeFindDialog = () => {
  return {
    type: FIND_DIALOG_CLOSE
  }
}

export const updateQuery = (query) => {
  return {
    type: FIND_UPDATE_QUERY,
    query
  }
}

export const findCardToLink = () => {
  return {
    type: FIND_CARD_TO_LINK
  }
}