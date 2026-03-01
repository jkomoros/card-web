import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import * as readline from 'readline';

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import TurndownService from 'turndown';

import {
	deserializeCollectionURL
} from '../shared/collection_description_base.js';

import {
	CARDS_COLLECTION,
	TAGS_COLLECTION
} from '../shared/collection-constants.js';

import {
	ImageInfo
} from '../shared/types.js';

import {
	selectedProjectID,
	devProdConfig,
} from './util.js';

//--- Types ---

interface SyncConfig {
	collectionUrl: string;
	projectId: string;
}

interface CardData {
	id: string;
	slug: string;
	title: string;
	body: string;
	commentary: string;
	card_type: string;
	tags: string[];
	published: boolean;
	created: FirebaseFirestore.Timestamp;
	updated: FirebaseFirestore.Timestamp;
	images: ImageInfo[];
	auto_todo_overrides: Record<string, boolean | undefined>;
	name: string;
	slugs: string[];
}

interface DiffResult {
	newCards: CardData[];
	updatedCards: CardData[];
	unchangedCount: number;
	removedIds: string[];
	imagesToFetch: number;
}

//Map of card ID -> slug (or name, or id as fallback)
type SlugIndex = Map<string, string>;
//Map of tag card ID -> tag slug/name for directory names
type TagIndex = Map<string, string>;

//--- Constants ---

const SYNC_CONFIG_FILE = '.card-web-sync.json';
const CARDS_DIR = 'cards';
const IMAGES_DIR = 'images';
const TAGS_DIR = 'tags';
const PRIORITIZED_DIR = 'prioritized';
const UNPRIORITIZED_DIR = 'unprioritized';

//Filters we know how to convert to Firestore constraints
const KNOWN_FILTERS: Record<string, boolean> = {
	'published': true,
	'unpublished': true,
};

//--- CLI Argument Parsing ---

interface CLIArgs {
	mountPoint: string;
	collection: string;
	dryRun: boolean;
	force: boolean;
	dev: boolean;
}

const parseArgs = (): CLIArgs => {
	const args = process.argv.slice(2);
	const result: CLIArgs = {
		mountPoint: '',
		collection: '',
		dryRun: false,
		force: false,
		dev: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--collection' && i + 1 < args.length) {
			result.collection = args[++i];
		} else if (arg === '--dry-run') {
			result.dryRun = true;
		} else if (arg === '--force') {
			result.force = true;
		} else if (arg === '--dev') {
			result.dev = true;
		} else if (!arg.startsWith('-') && !result.mountPoint) {
			result.mountPoint = arg;
		}
	}

	if (!result.mountPoint) {
		console.error(`Usage: npx tsx tools/mount.ts <mount-point> [options]

Arguments:
  mount-point              Directory to sync cards into

Options:
  --collection <url>       CollectionDescription URL (required on first sync)
                           e.g. "unpublished/bits-and-bobs"
  --dry-run                Show what would change without writing
  --force                  Skip confirmation prompt, execute immediately
  --dev                    Use dev Firestore (default: based on \`firebase use\`)`);
		process.exit(1);
	}

	return result;
};

//--- Config File ---

const readSyncConfig = (mountPoint: string): SyncConfig | null => {
	const configPath = path.join(mountPoint, SYNC_CONFIG_FILE);
	if (!fs.existsSync(configPath)) return null;
	return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as SyncConfig;
};

const writeSyncConfig = (mountPoint: string, config: SyncConfig): void => {
	const configPath = path.join(mountPoint, SYNC_CONFIG_FILE);
	fs.writeFileSync(configPath, JSON.stringify(config, null, '\t') + '\n');
};

//--- Collection URL Parsing & Filter Classification ---

interface ParsedCollection {
	filters: string[];
	tagFilters: string[];
	publishedFilter: 'published' | 'unpublished' | null;
	typeFilter: string | null;
}

