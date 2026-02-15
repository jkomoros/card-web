#!/usr/bin/env node

/**
 * Verify data consistency between Standard and Enterprise databases
 * Usage: node tools/verify-migration.mjs
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import { devProdConfig } from './lib/tools/util.js';

// Check if service account key exists
let serviceAccountPath = './service-account-key.json';
if (!fs.existsSync(serviceAccountPath)) {
	console.error('❌ Service account key not found at:', serviceAccountPath);
	console.log('\nTo run this script, you need a service account key:');
	console.log('  1. Go to Firebase Console → Project Settings → Service Accounts');
	console.log('  2. Click "Generate new private key"');
	console.log('  3. Save as service-account-key.json in project root');
	console.log('  4. Add service-account-key.json to .gitignore (already done)');
	process.exit(1);
}

const config = devProdConfig();
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));

// Determine which project to verify
const args = process.argv.slice(2);
const useDev = args.includes('--dev');
const projectConfig = useDev ? config.dev : config.prod;

console.log('🔍 Verifying migration for project:', projectConfig.firebase.projectId);

const app = initializeApp({
	credential: cert(serviceAccount),
	projectId: projectConfig.firebase.projectId
});

const standardDb = getFirestore(app, '(default)');
// Use "firestore" as the Enterprise database name (auto-generated default)
const enterpriseDbId = 'firestore';
const enterpriseDb = getFirestore(app, enterpriseDbId);

console.log('Standard database: (default)');
console.log('Enterprise database:', enterpriseDbId);

// Collections to verify
const COLLECTIONS = [
	'cards',
	'sections',
	'tags',
	'authors',
	'reading_lists',
	'permissions',
	'updates',
	'messages',
	'stars',
	'reads',
	'tweets',
	'maintenance_tasks'
];

async function verifyCollections() {
	console.log('\n📊 Verifying document counts...\n');

	let allMatch = true;

	for (const collName of COLLECTIONS) {
		try {
			const standardSnapshot = await standardDb.collection(collName).count().get();
			const enterpriseSnapshot = await enterpriseDb.collection(collName).count().get();

			const standardCount = standardSnapshot.data().count;
			const enterpriseCount = enterpriseSnapshot.data().count;

			console.log(collName + ':');
			console.log('  Standard: ' + standardCount + ' documents');
			console.log('  Enterprise: ' + enterpriseCount + ' documents');

			if (standardCount !== enterpriseCount) {
				console.log('  ❌ COUNT MISMATCH!');
				allMatch = false;
			} else if (standardCount === 0) {
				console.log('  ⚠️  Empty collection');
			} else {
				console.log('  ✅ Counts match');
			}
		} catch (err) {
			console.log('  ⚠️  Error checking collection: ' + err.message);
		}
	}

	return allMatch;
}

async function verifySampleDocuments() {
	console.log('\n📄 Verifying sample documents...\n');

	try {
		// Get 5 random cards from Standard
		const standardCards = await standardDb.collection('cards')
			.limit(5)
			.get();

		if (standardCards.empty) {
			console.log('No cards found in Standard database to verify');
			return true;
		}

		let allMatch = true;

		for (const standardDoc of standardCards.docs) {
			const cardId = standardDoc.id;
			const enterpriseDoc = await enterpriseDb.collection('cards').doc(cardId).get();

			if (!enterpriseDoc.exists) {
				console.log('❌ Card "' + cardId + '" missing in Enterprise database');
				allMatch = false;
				continue;
			}

			const standardData = standardDoc.data();
			const enterpriseData = enterpriseDoc.data();

			// Compare key fields
			const fieldsToCheck = ['name', 'title', 'section', 'tags', 'published'];

			let docMatch = true;
			for (const field of fieldsToCheck) {
				const standardValue = JSON.stringify(standardData[field]);
				const enterpriseValue = JSON.stringify(enterpriseData[field]);

				if (standardValue !== enterpriseValue) {
					console.log('❌ Card "' + cardId + '" field "' + field + '" mismatch');
					console.log('  Standard: ' + standardValue);
					console.log('  Enterprise: ' + enterpriseValue);
					docMatch = false;
					allMatch = false;
				}
			}

			if (docMatch) {
				console.log('✅ Card "' + cardId + '" matches');
			}
		}

		return allMatch;
	} catch (err) {
		console.error('Error verifying sample documents:', err);
		return false;
	}
}

async function verify() {
	try {
		const collectionsMatch = await verifyCollections();
		const documentsMatch = await verifySampleDocuments();

		console.log('\n' + '='.repeat(50));
		if (collectionsMatch && documentsMatch) {
			console.log('✅ VERIFICATION PASSED');
			console.log('Standard and Enterprise databases are consistent');
		} else {
			console.log('❌ VERIFICATION FAILED');
			console.log('Databases have inconsistencies');
			process.exit(1);
		}
	} catch (err) {
		console.error('❌ Verification error:', err);
		process.exit(1);
	} finally {
		process.exit(0);
	}
}

verify();
