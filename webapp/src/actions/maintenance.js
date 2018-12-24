
import {
  db,
  CARDS_COLLECTION,
  SECTIONS_COLLECTION,
  MAINTENANCE_COLLECTION
} from './database.js';

const randomCharSet = "abcdef0123456789"

export const randomString = (length) => {
  let text = "";
  for (let i = 0; i < length; i++) {
    text += randomCharSet.charAt(Math.floor(Math.random() * randomCharSet.length));
  }
  return text;
}

const checkMaintenanceTaskHasBeenRun = async (taskName) => {
  let ref = db.collection(MAINTENANCE_COLLECTION).doc(taskName);

  let doc = await ref.get();

  if (doc.exists) {
    if (!window.confirm("This task has been run before on this database. Do you want to run it again?")) {
      throw taskName + " has been run before and the user didn't want to run again"
    }
  }

  return
}

const maintenanceTaskRun = async (taskName) => {
  db.collection(MAINTENANCE_COLLECTION).doc(taskName).set({timestamp: new Date()});
}

export const addTwoOldMaintenanceTasks = async () => {

  let maintenanceName = 'add-two-old-maintenance-tasks';

  //This task is run because 

  await checkMaintenanceTaskHasBeenRun(maintenanceName);

  await maintenanceTaskRun('add-card-type-to-imported-cards');
  await maintenanceTaskRun('add-section-header-cards');

  await maintenanceTaskRun(maintenanceName);
  console.log("Done!")


}

export const addCardTypeToImportedCards = async () => {

  let maintenanceName = 'add-card-type-to-imported-cards';

  await checkMaintenanceTaskHasBeenRun(maintenanceName);

  let batch = db.batch();

  db.collection(CARDS_COLLECTION).where('imported', '==', true).get().then(snapshot => {
    snapshot.forEach(doc => {
      batch.update(doc.ref, {'card_type': 'content'})
    });
    batch.commit().then(() => {
      maintenanceTaskRun(maintenanceName);
      console.log('Updated!')
    });
  })

}

export const addSectionHeaderCards = async () => {

  let maintenanceName = 'add-section-header-cards';

  await checkMaintenanceTaskHasBeenRun(maintenanceName);

  let batch = db.batch();

  let halfBakedCard = newCard('section-half-baked');
  let barelyEdibleCard = newCard('section-barely-edible');
  let stubsCard = newCard('section-stubs');
  let randomThoughtsCard = newCard('section-random-thoughts');

  halfBakedCard.title = "Half-Baked";
  halfBakedCard.subtitle = "Ideas that are probably as baked as they’re going to get in this collection";
  halfBakedCard.card_type = 'section-head';
  halfBakedCard.section = 'half-baked';

  barelyEdibleCard.title = "Barely Edible";
  barelyEdibleCard.subtitle = "Ideas that have some detail roughed in, but not organized for clarity yet";
  barelyEdibleCard.card_type = 'section-head';
  barelyEdibleCard.section = 'barely-edible';

  stubsCard.title = "Stubs";
  stubsCard.subtitle = "Points that I plan to develop more, but haven’t yet";
  stubsCard.card_type = 'section-head';
  stubsCard.section = 'stubs';

  randomThoughtsCard.title = "Random Thoughts";
  randomThoughtsCard.subtitle = "A parking lot for early stage thoughts that might be dupes or not worth developing";
  randomThoughtsCard.card_type = 'section-head';
  randomThoughtsCard.section = 'random-thoughts'

  batch.set(db.collection(CARDS_COLLECTION).doc(halfBakedCard.name), halfBakedCard);
  batch.set(db.collection(CARDS_COLLECTION).doc(barelyEdibleCard.name), barelyEdibleCard);
  batch.set(db.collection(CARDS_COLLECTION).doc(stubsCard.name), stubsCard);
  batch.set(db.collection(CARDS_COLLECTION).doc(randomThoughtsCard.name), randomThoughtsCard);

  batch.update(db.collection(SECTIONS_COLLECTION).doc('half-baked'), {start_cards: [halfBakedCard.name]})
  batch.update(db.collection(SECTIONS_COLLECTION).doc('barely-edible'), {start_cards: [barelyEdibleCard.name]})
  batch.update(db.collection(SECTIONS_COLLECTION).doc('stubs'), {start_cards: [stubsCard.name]})
  batch.update(db.collection(SECTIONS_COLLECTION).doc('random-thoughts'), {start_cards: [randomThoughtsCard.name]})

  batch.commit().then(() => {
    maintenanceTaskRun(maintenanceName);
    console.log("Updated!")
  });

}


export const doImport = () => {

  fetch(`/src/data/cards.json`).then(resp => {
    resp.json().then(data => importCards(data.cards));
  })
}

export const importCards = (cards) => {
  //Designed for one-time bulk import

  let transformedCards = {}

  let sections = {};

  for (let key of Object.keys(cards).sort((a,b) => cards[a].index - cards[b].index)) {
    let card = transformImportCard(cards[key]);

    let sectionName = card.section;
    let section = sections[sectionName] || [];
    section.push(key);
    sections[sectionName] = section;

    transformedCards[key] = card;
  } 

  //we now have a set of transformed cards to add directly in (with their id),
  //and a list of cards per section to overwrite the current things with.

  let mainBatch = db.batch();
  let slideUpdatesBatch = db.batch();

  for (let key of Object.keys(transformedCards)) {
    let card = transformedCards[key];
    let ref = db.collection(CARDS_COLLECTION).doc(key);
    mainBatch.set(ref, card);
    let update = {
      substantive: true,
      timestamp: new Date(),
      import: true
    }
    let updateRef = ref.collection(CARD_UPDATES_COLLECTION).doc('' + Date.now());
    slideUpdatesBatch.set(updateRef, update);
  }

  for (let key of Object.keys(sections)) {
    let sectionCards = sections[key];
    let ref = db.collection(SECTIONS_COLLECTION).doc(key);
    mainBatch.update(ref, {cards:sectionCards});
  }


  mainBatch.commit().then(() => {
    console.log("Main batch Done!");
    slideUpdatesBatch.commit().then(() => {
      console.log("Slide update batch done");
    });
  })


}

const newCard = (name) => {
    return {
      created: new Date(),
      updated: new Date(),
      updated_substantive: new Date(),
      slugs: [],
      name: name
    }
}

const transformImportSectionName = (legacySectionName) => {
  if (!legacySectionName) return "stubs";
  legacySectionName = legacySectionName.toLowerCase();
  return legacySectionName.split(" ").join("-");
}

const transformImportCard = (legacyCard) => {
  return {
    created: new Date(),
    updated: new Date(),
    updated_substantive: new Date(),
    title: legacyCard.title || "",
    body: legacyCard.body || "",
    links: legacyCard.links || [],
    imported: true,
    links_inbound: legacyCard.inbound_links || [],
    slugs: legacyCard.slugs ? legacyCard.slugs.split(",") : [],
    notes: legacyCard.notes || "",
    tags: legacyCard.tags || [],
    section: transformImportSectionName(legacyCard.sectionname),
    name: legacyCard.name || ""
  }
}