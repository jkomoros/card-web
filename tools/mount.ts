import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';
import * as readline from 'readline';

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import snarkdown from 'snarkdown';
import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

import { overrideDocument } from '../shared/document.js';

import {
	normalizeBodyHTMLString,
	replaceAnchorsWithCardLinks,
} from '../shared/util.js';

import {
	deserializeCollectionURL
} from '../shared/collection_description_base.js';

import {
	CARDS_COLLECTION,
	TAGS_COLLECTION,
	CARD_UPDATES_COLLECTION,
	TAG_UPDATES_COLLECTION,
} from '../shared/collection-constants.js';

import {
	ImageInfo,
	Card,
	CardDiff,
	CardID,
} from '../shared/types.js';

import {
	applyCardDiff,
	applyCardFirebaseUpdate,
	inboundLinksUpdates,
	CardUpdate,
	SentinelConfig,
} from '../shared/card_write.js';

import {
	MultiBatchBase,
	MultiBatchConfig,
} from '../shared/multi_batch.js';

import {
	selectedProjectID,
	devProdConfig,
} from './util.js';

//--- JSDOM setup for shared utilities ---
const dom = new JSDOM('');
overrideDocument(dom.window.document);

//--- Types ---

interface CardSyncState {
	hash: string;
	remoteUpdated: string;
}

interface SyncConfig {
	collectionUrl: string;
	projectId: string;
	cards?: Record<string, CardSyncState>;
}

interface DiffResult {
	newCards: Card[];
	updatedCards: Card[];
	unchangedCount: number;
	removedIds: string[];
	imagesToFetch: number;
}

//Map of tag card ID -> tag slug/name for directory names
type TagIndex = Map<string, string>;

//--- Constants ---

const SYNC_CONFIG_FILE = '.card-web-sync.json';
const CARDS_DIR = 'cards';
const IMAGES_DIR = 'images';
const TAGS_DIR = 'tags';
const PRIORITIZED_DIR = 'prioritized';
const UNPRIORITIZED_DIR = 'unprioritized';

const BLOCK_TAG_REGEX = /^<(p|ul|ol|h[1-4]|blockquote)[\s>]/;

//Filters we know how to convert to Firestore constraints
const KNOWN_FILTERS: Record<string, boolean> = {
	'published': true,
	'unpublished': true,
};

//--- Hash Utilities ---

const computeContentHash = (content: string): string => {
	return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
};

//--- CLI Argument Parsing ---

interface CLIArgs {
	mountPoint: string;
	collection: string;
	dryRun: boolean;
	force: boolean;
	dev: boolean;
	push: boolean;
}

const parseArgs = (): CLIArgs => {
	const args = process.argv.slice(2);
	const result: CLIArgs = {
		mountPoint: '',
		collection: '',
		dryRun: false,
		force: false,
		dev: false,
		push: false,
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
		} else if (arg === '--push') {
			result.push = true;
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
  --push                   Enable two-way sync (push local edits to Firestore)
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
): Promise<Card[]> => {
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
	} as Card));

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

const formatTimestamp = (ts: { toDate(): Date } | null | undefined): string => {
	if (!ts || !ts.toDate) return '';
	return ts.toDate().toISOString();
};