const normalizeCollectionURL = (url: string): string => {
	//Strip leading /c/ or c/
	let normalized = url.replace(/^\/c\//, '').replace(/^c\//, '');
	//Ensure trailing slash for the parser
	if (!normalized.endsWith('/')) normalized += '/';
	return normalized;
};

const parseCollectionFilters = (collectionUrl: string, validTagSlugs: Set<string>): ParsedCollection => {
	const normalized = normalizeCollectionURL(collectionUrl);
	//Pass empty objects since the mount tool doesn't need multi-part configurable filter parsing
	const parsed = deserializeCollectionURL(normalized, {}, {});

	const result: ParsedCollection = {
		filters: parsed.filters,
		tagFilters: [],
		publishedFilter: null,
		typeFilter: null,
	};

	const unsupportedFilters: string[] = [];

	for (const filter of parsed.filters) {
		if (filter === 'published') {
			result.publishedFilter = 'published';
		} else if (filter === 'unpublished') {
			result.publishedFilter = 'unpublished';
		} else if (filter.startsWith('type-')) {
			result.typeFilter = filter.replace('type-', '');
		} else if (KNOWN_FILTERS[filter]) {
			//Already handled above
		} else if (validTagSlugs.has(filter)) {
			result.tagFilters.push(filter);
		} else {
			unsupportedFilters.push(filter);
		}
	}

	if (unsupportedFilters.length > 0) {
		console.error(`Unsupported filters: ${unsupportedFilters.join(', ')}`);
		console.error('Supported filters: published, unpublished, type-<name>, <tag-name>');
		process.exit(1);
	}

	if (result.tagFilters.length > 1) {
		console.warn(`Warning: Firestore only supports one array-contains per query. Using first tag filter: ${result.tagFilters[0]}`);
		console.warn('Additional tags will be filtered client-side.');
	}

	return result;
};

//--- Firebase Init ---

const initFirebase = (projectId: string, storageBucket: string) => {
	const app = initializeApp({
		credential: applicationDefault(),
		projectId,
		storageBucket,
	});
	const db = getFirestore(app);
	const storage = getStorage(app);
	return { db, storage };
};

//--- Firestore Queries ---

const fetchCards = async (
	db: FirebaseFirestore.Firestore,
	parsedCollection: ParsedCollection,
	tagIndex: TagIndex
): Promise<CardData[]> => {
	let q: FirebaseFirestore.Query = db.collection(CARDS_COLLECTION);

	//Apply Firestore-level filters
	if (parsedCollection.publishedFilter === 'published') {
		q = q.where('published', '==', true);
	} else if (parsedCollection.publishedFilter === 'unpublished') {
		q = q.where('published', '==', false);
	}

	if (parsedCollection.typeFilter) {
		q = q.where('card_type', '==', parsedCollection.typeFilter);
	}

	//Only one array-contains allowed per query
	if (parsedCollection.tagFilters.length > 0) {
		//Look up the tag card ID from the slug
		const firstTagSlug = parsedCollection.tagFilters[0];
		let tagId = '';
		for (const [id, slug] of tagIndex.entries()) {
			if (slug === firstTagSlug) {
				tagId = id;
				break;
			}
		}
		if (tagId) {
			q = q.where('tags', 'array-contains', tagId);
		} else {
			console.warn(`Could not find tag ID for slug: ${firstTagSlug}`);
		}
	}

	const snapshot = await q.get();
	let cards = snapshot.docs.map(doc => ({
		...doc.data(),
		id: doc.id,
	} as CardData));

	//Client-side filtering for additional tags beyond the first
	if (parsedCollection.tagFilters.length > 1) {
		const additionalTagIds = new Set<string>();
		for (const tagSlug of parsedCollection.tagFilters.slice(1)) {
			for (const [id, slug] of tagIndex.entries()) {
				if (slug === tagSlug) {
					additionalTagIds.add(id);
					break;
				}
			}
		}
		cards = cards.filter(card =>
			[...additionalTagIds].every(tagId => card.tags.includes(tagId))
		);
	}

	return cards;
};

const fetchSlugIndex = async (db: FirebaseFirestore.Firestore): Promise<SlugIndex> => {
	//Fetch all cards but only the fields we need for slug resolution
	const snapshot = await db.collection(CARDS_COLLECTION)
		.select('name', 'slugs')
		.get();

	const index: SlugIndex = new Map();
	for (const doc of snapshot.docs) {
		const data = doc.data();
		//Prefer the name field (which is the primary slug/identifier)
		const slug = data.name || (data.slugs && data.slugs.length > 0 ? data.slugs[0] : doc.id);
		index.set(doc.id, slug);
	}
	return index;
};

const fetchTagIndex = async (db: FirebaseFirestore.Firestore): Promise<TagIndex> => {
	//Tag document IDs in Firestore are the URL-safe slugs (e.g. "bits-and-bobs").
	//These same IDs appear in card.tags arrays. The document may have a "title"
	//field with a display name (e.g. "Bits and Bobs") but for URL matching and
	//directory names we use the document ID directly.
	const snapshot = await db.collection(TAGS_COLLECTION).get();
	const index: TagIndex = new Map();
	for (const doc of snapshot.docs) {
		//Use the document ID as the slug — it's what appears in URLs and card.tags
		index.set(doc.id, doc.id);
	}
	return index;
};

//--- Local State Scanning ---

const scanLocalCards = (mountPoint: string): Map<string, string> => {
	//Returns map of card ID -> updated timestamp string from frontmatter
	const cardsDir = path.join(mountPoint, CARDS_DIR);
	if (!fs.existsSync(cardsDir)) return new Map();

	const localCards = new Map<string, string>();
	const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.md'));

	for (const file of files) {
		const cardId = file.replace(/\.md$/, '');
		const filePath = path.join(cardsDir, file);
		const content = fs.readFileSync(filePath, 'utf-8');

		//Fast frontmatter-only parse: extract updated field
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (fmMatch) {
			const updatedMatch = fmMatch[1].match(/^updated:\s*(.+)$/m);
			if (updatedMatch) {
				localCards.set(cardId, updatedMatch[1].trim());
			} else {
				localCards.set(cardId, '');
			}
		} else {
			localCards.set(cardId, '');
		}
	}

	return localCards;
};

//--- Diff Calculation ---

const formatTimestamp = (ts: FirebaseFirestore.Timestamp): string => {
	if (!ts || !ts.toDate) return '';
	return ts.toDate().toISOString().split('T')[0];
};

const computeDiff = (
	fetchedCards: CardData[],
	localCards: Map<string, string>
): DiffResult => {
	const fetchedIds = new Set(fetchedCards.map(c => c.id));
	const newCards: CardData[] = [];
	const updatedCards: CardData[] = [];
	let unchangedCount = 0;
	let imagesToFetch = 0;

	for (const card of fetchedCards) {
		const localUpdated = localCards.get(card.id);
		if (localUpdated === undefined) {
			//New card
			newCards.push(card);
			if (card.images && card.images.length > 0) imagesToFetch += card.images.length;
		} else {
			const fetchedUpdated = formatTimestamp(card.updated);
			if (fetchedUpdated !== localUpdated) {
				updatedCards.push(card);
				if (card.images && card.images.length > 0) imagesToFetch += card.images.length;
			} else {
				unchangedCount++;
			}
		}
	}

	const removedIds = [...localCards.keys()].filter(id => !fetchedIds.has(id));

	return { newCards, updatedCards, unchangedCount, removedIds, imagesToFetch };
};

//--- Markdown Generation ---

const cardIsPrioritized = (card: CardData): boolean => {
	//Backwards: prioritized === false means IS prioritized
	if (card.auto_todo_overrides && card.auto_todo_overrides.prioritized === false) return true;
	return false;
};

const createTurndownService = (slugIndex: SlugIndex): TurndownService => {
	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
	});

	//Custom rule for <card-link> elements
	td.addRule('cardLink', {
		filter: (node) => {
			return node.nodeName === 'CARD-LINK';
		},
		replacement: (_content, node) => {
			const el = node as HTMLElement;
			const cardId = el.getAttribute('card') || '';
			const href = el.getAttribute('href') || '';
			const text = el.textContent || '';

			if (href) {
				//External link
				return `[${text}](${href})`;
			}

			if (cardId) {
				//Internal card link - resolve to slug for readability
				const slug = slugIndex.get(cardId) || cardId;
				if (text === slug || text === '') {
					return `[[${slug}]]`;
				}
				return `[[${slug}|${text}]]`;
			}

			return text;
		}
	});

	return td;
};

