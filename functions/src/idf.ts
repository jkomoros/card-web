import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { JSDOM } from 'jsdom';

// Polyfill for server environment - jsdom is already a dependency (see functions/package.json line 29)
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
(global as any).document = dom.window.document;
(global as any).window = dom.window;

// These are now exported from nlp.ts
import { calcIDFMapForCards, MAX_N_GRAM_FOR_FINGERPRINT } from '../../src/nlp.js';
import { cardWithNormalizedTextProperties } from '../../src/nlp.js';
import { BODY_CARD_TYPES } from '../../shared/card_fields.js';

export const calculateIDF = onSchedule({
	schedule: '0 2 * * 0', // Weekly Sunday 2:00 AM PST
	timeZone: 'America/Los_Angeles',
	memory: '2GiB',
	timeoutSeconds: 540 // 9 minutes
}, async (event) => {
	try {
		const db = getFirestore();
		const storage = getStorage();

		// 1. Fetch all cards from Firestore
		console.log('Fetching cards from Firestore...');
		const snapshot = await db.collection('cards').get();
		const allCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
		console.log(`Fetched ${allCards.length} total cards`);

		// 2. Filter to body cards only
		const bodyCards = allCards.filter(card => BODY_CARD_TYPES[card.card_type]);
		console.log(`Filtered to ${bodyCards.length} body cards`);

		// 3. Process cards with NLP
		// For IDF calculation, we can pass empty maps since we only need word counts
		const processedCards = Object.fromEntries(
			bodyCards.map(card => [
				card.id,
				cardWithNormalizedTextProperties(card, {}, {}, {})
			])
		);

		// 4. Calculate IDF map
		console.log('Calculating IDF map...');
		const idfMap = calcIDFMapForCards(processedCards, MAX_N_GRAM_FOR_FINGERPRINT);
		console.log(`Generated IDF map with ${Object.keys(idfMap.idf).length} terms`);

		// 5. Create versioned data
		const idfData = {
			version: Date.now(),
			cardCount: bodyCards.length,
			ngramSize: MAX_N_GRAM_FOR_FINGERPRINT,
			idf: idfMap.idf,
			maxIDF: idfMap.maxIDF,
			generatedAt: new Date().toISOString()
		};

		// 6. Upload to Cloud Storage
		const bucket = storage.bucket();
		const versionedPath = `idf-maps/idf-v${idfData.version}.json`;
		const latestPath = 'idf-maps/latest.json';

		console.log(`Uploading to ${versionedPath}...`);
		await bucket.file(versionedPath).save(JSON.stringify(idfData), {
			contentType: 'application/json',
			metadata: { cacheControl: 'public, max-age=604800' } // 7 days
		});

		console.log(`Uploading to ${latestPath}...`);
		await bucket.file(latestPath).save(JSON.stringify(idfData), {
			contentType: 'application/json',
			metadata: { cacheControl: 'public, max-age=3600' } // 1 hour
		});

		console.log(`✓ IDF map generated successfully: ${bodyCards.length} cards, version ${idfData.version}`);
	} catch (error) {
		console.error('Failed to generate IDF map:', error);
		throw error;
	}
});