const computeDiff = (
	fetchedCards: Card[],
	localCards: Map<string, string>
): DiffResult => {
	const fetchedIds = new Set(fetchedCards.map(c => c.id));
	const newCards: Card[] = [];
	const updatedCards: Card[] = [];
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

//--- Bidirectional Diff (for --push mode) ---

interface LocalEdit {
	cardId: string;
	localContent: string;
	remoteCard: Card;
}

interface ConflictCard {
	cardId: string;
	localContent: string;
	remoteCard: Card;
}

interface BidirectionalDiffResult {
	unchanged: string[];
	remoteOnly: Card[];      // pull from Firestore
	localOnly: LocalEdit[];      // push to Firestore
	conflicts: ConflictCard[];   // both changed
	newRemote: Card[];       // new cards in Firestore, no local file
	removedRemote: string[];     // local file exists, card gone from collection
}

const computeBidirectionalDiff = (
	fetchedCards: Card[],
	mountPoint: string,
	syncConfig: SyncConfig | null,
): BidirectionalDiffResult => {
	const result: BidirectionalDiffResult = {
		unchanged: [],
		remoteOnly: [],
		localOnly: [],
		conflicts: [],
		newRemote: [],
		removedRemote: [],
	};

	const savedCards = (syncConfig && syncConfig.cards) || {};
	const fetchedById = new Map(fetchedCards.map(c => [c.id, c]));

	//Collect local card IDs from files on disk
	const cardsDir = path.join(mountPoint, CARDS_DIR);
	const localCardIds = new Set<string>();
	if (fs.existsSync(cardsDir)) {
		for (const file of fs.readdirSync(cardsDir).filter(f => f.endsWith('.md'))) {
			localCardIds.add(file.replace(/\.md$/, ''));
		}
	}

	//Classify each fetched card
	for (const card of fetchedCards) {
		const savedState = savedCards[card.id];

		if (!localCardIds.has(card.id)) {
			//No local file — new from remote
			result.newRemote.push(card);
			continue;
		}

		if (!savedState) {
			//Local file exists but no tracking state — treat as remote-only
			//(first time syncing with hash tracking, or manually added file)
			result.remoteOnly.push(card);
			continue;
		}

		//Read local file and compute current hash
		const filePath = path.join(cardsDir, card.id + '.md');
		const localContent = fs.readFileSync(filePath, 'utf-8');
		const localHash = computeContentHash(localContent);

		const localChanged = localHash !== savedState.hash;
		const currentRemoteTimestamp = formatTimestamp(card.updated);
		//Check if the remote timestamp has changed. Use startsWith for
		//backwards compatibility: old sync state files stored date-only
		//"YYYY-MM-DD" which is a prefix of the full ISO timestamp now used.
		const remoteChanged = currentRemoteTimestamp !== savedState.remoteUpdated
			&& !(savedState.remoteUpdated && currentRemoteTimestamp.startsWith(savedState.remoteUpdated));

		if (!localChanged && !remoteChanged) {
			result.unchanged.push(card.id);
		} else if (!localChanged && remoteChanged) {
			result.remoteOnly.push(card);
		} else if (localChanged && !remoteChanged) {
			result.localOnly.push({
				cardId: card.id,
				localContent,
				remoteCard: card,
			});
		} else {
			//Both changed — conflict
			result.conflicts.push({
				cardId: card.id,
				localContent,
				remoteCard: card,
			});
		}
	}

	//Check for local files whose cards have been removed from the collection
	for (const cardId of localCardIds) {
		if (!fetchedById.has(cardId)) {
			result.removedRemote.push(cardId);
		}
	}

	return result;
};

//--- Firestore Write Path (for --push mode) ---

//Admin SDK MultiBatch: wraps MultiBatchBase with admin SDK batch ops
const createAdminMultiBatch = (db: FirebaseFirestore.Firestore) => {
	const config: MultiBatchConfig<FirebaseFirestore.WriteBatch, FirebaseFirestore.DocumentReference> = {
		createBatch: () => db.batch(),
		batchSet: (batch, ref, data, options?) => {
			if (options) {
				batch.set(ref, data, options as FirebaseFirestore.SetOptions);
			} else {
				batch.set(ref, data);
			}
		},
		batchUpdate: (batch, ref, data) => batch.update(ref, data),
		batchDelete: (batch, ref) => batch.delete(ref),
		commitBatch: (batch) => batch.commit().then(() => {}),
		//Admin SDK: conservative estimate — count every op as 2 to stay safe
		writeCountForUpdate: () => 2,
	};
	return new MultiBatchBase(config);
};

//Build a CardDiff from parsed local markdown vs the remote Firestore card
const buildCardDiffFromLocal = (
	parsed: ParsedMarkdownFile,
	remoteCard: Card,
	tagIndex: TagIndex,
): CardDiff => {
	const diff: CardDiff = {};

	//Title
	if (parsed.title && parsed.title !== (remoteCard.title || remoteCard.name || remoteCard.id)) {
		diff.title = parsed.title;
	}

	//Body (markdown → HTML)
	const newBody = markdownToHTML(parsed.body);
	if (newBody !== remoteCard.body) {
		diff.body = newBody;
	}

	//Commentary (markdown → HTML)
	const newCommentary = markdownToHTML(parsed.commentary);
	if (newCommentary !== remoteCard.commentary) {
		diff.commentary = newCommentary;
	}

	//Published
	if (parsed.frontmatter.published !== undefined) {
		const newPublished = !!parsed.frontmatter.published;
		if (newPublished !== remoteCard.published) {
			diff.published = newPublished;
		}
	}

	//Tags (compare tag slugs → tag IDs)
	if (Array.isArray(parsed.frontmatter.tags)) {
		const localTagSlugs = parsed.frontmatter.tags as string[];
		//Resolve slug → tag ID using tagIndex (tag IDs are the slugs in this system)
		const localTagIds = new Set(localTagSlugs.map(slug => {
			//In this system, tag doc IDs are the slugs
			for (const [id, tagSlug] of tagIndex.entries()) {
				if (tagSlug === slug) return id;
			}
			return slug; //fallback: use slug directly as ID
		}));
		const remoteTagIds = new Set(remoteCard.tags || []);

		const addTags = [...localTagIds].filter(id => !remoteTagIds.has(id));
		const removeTags = [...remoteTagIds].filter(id => !localTagIds.has(id));

		if (addTags.length > 0) diff.add_tags = addTags;
		if (removeTags.length > 0) diff.remove_tags = removeTags;
	}

	//Prioritized → auto_todo_overrides
	if (parsed.frontmatter.prioritized !== undefined) {
		const localPrioritized = !!parsed.frontmatter.prioritized;
		const remotePrioritized = cardIsPrioritized(remoteCard);

		if (localPrioritized !== remotePrioritized) {
			if (localPrioritized) {
				//Turn on prioritized: set auto_todo_overrides.prioritized = false
				//(backwards: prioritized === false means IS prioritized)
				diff.auto_todo_overrides_disablements = ['prioritized'];
			} else {
				//Turn off prioritized: remove the override
				diff.auto_todo_overrides_removals = ['prioritized'];
			}
		}
	}

	return diff;
};

//Validate that all card-link references in HTML point to existing cards
const validateCardLinks = async (
	html: string,
	existingCardIds: Set<string>,
	db: FirebaseFirestore.Firestore,
): Promise<string[]> => {
	const errors: string[] = [];
	const linkRegex = /<card-link\s+card="([^"]+)">/g;
	let match;
	while ((match = linkRegex.exec(html)) !== null) {
		const cardId = match[1];
		if (!existingCardIds.has(cardId)) {
			//Check Firestore for out-of-collection cards
			const doc = await db.collection(CARDS_COLLECTION).doc(cardId).get();
			if (!doc.exists) {
				errors.push(`References non-existent card: ${cardId}`);
			}
		}
	}
	return errors;
};