const generateMarkdown = (
	card: CardData,
	tagIndex: TagIndex,
	td: TurndownService
): string => {
	const parts: string[] = [];

	//--- YAML Frontmatter ---
	parts.push('---');
	parts.push(`id: ${card.id}`);
	if (card.name && card.name !== card.id) {
		parts.push(`slug: ${card.name}`);
	}
	if (card.tags && card.tags.length > 0) {
		parts.push('tags:');
		for (const tagId of card.tags) {
			const tagSlug = tagIndex.get(tagId) || tagId;
			parts.push(`  - ${tagSlug}`);
		}
	}
	parts.push(`card_type: ${card.card_type}`);
	parts.push(`created: ${formatTimestamp(card.created)}`);
	parts.push(`updated: ${formatTimestamp(card.updated)}`);
	parts.push(`published: ${card.published}`);
	parts.push(`prioritized: ${cardIsPrioritized(card)}`);
	parts.push('---');
	parts.push('');

	//--- Title ---
	const title = card.title || card.name || card.id;
	parts.push(`# ${title}`);
	parts.push('');

	//--- Images ---
	if (card.images && card.images.length > 0) {
		for (const img of card.images) {
			const filename = imageFilename(img);
			const alt = img.alt || 'image';
			parts.push(`![${alt}](../images/${card.id}/${filename})`);
		}
		parts.push('');
	}

	//--- Body ---
	if (card.body) {
		const bodyMd = td.turndown(card.body);
		if (bodyMd.trim()) {
			parts.push(bodyMd);
			parts.push('');
		}
	}

	//--- Commentary ---
	if (card.commentary) {
		const commentaryMd = td.turndown(card.commentary);
		if (commentaryMd.trim()) {
			parts.push('## Commentary');
			parts.push('');
			parts.push(commentaryMd);
			parts.push('');
		}
	}

	return parts.join('\n');
};

