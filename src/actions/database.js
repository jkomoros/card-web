export const db = firebase.firestore();

import {
  updateCards,
  updateSections
} from './data.js';

import {
  updateMessages,
  updateThreads
} from './comments.js';

export const CARDS_COLLECTION = 'cards';
export const CARD_UPDATES_COLLECTION = 'updates';
export const SECTION_UPDATES_COLLECTION = 'updates';
export const SECTIONS_COLLECTION = 'sections';
export const MAINTENANCE_COLLECTION = 'maintenance_tasks';
export const AUTHORS_COLLECTION = 'authors';
export const THREADS_COLLECTION = 'threads';
export const MESSAGES_COLLECTION = 'messages';

db.settings({
  timestampsInSnapshots:true,
})

let liveMessagesUnsubscribe = null;
let liveThreadsUnsubscribe = null;

export const connectLiveMessages = (store, cardId) => {
  if (liveMessagesUnsubscribe) {
    liveMessagesUnsubscribe();
    liveMessagesUnsubscribe = null;
  }
  liveMessagesUnsubscribe = db.collection(MESSAGES_COLLECTION).where('card', '==', cardId).onSnapshot(snapshot => {
    let messages = {};

    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') return;
      let doc = change.doc;
      let id = doc.id;
      let message = doc.data();
      message.id = id;
      messages[id] = message;
    })

    store.dispatch(updateMessages(messages));
  })
}

export const connectLiveThreads = (store, cardId) => {
  if (liveThreadsUnsubscribe) {
    liveThreadsUnsubscribe();
    liveThreadsUnsubscribe = null;
  }
  liveThreadsUnsubscribe = db.collection(THREADS_COLLECTION).where('card', '==', cardId).onSnapshot(snapshot => {
    let threads = {};

    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') return;
      let doc = change.doc;
      let id = doc.id;
      let thread = doc.data();
      thread.id = id;
      threads[id] = thread;
    })

    store.dispatch(updateThreads(threads));
  })
}

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

export const connectLiveSections = (store) => {
  db.collection(SECTIONS_COLLECTION).orderBy('order').onSnapshot(snapshot => {

    let sections = {};

    snapshot.docChanges().forEach(change => {
      if (change.type === 'removed') return;
      let doc = change.doc;
      let id = doc.id;
      let section = doc.data();
      section.id = id;
      sections[id] = section;
    })

    store.dispatch(updateSections(sections));

  })
}

