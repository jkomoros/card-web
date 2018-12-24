
import {
  db
} from './database.js';

const randomCharSet = "abcdef0123456789"

const randomString = (length) => {
  let text = "";
  for (let i = 0; i < length; i++) {
    text += randomCharSet.charAt(Math.floor(Math.random() * randomCharSet.length));
  }
  return text;
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