//Push a single local edit to Firestore
const pushCardToFirestore = async (
	db: FirebaseFirestore.Firestore,
	edit: LocalEdit,
	tagIndex: TagIndex,
	existingCardIds: Set<string>,
	allCards: Map<string, Card>,
	batch: MultiBatchBase<FirebaseFirestore.WriteBatch, FirebaseFirestore.DocumentReference>,
	dryRun: boolean,
): Promise<{ success: boolean; description: string; noop?: boolean }> => {
	const { cardId, localContent, remoteCard } = edit;

	//Parse local markdown
	const parsed = parseMarkdownFile(localContent);

	//Build diff
	const diff = buildCardDiffFromLocal(parsed, remoteCard, tagIndex);

	if (Object.keys(diff).length === 0) {
		return { success: true, description: 'No changes detected', noop: true };
	}

	//Validate card links in body and commentary
	const newBody = diff.body || remoteCard.body;
	const newCommentary = diff.commentary || remoteCard.commentary || '';
	const linkErrors = [
		...(await validateCardLinks(newBody, existingCardIds, db)),
		...(await validateCardLinks(newCommentary, existingCardIds, db)),
	];
	if (linkErrors.length > 0) {
		return { success: false, description: `Invalid card links: ${linkErrors.join(', ')}` };
	}

	//Build description of changes
	const changedFields = Object.keys(diff).join(', ');
	const description = `Updated: ${changedFields}`;

	if (dryRun) {
		return { success: true, description };
	}

	const deleteFieldSentinel = FirebaseFirestore.FieldValue.delete();
	const cardUpdate: CardUpdate = applyCardDiff(remoteCard, diff, deleteFieldSentinel);

	//Add updated timestamp
	cardUpdate.updated = FirebaseFirestore.FieldValue.serverTimestamp();

	//Check if this is a substantive change (body or title changed)
	const substantive = !!(diff.body || diff.title || diff.commentary);
	if (substantive) {
		cardUpdate.updated_substantive = FirebaseFirestore.FieldValue.serverTimestamp();
	}

	//Build admin SDK sentinel config for resolving FieldValue sentinels.
	//We use FieldValue.isEqual() rather than JSON.stringify because the
	//admin SDK serializes both delete() and serverTimestamp() to "{}".
	const serverTimestampSentinel = FirebaseFirestore.FieldValue.serverTimestamp();
	const adminSentinels: SentinelConfig = {
		deleteField: () => deleteFieldSentinel,
		isDeleteSentinel: (val) => val instanceof FirebaseFirestore.FieldValue && val.isEqual(deleteFieldSentinel),
		isServerTimestampSentinel: (val) => val instanceof FirebaseFirestore.FieldValue && val.isEqual(serverTimestampSentinel),
		currentTimestamp: () => FirebaseFirestore.Timestamp.now(),
	};

	//Compute inbound reference updates and validate BEFORE adding anything
	//to the batch. If we added card ops first and then failed here, the
	//batch would commit partial operations (card updated but inbound links
	//not), creating the inconsistency described in issue #726.
	const updatedCard = applyCardFirebaseUpdate(remoteCard, cardUpdate, adminSentinels);
	const inboundUpdates = inboundLinksUpdates(cardId as CardID, remoteCard, updatedCard, deleteFieldSentinel);
	for (const [otherCardId] of Object.entries(inboundUpdates)) {
		if (!allCards.has(otherCardId)) {
			//Card not in our collection — verify it exists in Firestore
			const otherRef = db.collection(CARDS_COLLECTION).doc(otherCardId);
			const otherDoc = await otherRef.get();
			if (!otherDoc.exists) {
				return { success: false, description: `References non-existent card: ${otherCardId}` };
			}
		}
	}

	//All validation passed — now add everything to the batch atomically
	const cardRef = db.collection(CARDS_COLLECTION).doc(cardId);
	batch.update(cardRef, cardUpdate);

	//Write audit log entry
	const updateRef = cardRef.collection(CARD_UPDATES_COLLECTION).doc(`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
	batch.set(updateRef, {
		...cardUpdate,
		batch: batch.batchID || '',
		substantive,
		timestamp: FirebaseFirestore.FieldValue.serverTimestamp(),
	});

	//Apply inbound reference updates (already validated above)
	for (const [otherCardId, otherCardUpdate] of Object.entries(inboundUpdates)) {
		const otherRef = db.collection(CARDS_COLLECTION).doc(otherCardId);
		batch.update(otherRef, otherCardUpdate);
	}

	//Handle tag membership changes
	if (diff.add_tags && diff.add_tags.length > 0) {
		for (const tagId of diff.add_tags) {
			const tagRef = db.collection(TAGS_COLLECTION).doc(tagId);
			const tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc(`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
			batch.update(tagRef, {
				cards: FirebaseFirestore.FieldValue.arrayUnion(cardId),
				updated: FirebaseFirestore.FieldValue.serverTimestamp(),
			});
			batch.set(tagUpdateRef, {
				timestamp: FirebaseFirestore.FieldValue.serverTimestamp(),
				add_card: cardId,
			});
		}
	}

	if (diff.remove_tags && diff.remove_tags.length > 0) {
		for (const tagId of diff.remove_tags) {
			const tagRef = db.collection(TAGS_COLLECTION).doc(tagId);
			const tagUpdateRef = tagRef.collection(TAG_UPDATES_COLLECTION).doc(`${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
			batch.update(tagRef, {
				cards: FirebaseFirestore.FieldValue.arrayRemove(cardId),
				updated: FirebaseFirestore.FieldValue.serverTimestamp(),
			});
			batch.set(tagUpdateRef, {
				timestamp: FirebaseFirestore.FieldValue.serverTimestamp(),
				remove_card: cardId,
			});
		}
	}

	return { success: true, description };
};

//--- Conflict Resolution UI ---

type ConflictResolution = 'keep-local' | 'keep-remote' | 'skip';

const resolveConflict = async (
	conflict: ConflictCard,
	tagIndex: TagIndex,
	td: TurndownService,
	rl: readline.Interface,
): Promise<ConflictResolution> => {
	const { cardId, remoteCard } = conflict;
	const title = remoteCard.title || remoteCard.name || cardId;
	const remoteUpdated = formatTimestamp(remoteCard.updated);

	console.log('');
	console.log(`--- Conflict: ${cardId} "${title}" ---`);
	console.log('');
	console.log(`  Remote updated: ${remoteUpdated}`);
	console.log('  Both the local file and the remote card have changed since last sync.');
	console.log('');

	//Show a brief summary of what changed locally
	const parsed = parseMarkdownFile(conflict.localContent);
	const localBody = markdownToHTML(parsed.body);
	const localCommentary = markdownToHTML(parsed.commentary);

	const localChanges: string[] = [];
	if (parsed.title !== (remoteCard.title || remoteCard.name || remoteCard.id)) localChanges.push('title');
	if (localBody !== remoteCard.body) localChanges.push('body');
	if (localCommentary !== remoteCard.commentary) localChanges.push('commentary');
	if (parsed.frontmatter.published !== remoteCard.published) localChanges.push('published');

	const remoteMarkdown = generateMarkdown(remoteCard, tagIndex, td);
	const remoteChanges: string[] = [];
	remoteChanges.push('(unknown — remote updated since last sync)');

	if (localChanges.length > 0) {
		console.log(`  Local changes: ${localChanges.join(', ')}`);
	} else {
		console.log('  Local changes: (metadata or formatting only)');
	}
	console.log(`  Remote changes: ${remoteChanges.join(', ')}`);
	console.log('');
	console.log('  [1] Keep local  (push to Firestore, overwrite remote)');
	console.log('  [2] Keep remote (overwrite local file)');
	console.log('  [3] Skip        (leave both as-is for now)');

	//Suppress unused variable warning - remoteMarkdown will be used for
	//future diff display but is generated here for the comparison above
	void remoteMarkdown;

	return new Promise<ConflictResolution>(resolve => {
		const ask = () => {
			rl.question('  Choice [1/2/3]: ', answer => {
				const trimmed = answer.trim();
				if (trimmed === '1') {
					resolve('keep-local');
				} else if (trimmed === '2') {
					resolve('keep-remote');
				} else if (trimmed === '3') {
					resolve('skip');
				} else {
					console.log('  Please enter 1, 2, or 3.');
					ask();
				}
			});
		};
		ask();
	});
};

//--- Markdown Parsing (for push: local .md → structured data) ---

interface ParsedMarkdownFile {
	frontmatter: Record<string, unknown>;
	title: string;
	body: string;
	commentary: string;
}

const parseMarkdownFile = (content: string): ParsedMarkdownFile => {
	const result: ParsedMarkdownFile = {
		frontmatter: {},
		title: '',
		body: '',
		commentary: '',
	};

	let remaining = content;

	//Extract YAML frontmatter between --- markers
	const fmMatch = remaining.match(/^---\n([\s\S]*?)\n---\n?/);
	if (fmMatch) {
		remaining = remaining.slice(fmMatch[0].length);
		//Simple YAML parser for our known frontmatter format
		const lines = fmMatch[1].split('\n');
		let currentKey = '';
		let currentArray: string[] | null = null;
		for (const line of lines) {
			const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
			if (kvMatch) {
				if (currentArray && currentKey) {
					result.frontmatter[currentKey] = currentArray;
				}
				currentKey = kvMatch[1];
				const value = kvMatch[2].trim();
				if (value === '') {
					//Could be a list that follows
					currentArray = [];
				} else {
					currentArray = null;
					//Parse booleans and numbers
					if (value === 'true') result.frontmatter[currentKey] = true;
					else if (value === 'false') result.frontmatter[currentKey] = false;
					else if (/^\d+(\.\d+)?$/.test(value)) result.frontmatter[currentKey] = Number(value);
					else result.frontmatter[currentKey] = value;
				}
			} else if (currentArray !== null) {
				const itemMatch = line.match(/^\s+-\s+(.+)$/);
				if (itemMatch) {
					currentArray.push(itemMatch[1].trim());
				}
			}
		}
		if (currentArray && currentKey) {
			result.frontmatter[currentKey] = currentArray;
		}
	}

	//Extract title from # heading
	const titleMatch = remaining.match(/^#\s+(.+)\n?/m);
	if (titleMatch) {
		result.title = titleMatch[1].trim();
		remaining = remaining.slice(remaining.indexOf(titleMatch[0]) + titleMatch[0].length);
	}

	//Strip leading/trailing whitespace
	remaining = remaining.trim();

	//Split on ## Commentary
	const commentaryIndex = remaining.indexOf('## Commentary');
	if (commentaryIndex !== -1) {
		result.body = remaining.slice(0, commentaryIndex).trim();
		result.commentary = remaining.slice(commentaryIndex + '## Commentary'.length).trim();
	} else {
		result.body = remaining;
	}

	return result;
};

const markdownToHTML = (markdown: string): string => {
	if (!markdown) return '';

	// Step 1: Wiki-link replacement (pass through snarkdown as inline HTML)
	let html = markdown.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g,
		(_match, cardId, text) => `<card-link card="${cardId}">${text}</card-link>`
	);
	html = html.replace(/\[\[([^\]]+)\]\]/g,
		(_match, cardId) => `<card-link card="${cardId}">${cardId}</card-link>`
	);

	// Step 2: Paragraph split + snarkdown
	const paragraphs = html.split(/\n\n+/).filter(p => p.trim());
	const converted = paragraphs.map(p => {
		const trimmed = p.trim();
		if (BLOCK_TAG_REGEX.test(trimmed)) return trimmed;
		const result = snarkdown(trimmed);
		if (BLOCK_TAG_REGEX.test(result)) return result;
		return `<p>${result}</p>`;
	});
	let result = converted.join('');

	// Step 3: Post-snarkdown unescape
	// MUST be after snarkdown: snarkdown detects \* as escaped (skips
	// formatting) but leaves backslash in output. We clean it up here.
	result = result.replace(/\\([\\*_`~\[\]#>+\-.=])/g, '$1');

	// Step 4: Convert <a href> to canonical <card-link> (shared)
	result = replaceAnchorsWithCardLinks(result);

	// Step 5: Canonical normalization (shared)
	result = normalizeBodyHTMLString(result);

	return result;
};

//--- Markdown Generation ---

const cardIsPrioritized = (card: Card): boolean => {
	//Backwards: prioritized === false means IS prioritized
	if (card.auto_todo_overrides && card.auto_todo_overrides.prioritized === false) return true;
	return false;
};

const createTurndownService = (): TurndownService => {
	const td = new TurndownService({
		headingStyle: 'atx',
		codeBlockStyle: 'fenced',
		emDelimiter: '*',
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
				//Internal card link - use card ID directly for round-trip fidelity
				if (text === cardId || text === '') {
					return `[[${cardId}]]`;
				}
				return `[[${cardId}|${text}]]`;
			}

			return text;
		}
	});

	return td;
};

