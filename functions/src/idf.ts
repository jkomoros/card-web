import { onSchedule } from 'firebase-functions/v2/scheduler';
import { createRequire } from 'module';

import { db, storage } from './common.js';

// These are now exported from shared/nlp.js
import {
	calcIDFMapForCards,
	MAX_N_GRAM_FOR_FINGERPRINT,
	cardWithNormalizedTextPropertiesSimple as cardWithNormalizedTextProperties
} from '../../shared/nlp.js';
import { BODY_CARD_TYPES } from '../../shared/card_fields.js';
import { overrideDocument } from '../../shared/document.js';
import type { Card, ProcessedCard } from '../../shared/types.js';

// ProcessedCards type should match what calcIDFMapForCards expects
type ProcessedCards = {
	[id: string]: ProcessedCard
};

const require = createRequire(import.meta.url);

// Lazy-init jsdom for Node.js environment (NLP code needs DOM to parse HTML).
// We must use overrideDocument() rather than setting global.document because
// shared/document.ts captures DOCUMENT at module evaluation time (before this
// top-level code runs), so mutating globals has no effect.
// Initialized lazily so non-NLP Cloud Functions don't pay the JSDOM cold start cost.
let jsdomInitialized = false;
const ensureJsdom = () => {
	if (jsdomInitialized) return;
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { JSDOM } = require('jsdom');
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	overrideDocument(dom.window.document);
	jsdomInitialized = true;
};

export const calculateIDF = onSchedule({
	schedule: '0 2 * * 0', // Weekly Sunday 2:00 AM PST
	timeZone: 'America/Los_Angeles',
	memory: '2GiB',
	timeoutSeconds: 540 // 9 minutes
}, async (_event) => {
	ensureJsdom();
	try {
		// 1. Fetch all cards from Firestore
		console.log('Fetching cards from Firestore...');
		const snapshot = await db.collection('cards').get();
		const allCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Card));
		console.log(`Fetched ${allCards.length} total cards`);

		// 2. Filter to published body cards only. The generated map is public,
		// so it must not include vocabulary from unpublished/private cards.
		const bodyCards = allCards.filter(card => card.published && BODY_CARD_TYPES[card.card_type]);
		console.log(`Filtered to ${bodyCards.length} published body cards`);

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
