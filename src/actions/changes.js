export const UPDATE_CHANGES_CARDS= 'UPDATE_CHANGES_CARDS';

import {
  db,
  CARDS_COLLECTION
} from './database.js';

export const fetchRecentChanges = (numDays) => (dispatch, getState) => {

  let today = new Date();
  let earlier = new Date();
  earlier.setDate(earlier.getDate() - numDays);

  let updateField = 'updated_substantive'

  db.collection(CARDS_COLLECTION).where(updateField, '<=', today).where(updateField, ">=", earlier).orderBy(updateField, 'desc').get().then(snapshot => {
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
  })

}

const updateChangesCards = (cardsBySection) => {
  return {
    type: UPDATE_CHANGES_CARDS,
    cardsBySection
  }
}