const generateMarkdown = (
	card: Card,
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
	card: Card,
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
	card: Card,
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
	card: Card,
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

	console.log('');

	//Ensure directories exist
	ensureDir(path.join(mountPoint, CARDS_DIR));
	ensureDir(path.join(mountPoint, IMAGES_DIR));

	//Create turndown service
	const td = createTurndownService();

	//Build card sync state from existing config (preserving unchanged cards)
	const cardsSyncState: Record<string, CardSyncState> = {
		...(syncConfig && syncConfig.cards || {}),
	};

	//Build lookup maps for the fetched cards
	const allCardsMap = new Map(cards.map(c => [c.id, c]));
	const existingCardIds = new Set(cards.map(c => c.id));

	if (args.push) {
		//--- Two-way sync (--push mode) ---
		const biDiff = computeBidirectionalDiff(cards, mountPoint, syncConfig);

		console.log(`  Push (local→remote): ${biDiff.localOnly.length}`);
		console.log(`  Pull (remote→local): ${biDiff.remoteOnly.length}`);
		console.log(`  New remote:          ${biDiff.newRemote.length}`);
		console.log(`  Conflicts:           ${biDiff.conflicts.length}`);
		console.log(`  Removed remote:      ${biDiff.removedRemote.length}`);
		console.log(`  Unchanged:           ${biDiff.unchanged.length}`);

		const totalActions = biDiff.localOnly.length + biDiff.remoteOnly.length +
			biDiff.newRemote.length + biDiff.conflicts.length + biDiff.removedRemote.length;

		if (totalActions === 0) {
			console.log('\nNothing to do — everything is up to date.');
			process.exit(0);
		}

		if (args.dryRun) {
			if (biDiff.localOnly.length > 0) {
				console.log('\n  Cards to push:');
				for (const edit of biDiff.localOnly) {
					console.log(`    ${edit.cardId}`);
				}
			}
			if (biDiff.conflicts.length > 0) {
				console.log('\n  Conflicting cards:');
				for (const conflict of biDiff.conflicts) {
					console.log(`    ${conflict.cardId}`);
				}
			}
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

		//--- Resolve conflicts ---
		const pushEdits: LocalEdit[] = [...biDiff.localOnly];
		const pullCards: Card[] = [...biDiff.remoteOnly, ...biDiff.newRemote];

		if (biDiff.conflicts.length > 0) {
			const rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			for (const conflict of biDiff.conflicts) {
				const resolution = await resolveConflict(conflict, tagIndex, td, rl);
				if (resolution === 'keep-local') {
					pushEdits.push({
						cardId: conflict.cardId,
						localContent: conflict.localContent,
						remoteCard: conflict.remoteCard,
					});
				} else if (resolution === 'keep-remote') {
					pullCards.push(conflict.remoteCard);
				}
				//skip: do nothing
			}
			rl.close();
		}

		//--- Push local edits to Firestore ---
		if (pushEdits.length > 0) {
			console.log(`\nPushing ${pushEdits.length} cards to Firestore...`);
			const batch = createAdminMultiBatch(db);
			let pushSuccess = 0;
			let pushFailed = 0;
			const successfulEdits: LocalEdit[] = [];

			for (const edit of pushEdits) {
				const result = await pushCardToFirestore(
					db, edit, tagIndex, existingCardIds, allCardsMap, batch, false
				);
				if (result.success) {
					console.log(`  Pushed: ${edit.cardId} — ${result.description}`);
					if (!result.noop) {
						pushSuccess++;
						successfulEdits.push(edit);
					}
				} else {
					console.error(`  FAILED: ${edit.cardId} — ${result.description}`);
					pushFailed++;
				}
			}

			if (pushSuccess > 0) {
				console.log('  Committing batch...');
				try {
					await batch.commit();
					console.log(`  Pushed ${pushSuccess} cards.`);

					//Re-fetch pushed cards to get actual server timestamps
					for (const edit of successfulEdits) {
						try {
							const freshDoc = await db.collection(CARDS_COLLECTION).doc(edit.cardId).get();
							const freshData = freshDoc.data();
							//Hash from disk to account for OS line-ending normalization
							const filePath = path.join(mountPoint, CARDS_DIR, edit.cardId + '.md');
							const onDiskContent = fs.readFileSync(filePath, 'utf-8');
							cardsSyncState[edit.cardId] = {
								hash: computeContentHash(onDiskContent),
								remoteUpdated: freshData?.updated ? formatTimestamp(freshData.updated as FirebaseFirestore.Timestamp) : '',
							};
						} catch (refetchErr) {
							console.warn(`  Warning: Could not re-fetch ${edit.cardId}: ${refetchErr}`);
							//Leave sync state unset — card will be re-examined next sync
						}
					}
				} catch (err) {
					console.error(`  Batch commit failed: ${err}`);
					console.error('  Sync state for pushed cards will not be updated.');
					//Do NOT update cardsSyncState for pushed cards — commit failed
				}
			}
			if (pushFailed > 0) {
				console.warn(`  ${pushFailed} cards failed to push.`);
			}
		}

		//--- Pull remote cards ---
		if (pullCards.length > 0) {
			console.log(`\nPulling ${pullCards.length} cards from Firestore...`);
			let pulled = 0;
			for (const card of pullCards) {
				pulled++;
				const markdown = generateMarkdown(card, tagIndex, td);
				writeCard(mountPoint, card, markdown, tagIndex);

				//Hash from disk to account for OS line-ending normalization
				const filePath = path.join(mountPoint, CARDS_DIR, card.id + '.md');
				const onDiskContent = fs.readFileSync(filePath, 'utf-8');
				cardsSyncState[card.id] = {
					hash: computeContentHash(onDiskContent),
					remoteUpdated: formatTimestamp(card.updated),
				};

				await downloadImages(card, mountPoint, storage);

				if (pulled % 10 === 0 || pulled === pullCards.length) {
					console.log(`  Pulled ${pulled}/${pullCards.length} cards`);
				}
			}
		}

		//--- Remove cards that are no longer in the collection ---
		for (const cardId of biDiff.removedRemote) {
			removeCard(mountPoint, cardId);
			delete cardsSyncState[cardId];
			console.log(`  Removed: ${cardId}`);
		}

		//Update hashes for unchanged cards not yet tracked
		for (const cardId of biDiff.unchanged) {
			if (cardsSyncState[cardId]) continue;
			const card = allCardsMap.get(cardId);
			if (!card) continue;
			const filePath = path.join(mountPoint, CARDS_DIR, cardId + '.md');
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, 'utf-8');
				cardsSyncState[cardId] = {
					hash: computeContentHash(content),
					remoteUpdated: formatTimestamp(card.updated),
				};
			}
		}

	} else {
		//--- Pull-only sync (default, original behavior) ---
		const localCards = scanLocalCards(mountPoint);
		const diff = computeDiff(cards, localCards);

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

		//Write new and updated cards
		const cardsToWrite = [...diff.newCards, ...diff.updatedCards];
		let written = 0;
		for (const card of cardsToWrite) {
			written++;
			const markdown = generateMarkdown(card, tagIndex, td);
			writeCard(mountPoint, card, markdown, tagIndex);

			//Hash from disk to account for OS line-ending normalization
			const filePath = path.join(mountPoint, CARDS_DIR, card.id + '.md');
			const onDiskContent = fs.readFileSync(filePath, 'utf-8');
			cardsSyncState[card.id] = {
				hash: computeContentHash(onDiskContent),
				remoteUpdated: formatTimestamp(card.updated),
			};

			await downloadImages(card, mountPoint, storage);

			if (written % 10 === 0 || written === cardsToWrite.length) {
				console.log(`  Written ${written}/${cardsToWrite.length} cards`);
			}
		}

		//Remove deleted cards
		for (const cardId of diff.removedIds) {
			removeCard(mountPoint, cardId);
			delete cardsSyncState[cardId];
			console.log(`  Removed: ${cardId}`);
		}

		//Update hashes for unchanged cards not yet tracked
		for (const card of cards) {
			if (cardsSyncState[card.id]) continue;
			const filePath = path.join(mountPoint, CARDS_DIR, card.id + '.md');
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, 'utf-8');
				cardsSyncState[card.id] = {
					hash: computeContentHash(content),
					remoteUpdated: formatTimestamp(card.updated),
				};
			}
		}
	}

	//Clean up empty tag directories
	cleanEmptyTagDirs(mountPoint);

	//--- Write sync config ---
	writeSyncConfig(mountPoint, {
		collectionUrl,
		projectId,
		cards: cardsSyncState,
	});

	console.log('\nSync complete.');
};

main().catch(err => {
	console.error('Fatal error:', err);
	process.exit(1);
});
