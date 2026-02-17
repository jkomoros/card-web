#!/usr/bin/env node
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'dev-complexity-compendium' });
const db = getFirestore(undefined, '(default)');

// Get a few random cards
const snapshot = await db.collection('cards').limit(3).get();

console.log(`Checking ${snapshot.size} cards:\n`);

for (const doc of snapshot.docs) {
  const card = doc.data();
  console.log(`Card ID: ${doc.id}`);
  console.log(`  Title: ${card.title || '(none)'}`);
  console.log(`  Has nlp_tokens: ${!!card.nlp_tokens}`);
  console.log(`  Has nlp_fingerprint: ${!!card.nlp_fingerprint}`);
  console.log(`  nlp_version: ${card.nlp_version || '(none)'}`);
  if (card.nlp_tokens) {
    const fields = Object.keys(card.nlp_tokens);
    console.log(`  Token fields: ${fields.join(', ')}`);
    if (card.nlp_tokens.title && card.nlp_tokens.title[0]) {
      console.log(`  Sample token: ${JSON.stringify(card.nlp_tokens.title[0])}`);
    }
  }
  console.log('');
}