//--- Image Handling ---

const imageFilename = (img: ImageInfo): string => {
	if (img.uploadPath) {
		//uploadPath is like "uploads/<uid>/<filename>"
		return path.basename(img.uploadPath);
	}
	if (img.src) {
		//Extract filename from URL
		try {
			const url = new URL(img.src);
			return path.basename(url.pathname) || 'image';
		} catch {
			return 'image';
		}
	}
	return 'image';
};

const downloadImages = async (
	card: CardData,
	mountPoint: string,
	storageBucket: ReturnType<typeof getStorage>
): Promise<void> => {
	if (!card.images || card.images.length === 0) return;

	const imgDir = path.join(mountPoint, IMAGES_DIR, card.id);
	fs.mkdirSync(imgDir, { recursive: true });

	for (const img of card.images) {
		const filename = imageFilename(img);
		const destPath = path.join(imgDir, filename);

		//Skip if already exists
		if (fs.existsSync(destPath)) continue;

		try {
			if (img.uploadPath) {
				//Download from Firebase Storage
				const bucket = storageBucket.bucket();
				const file = bucket.file(img.uploadPath);
				const [contents] = await file.download();
				fs.writeFileSync(destPath, contents);
				console.log(`  Downloaded: images/${card.id}/${filename}`);
			} else if (img.src) {
				//Download from URL
				const response = await fetch(img.src);
				if (response.ok) {
					const buffer = Buffer.from(await response.arrayBuffer());
					fs.writeFileSync(destPath, buffer);
					console.log(`  Downloaded: images/${card.id}/${filename}`);
				} else {
					console.warn(`  Warning: Failed to download image ${img.src}: ${response.status}`);
				}
			}
		} catch (err) {
			console.warn(`  Warning: Failed to download image for ${card.id}/${filename}: ${err}`);
		}
	}
};

//--- File Writing & Symlink Management ---

const ensureDir = (dirPath: string): void => {
	fs.mkdirSync(dirPath, { recursive: true });
};

const removeSymlinksForCard = (mountPoint: string, cardId: string): void => {
	const filename = cardId + '.md';

	//Remove from tags directories
	const tagsDir = path.join(mountPoint, TAGS_DIR);
	if (fs.existsSync(tagsDir)) {
		for (const tagDir of fs.readdirSync(tagsDir)) {
			const linkPath = path.join(tagsDir, tagDir, filename);
			if (fs.existsSync(linkPath)) {
				fs.unlinkSync(linkPath);
			}
		}
	}

	//Remove from prioritized/unprioritized
	for (const dir of [PRIORITIZED_DIR, UNPRIORITIZED_DIR]) {
		const linkPath = path.join(mountPoint, dir, filename);
		if (fs.existsSync(linkPath)) {
			fs.unlinkSync(linkPath);
		}
	}
};

