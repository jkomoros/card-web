export const UPDATE_CHANGES_CARDS= 'UPDATE_CHANGES_CARDS';
export const CHANGES_FETCHING='CHANGES_FETCHING';

import {
  db,
  CARDS_COLLECTION
} from './database.js';

const fetching = (isFetching) => {
  return {
    type: CHANGES_FETCHING,
    isFetching 
  }
}

export const fetchRecentChanges = (numDays) => (dispatch, getState) => {

  dispatch(fetching(true));

  let today = new Date();
  let earlier = new Date();
  earlier.setDate(earlier.getDate() - numDays);

  let updateField = 'updated_substantive'

  db.collection(CARDS_COLLECTION).where('card_type', '==', 'content').where(updateField, '<=', today).where(updateField, ">=", earlier).orderBy(updateField, 'desc').get().then(snapshot => {
    let result = {}
    snapshot.forEach(doc => {
      let obj = doc.data();
      obj.id = doc.id;
      let arr = result[obj.section];
      if (!arr) {
        arr = [];
        result[obj.section] = arr;
      }
      arr.push(obj);
    })
    dispatch(updateChangesCards(result));
  }).catch(err => {
    console.log(err);
    dispatch(fetching(false))
  })

}

const updateChangesCards = (cardsBySection) => {
  return {
    type: UPDATE_CHANGES_CARDS,
    cardsBySection
  }
}