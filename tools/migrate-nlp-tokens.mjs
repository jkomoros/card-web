#!/usr/bin/env node

/**
 * One-time migration script to backfill NLP tokens for existing cards
 *
 * Usage:
 *   node tools/migrate-nlp-tokens.mjs              # Run on prod
 *   node tools/migrate-nlp-tokens.mjs --dev        # Run on dev
 *   node tools/migrate-nlp-tokens.mjs --dry-run    # Preview without writing
 *   node tools/migrate-nlp-tokens.mjs --limit=100  # Test on first 100 cards
 *
 * Prerequisites:
 *   Run: gcloud auth application-default login
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFileSync } from 'fs';
import { JSDOM } from 'jsdom';
import { devProdConfig } from '../lib/tools/util.js';
import { cardWithNormalizedTextPropertiesSimple, ngrams, CURRENT_NLP_VERSION } from '../shared/dist/nlp.js';
import { overrideDocument } from '../shared/dist/document.js';

// Set up jsdom for Node.js environment (NLP code needs DOM to parse HTML)
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
overrideDocument(dom.window.document);

// Parse command line arguments
const parseArgs = (argv) => {
	const args = {};
	argv.forEach(arg => {
		if (arg.startsWith('--')) {
			const [key, value] = arg.slice(2).split('=');
			args[key] = value || true;
		}
	});
	return args;
};

const args = parseArgs(process.argv.slice(2));

// Show help
if (args.help || args.h) {
	console.log(`
Usage: node tools/migrate-nlp-tokens.mjs [OPTIONS]

Backfill NLP tokens (nlp_tokens, nlp_search_tokens, nlp_version) for existing cards.

Options:
  --dev         Use development database
  --dry-run     Preview changes without writing to Firestore
  --limit=N     Only process first N cards (for testing)
  --help, -h    Show this help message

Prerequisites:
  Run once: gcloud auth application-default login

Examples:
  node tools/migrate-nlp-tokens.mjs --dev --dry-run
  node tools/migrate-nlp-tokens.mjs --limit=100
  node tools/migrate-nlp-tokens.mjs
	`);
	process.exit(0);
}

const isDev = args.dev;
const dryRun = args['dry-run'];
const limit = args.limit ? parseInt(args.limit) : null;

// Initialize Firebase Admin with Application Default Credentials
const config = devProdConfig();
const projectConfig = isDev ? config.dev : config.prod;
const projectId = projectConfig.firebase.projectId;
console.log('🚀 NLP Token Migration Script\n');
console.log('Configuration:');
console.log('  Project:', projectId);
console.log('  Mode:', isDev ? 'DEV' : 'PROD');
if (dryRun) console.log('  ⚠️  DRY RUN - No changes will be written');
if (limit) console.log('  Limit:', limit, 'cards');
console.log('');

// Confirm before proceeding
console.log('⚠️  This will modify cards in Firestore!');
console.log('Press Ctrl+C to cancel, or Enter to continue...\n');

// Wait for user confirmation
await new Promise((resolve) => {
	process.stdin.once('data', resolve);
});

// Initialize Firebase
try {
	initializeApp({
		credential: applicationDefault(),
		projectId: projectId
	});
	console.log('✓ Authenticated via Application Default Credentials\n');
} catch (err) {
	console.error('❌ Authentication failed:', err.message);
	console.log('\nRun: gcloud auth application-default login');
	process.exit(1);
}

const db = getFirestore();
const CARDS_COLLECTION = 'cards';

/**
 * Commit a batch with exponential backoff retry logic
 */
async function commitBatchWithRetry(batch, maxRetries = 3) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			await batch.commit();
			return;
		} catch (err) {
			if (attempt === maxRetries) throw err;
			const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
			console.log(`  ⚠️  Batch commit failed, retry ${attempt}/${maxRetries} after ${delay}ms...`);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
}

/**
 * Main migration logic
 */