const createSymlinksForCard = (
	mountPoint: string,
	card: CardData,
	tagIndex: TagIndex
): void => {
	const filename = card.id + '.md';

	//Tag symlinks
	if (card.tags) {
		for (const tagId of card.tags) {
			const tagSlug = tagIndex.get(tagId) || tagId;
			const tagDir = path.join(mountPoint, TAGS_DIR, tagSlug);
			ensureDir(tagDir);
			const linkPath = path.join(tagDir, filename);
			const target = path.join('..', '..', CARDS_DIR, filename);
			if (!fs.existsSync(linkPath)) {
				fs.symlinkSync(target, linkPath);
			}
		}
	}

	//Priority symlinks
	const prioritized = cardIsPrioritized(card);
	const prioDir = prioritized ? PRIORITIZED_DIR : UNPRIORITIZED_DIR;
	ensureDir(path.join(mountPoint, prioDir));
	const linkPath = path.join(mountPoint, prioDir, filename);
	const target = path.join('..', CARDS_DIR, filename);
	if (!fs.existsSync(linkPath)) {
		fs.symlinkSync(target, linkPath);
	}
};

const writeCard = (
	mountPoint: string,
	card: CardData,
	markdown: string,
	tagIndex: TagIndex
): void => {
	const filePath = path.join(mountPoint, CARDS_DIR, card.id + '.md');
	fs.writeFileSync(filePath, markdown);

	//Clean slate: remove existing symlinks, then recreate
	removeSymlinksForCard(mountPoint, card.id);
	createSymlinksForCard(mountPoint, card, tagIndex);
};

const removeCard = (mountPoint: string, cardId: string): void => {
	//Remove markdown file
	const filePath = path.join(mountPoint, CARDS_DIR, cardId + '.md');
	if (fs.existsSync(filePath)) {
		fs.unlinkSync(filePath);
	}

	//Remove symlinks
	removeSymlinksForCard(mountPoint, cardId);

	//Remove images directory
	const imgDir = path.join(mountPoint, IMAGES_DIR, cardId);
	if (fs.existsSync(imgDir)) {
		fs.rmSync(imgDir, { recursive: true, force: true });
	}
};

const cleanEmptyTagDirs = (mountPoint: string): void => {
	const tagsDir = path.join(mountPoint, TAGS_DIR);
	if (!fs.existsSync(tagsDir)) return;

	for (const tagDir of fs.readdirSync(tagsDir)) {
		const dirPath = path.join(tagsDir, tagDir);
		if (fs.statSync(dirPath).isDirectory()) {
			const contents = fs.readdirSync(dirPath);
			if (contents.length === 0) {
				fs.rmdirSync(dirPath);
			}
		}
	}
};

//--- Confirmation Prompt ---

const askConfirmation = async (message: string): Promise<boolean> => {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return new Promise(resolve => {
		rl.question(message, answer => {
			rl.close();
			resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
		});
	});
};

//--- Main ---

