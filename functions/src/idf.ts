import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { JSDOM } from 'jsdom';
import type { DOMWindow } from 'jsdom';
import * as functions from 'firebase-functions';

// These are now exported from shared/nlp.js
import {
	calcIDFMapForCards,
	MAX_N_GRAM_FOR_FINGERPRINT,
	cardWithNormalizedTextPropertiesSimple as cardWithNormalizedTextProperties
} from '../../shared/nlp.js';
import { BODY_CARD_TYPES } from '../../shared/card_fields.js';
import type { Card, ProcessedCard } from '../../shared/types.js';

// ProcessedCards type should match what calcIDFMapForCards expects
type ProcessedCards = {
	[id: string]: ProcessedCard
};

// Polyfill for server environment - jsdom is already a dependency (see functions/package.json line 29)
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');

// Type the global object properly for JSDOM polyfill
interface GlobalWithDOM {
	document: typeof dom.window.document;
	window: DOMWindow;
}
(global as unknown as GlobalWithDOM).document = dom.window.document;
(global as unknown as GlobalWithDOM).window = dom.window;

export const calculateIDF = onSchedule({
	schedule: '0 2 * * 0', // Weekly Sunday 2:00 AM PST
	timeZone: 'America/Los_Angeles',
	memory: '2GiB',
	timeoutSeconds: 540 // 9 minutes
}, async (_event) => {
	try {
		// Read database ID from functions config (set by CONFIGURE_API_KEYS task)
		const databaseId = functions.config().firestore?.database_id || '(default)';
		const db = databaseId === '(default)' ? getFirestore() : getFirestore(undefined, databaseId);
		const storage = getStorage();

		// 1. Fetch all cards from Firestore
		console.log('Fetching cards from Firestore...');
		const snapshot = await db.collection('cards').get();
		const allCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
		console.log(`Fetched ${allCards.length} total cards`);

		// 2. Filter to body cards only
		const bodyCards = allCards.filter(card => BODY_CARD_TYPES[card.card_type]);
		console.log(`Filtered to ${bodyCards.length} body cards`);

		// 3. Process cards with NLP
		// Using simplified version that doesn't require fallbackText, importantNgrams, or synonyms
		const processedCards: ProcessedCards = Object.fromEntries(
			bodyCards.map(card => [
				card.id,
				cardWithNormalizedTextProperties(card)
			])
		) as ProcessedCards;

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