async function migrate() {
	const startTime = Date.now();

	try {
		// 1. Fetch all cards
		console.log('📥 Fetching cards from Firestore...');
		const snapshot = await db.collection(CARDS_COLLECTION).get();
		const totalCount = snapshot.size;

		console.log(`Found ${totalCount} cards\n`);

		// Apply limit if specified
		const cardsToProcess = limit ? snapshot.docs.slice(0, limit) : snapshot.docs;
		const processingCount = cardsToProcess.length;

		if (limit && processingCount < totalCount) {
			console.log(`⚠️  Processing only ${processingCount} cards (--limit=${limit})\n`);
		}

		// 2. Process in batches
		const BATCH_SIZE = 250; // Firestore batch limit is 500, stay conservative
		let processedCount = 0;
		let skippedCount = 0;
		let updatedCount = 0;
		let errorCount = 0;
		const errors = [];

		for (let i = 0; i < cardsToProcess.length; i += BATCH_SIZE) {
			const batch = db.batch();
			const batchDocs = cardsToProcess.slice(i, i + BATCH_SIZE);
			let batchUpdates = 0;

			for (const docSnap of batchDocs) {
				let card;
				try {
					card = { id: docSnap.id, ...docSnap.data() };

					// Skip if already has tokens at current version
					if (card.nlp_tokens && card.nlp_version === CURRENT_NLP_VERSION) {
						skippedCount++;
						processedCount++;
						continue;
					}

					// Skip if no content
					if (!card.title && !card.body && !card.commentary) {
						skippedCount++;
						processedCount++;
						continue;
					}

					// Generate NLP tokens
					const processedCard = cardWithNormalizedTextPropertiesSimple(card);

					// Convert to storage format: only normalized + uppercaseRanges.
					// stemmed and withoutStopWords are derived at load time.
					const nlpTokens = {};
					for (const [fieldName, runs] of Object.entries(processedCard.nlp)) {
						nlpTokens[fieldName] = runs.map(run => ({
							normalized: run.normalized,
							...(run.uppercaseRanges ? { uppercaseRanges: run.uppercaseRanges } : {})
						}));
					}

					// Generate nlp_search_tokens: flat array of deduplicated
					// stemmed unigrams + bigrams for array-contains queries
					const searchTokenSet = new Set();
					for (const [, runs] of Object.entries(processedCard.nlp)) {
						if (!runs) continue;
						for (const run of runs) {
							for (const word of run.stemmed.split(' ')) {
								if (word) searchTokenSet.add(word);
							}
							for (const bigram of ngrams(run.stemmed, 2)) {
								searchTokenSet.add(bigram);
							}
						}
					}

					// Add to batch (if not dry run)
					if (!dryRun) {
						batch.update(docSnap.ref, {
							nlp_tokens: nlpTokens,
							nlp_search_tokens: Array.from(searchTokenSet),
							nlp_version: CURRENT_NLP_VERSION
						});
					}

					batchUpdates++;
					updatedCount++;
					processedCount++;

				} catch (err) {
					errorCount++;
					errors.push({
						cardId: docSnap.id,
						error: err.message || String(err),
						stack: err.stack,
						cardData: card ? {
							hasTitle: !!card.title,
							hasBody: !!card.body,
							hasCommentary: !!card.commentary,
							hasNlpTokens: !!card.nlp_tokens
						} : null
					});
					processedCount++;

					// Stop if too many errors
					if (errorCount > 100) {
						throw new Error('Too many errors (>100), stopping migration');
					}
				}
			}

			// Commit this batch (only if there are updates and not dry run)
			if (batchUpdates > 0 && !dryRun) {
				await commitBatchWithRetry(batch);
			}

			// Log progress
			const percentage = ((processedCount / processingCount) * 100).toFixed(1);
			console.log(`Progress: ${processedCount}/${processingCount} (${percentage}%) - Updated: ${updatedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
		}

		const endTime = Date.now();
		const duration = ((endTime - startTime) / 1000).toFixed(1);

		console.log('\n' + '='.repeat(60));
		if (dryRun) {
			console.log('✅ DRY RUN COMPLETE');
		} else {
			console.log('✅ MIGRATION COMPLETE');
		}
		console.log('='.repeat(60));
		console.log(`Duration: ${duration}s`);
		console.log(`Total processed: ${processedCount}`);
		console.log(`Updated with tokens: ${updatedCount}`);
		console.log(`Skipped: ${skippedCount}`);
		console.log(`Errors: ${errorCount}`);

		if (errors.length > 0) {
			console.log('\n❌ Errors encountered:');
			errors.slice(0, 10).forEach(err => {
				console.log(`  - Card ${err.cardId}: ${err.error}`);
			});
			if (errors.length > 10) {
				console.log(`  ... and ${errors.length - 10} more errors`);
			}
		}

		// Write summary report
		const summary = {
			timestamp: new Date().toISOString(),
			projectId,
			mode: isDev ? 'dev' : 'prod',
			dryRun,
			limit,
			totalCards: totalCount,
			processed: processedCount,
			updated: updatedCount,
			skipped: skippedCount,
			errors: errorCount,
			errorDetails: errors,
			durationSeconds: parseFloat(duration)
		};

		const reportFile = 'migration-nlp-tokens-report.json';
		writeFileSync(reportFile, JSON.stringify(summary, null, 2));
		console.log(`\n📄 Report saved to: ${reportFile}`);

		if (errorCount > 0) {
			process.exit(1);
		}

	} catch (err) {
		console.error('\n❌ Migration failed:', err);
		process.exit(1);
	}
}

migrate();