const main = async () => {
	const args = parseArgs();
	const mountPoint = path.resolve(args.mountPoint);

	//--- Load or create config ---
	let syncConfig = readSyncConfig(mountPoint);
	const collectionUrl = args.collection || (syncConfig && syncConfig.collectionUrl) || '';

	if (!collectionUrl) {
		console.error('Error: --collection is required on first sync (no .card-web-sync.json found)');
		process.exit(1);
	}

	//--- Determine project ---
	let projectId: string;
	let storageBucket: string;
	if (args.dev) {
		const config = devProdConfig();
		projectId = config.dev.firebase.projectId || '';
		storageBucket = config.dev.firebase.storageBucket || '';
	} else if (syncConfig && syncConfig.projectId) {
		projectId = syncConfig.projectId;
		//Derive storage bucket from project ID (standard Firebase convention)
		storageBucket = projectId + '.appspot.com';
	} else {
		try {
			projectId = await selectedProjectID();
		} catch {
			console.error('Error: Could not determine Firebase project. Run `firebase use <project>` or pass --dev');
			process.exit(1);
		}
		const config = devProdConfig();
		if (config.prod.firebase.projectId === projectId) {
			storageBucket = config.prod.firebase.storageBucket || projectId + '.appspot.com';
		} else if (config.dev.firebase.projectId === projectId) {
			storageBucket = config.dev.firebase.storageBucket || projectId + '.appspot.com';
		} else {
			storageBucket = projectId + '.appspot.com';
		}
	}

	console.log(`Card-web mount sync: ${collectionUrl}`);
	console.log(`Project: ${projectId}`);
	console.log('');

	//--- Initialize Firebase Admin ---
	const { db, storage } = initFirebase(projectId, storageBucket);

	//--- Fetch tag index first (needed for filter parsing) ---
	console.log('Fetching tags...');
	const tagIndex = await fetchTagIndex(db);
	console.log(`  Found ${tagIndex.size} tags`);

	//Build set of valid tag slugs for filter classification
	const validTagSlugs = new Set(tagIndex.values());

	//--- Parse collection filters ---
	const parsedCollection = parseCollectionFilters(collectionUrl, validTagSlugs);

	//--- Fetch cards ---
	console.log('Fetching cards...');
	const cards = await fetchCards(db, parsedCollection, tagIndex);
	console.log(`  Fetched ${cards.length} cards`);

	//--- Fetch slug index (for wiki-link resolution) ---
	console.log('Fetching slug index...');
	const slugIndex = await fetchSlugIndex(db);
	console.log(`  Indexed ${slugIndex.size} card slugs`);
	console.log('');

	//--- Scan local state ---
	const localCards = scanLocalCards(mountPoint);

	//--- Compute diff ---
	const diff = computeDiff(cards, localCards);

	//--- Show dry-run summary ---
	const totalFilesToWrite = diff.newCards.length + diff.updatedCards.length;

	console.log(`  New cards:        ${diff.newCards.length}`);
	console.log(`  Updated cards:    ${diff.updatedCards.length}  (modified since last sync)`);
	console.log(`  Unchanged:        ${diff.unchangedCount}  (skipping)`);
	console.log(`  Removed:          ${diff.removedIds.length}  (no longer in collection)`);
	console.log(`  Images to fetch:  ${diff.imagesToFetch}`);
	console.log('');
	console.log(`  Total files to write: ${totalFilesToWrite}`);

	if (totalFilesToWrite === 0 && diff.removedIds.length === 0) {
		console.log('\nNothing to do — everything is up to date.');
		process.exit(0);
	}

	if (args.dryRun) {
		console.log('\n(Dry run — no changes written)');
		process.exit(0);
	}

	if (!args.force) {
		console.log('');
		const confirmed = await askConfirmation('  Proceed? [y/N] ');
		if (!confirmed) {
			console.log('Aborted.');
			process.exit(0);
		}
	}

	//--- Execute sync ---

	//Ensure directories exist
	ensureDir(path.join(mountPoint, CARDS_DIR));
	ensureDir(path.join(mountPoint, IMAGES_DIR));

	//Create turndown service
	const td = createTurndownService(slugIndex);

	//Write new and updated cards
	const cardsToWrite = [...diff.newCards, ...diff.updatedCards];
	let written = 0;
	for (const card of cardsToWrite) {
		written++;
		const markdown = generateMarkdown(card, tagIndex, td);
		writeCard(mountPoint, card, markdown, tagIndex);

		//Download images
		await downloadImages(card, mountPoint, storage);

		if (written % 10 === 0 || written === cardsToWrite.length) {
			console.log(`  Written ${written}/${cardsToWrite.length} cards`);
		}
	}

	//Remove deleted cards
	for (const cardId of diff.removedIds) {
		removeCard(mountPoint, cardId);
		console.log(`  Removed: ${cardId}`);
	}

	//Clean up empty tag directories
	cleanEmptyTagDirs(mountPoint);

	//--- Write sync config ---
	writeSyncConfig(mountPoint, {
		collectionUrl,
		projectId,
	});

	console.log('\nSync complete.');
};

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
