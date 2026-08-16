import * as fs from 'fs';
import * as path from 'path';
import * as process from 'process';

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { JSDOM } from 'jsdom';

import { overrideDocument } from '../shared/document.js';

import {
	deserializeCollectionURL,
} from '../shared/collection_description_base.js';

import {
	CARDS_COLLECTION,
	TAGS_COLLECTION,
} from '../shared/collection-constants.js';

import {
	Card,
	ImageInfo,
} from '../shared/types.js';

import {
	devProdConfig,
	selectedProjectID,
} from './util.js';

const dom = new JSDOM('');
overrideDocument(dom.window.document);

interface CLIArgs {
	output: string;
	imagesDir: string;
	collection: string;
	dev: boolean;
	prod: boolean;
}

const parseArgs = (): CLIArgs => {
	const args = process.argv.slice(2);
	const result: CLIArgs = {
		output: '',
		imagesDir: '',
		collection: '',
		dev: false,
		prod: false,
	};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === '--output' && i + 1 < args.length) {
			result.output = args[++i];
		} else if (arg === '--images-dir' && i + 1 < args.length) {
			result.imagesDir = args[++i];
		} else if (arg === '--collection' && i + 1 < args.length) {
			result.collection = args[++i];
		} else if (arg === '--dev') {
			result.dev = true;
		} else if (arg === '--prod') {
			result.prod = true;
		}
	}

	if (!result.output || !result.imagesDir || !result.collection) {
		console.error(`Usage: npx tsx tools/dump.ts --output <file.ndjson> --images-dir <dir> --collection <url> [--dev|--prod]

Dump every card in the given collection to NDJSON. Each line is a JSON record:
the first line is a manifest (collection, project, dumped_at, tag index); each
subsequent line is one card, with raw HTML body/commentary and timestamps
serialized as ISO 8601 strings. Image binaries are downloaded into
<images-dir>/<card-id>/<filename> (idempotent — existing files are skipped).

Consumed by the loom-files card_web connector for SQLite ingest. Read-only;
unlike mount, this never writes back to Firestore.`);
		process.exit(1);
	}

	if (result.dev && result.prod) {
		console.error('Error: --dev and --prod cannot both be set.');
		process.exit(1);
	}

	return result;
};

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

const normalizeCollectionURL = (url: string): string => {
	let normalized = url.replace(/^\/c\//, '').replace(/^c\//, '');
	if (!normalized.endsWith('/')) normalized += '/';
	return normalized;
};

interface ParsedCollection {
	publishedFilter: 'published' | 'unpublished' | null;
	typeFilter: string | null;
	tagFilters: string[];
}

const parseCollectionFilters = (
	collectionUrl: string,
	validTagSlugs: Set<string>,
): ParsedCollection => {
	const normalized = normalizeCollectionURL(collectionUrl);
	const parsed = deserializeCollectionURL(normalized, {}, {});

	const result: ParsedCollection = {
		publishedFilter: null,
		typeFilter: null,
		tagFilters: [],
	};
	const unsupported: string[] = [];

	for (const filter of parsed.filters) {
		if (filter === 'published') result.publishedFilter = 'published';
		else if (filter === 'unpublished') result.publishedFilter = 'unpublished';
		else if (filter.startsWith('type-')) result.typeFilter = filter.replace('type-', '');
		else if (validTagSlugs.has(filter)) result.tagFilters.push(filter);
		else unsupported.push(filter);
	}

	if (unsupported.length > 0) {
		console.error(`Unsupported filters: ${unsupported.join(', ')}`);
		console.error('Supported: published, unpublished, type-<name>, <tag-name>');
		process.exit(1);
	}

	return result;
};

type TagIndex = Map<string, string>;

const fetchTagIndex = async (db: FirebaseFirestore.Firestore): Promise<TagIndex> => {
	const snapshot = await db.collection(TAGS_COLLECTION).get();
	const index: TagIndex = new Map();
	for (const doc of snapshot.docs) {
		index.set(doc.id, doc.id);
	}
	return index;
};

const fetchCards = async (
	db: FirebaseFirestore.Firestore,
	parsed: ParsedCollection,
	tagIndex: TagIndex,
): Promise<Card[]> => {
	let q: FirebaseFirestore.Query = db.collection(CARDS_COLLECTION);

	if (parsed.publishedFilter === 'published') q = q.where('published', '==', true);
	else if (parsed.publishedFilter === 'unpublished') q = q.where('published', '==', false);

	if (parsed.typeFilter) q = q.where('card_type', '==', parsed.typeFilter);

	if (parsed.tagFilters.length > 0) {
		const slug = parsed.tagFilters[0];
		let tagId = '';
		for (const [id, s] of tagIndex.entries()) {
			if (s === slug) { tagId = id; break; }
		}
		if (tagId) q = q.where('tags', 'array-contains', tagId);
		else console.warn(`Could not find tag ID for slug: ${slug}`);
	}

	const snapshot = await q.get();
	let cards = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as Card));

	if (parsed.tagFilters.length > 1) {
		const additional = new Set<string>();
		for (const slug of parsed.tagFilters.slice(1)) {
			for (const [id, s] of tagIndex.entries()) {
				if (s === slug) { additional.add(id); break; }
			}
		}
		cards = cards.filter(c => [...additional].every(t => (c.tags || []).includes(t)));
	}

	return cards;
};

const formatTimestamp = (ts: { toDate(): Date } | null | undefined): string => {
	if (!ts || !ts.toDate) return '';
	return ts.toDate().toISOString();
};

const TIMESTAMP_FIELDS: ReadonlyArray<keyof Card> = [
	'created',
	'updated',
	'updated_substantive',
	'updated_message',
	'last_tweeted',
];

const serializeCard = (card: Card): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...(card as unknown as Record<string, unknown>) };
	for (const field of TIMESTAMP_FIELDS) {
		const raw = (card as unknown as Record<string, { toDate?: () => Date } | undefined>)[field as string];
		if (raw && typeof raw.toDate === 'function') {
			out[field as string] = formatTimestamp(raw as { toDate(): Date });
		} else if (raw === undefined || raw === null) {
			out[field as string] = '';
		}
	}
	return out;
};

const imageFilename = (img: ImageInfo): string => {
	if (img.uploadPath) return path.basename(img.uploadPath);
	if (img.src) {
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
	imagesRoot: string,
	storageBucket: ReturnType<typeof getStorage>,
): Promise<number> => {
	if (!card.images || card.images.length === 0) return 0;
	const imgDir = path.join(imagesRoot, card.id);
	fs.mkdirSync(imgDir, { recursive: true });
	let downloaded = 0;
	for (const img of card.images) {
		const filename = imageFilename(img);
		const destPath = path.join(imgDir, filename);
		if (fs.existsSync(destPath)) continue;
		try {
			if (img.uploadPath) {
				const bucket = storageBucket.bucket();
				const file = bucket.file(img.uploadPath);
				const [contents] = await file.download();
				fs.writeFileSync(destPath, contents);
				downloaded++;
			} else if (img.src) {
				const response = await fetch(img.src);
				if (response.ok) {
					const buffer = Buffer.from(await response.arrayBuffer());
					fs.writeFileSync(destPath, buffer);
					downloaded++;
				} else {
					console.warn(`  WARN: image ${img.src}: HTTP ${response.status}`);
				}
			}
		} catch (err) {
			console.warn(`  WARN: ${card.id}/${filename}: ${err}`);
		}
	}
	return downloaded;
};

const main = async () => {
	const args = parseArgs();
	const { prod, dev } = devProdConfig();

	let mode = prod;
	if (args.dev) {
		mode = dev;
	} else if (args.prod) {
		mode = prod;
	} else {
		const projectId = await selectedProjectID();
		if (dev.firebase.projectId === projectId) mode = dev;
		else if (prod.firebase.projectId === projectId) mode = prod;
		else throw new Error(`Neither dev nor prod project matches firebase use: ${projectId}`);
	}

	const projectId = mode.firebase.projectId;
	if (!projectId) throw new Error('No projectId configured for selected mode');
	const storageBucket = mode.firebase.storageBucket || `${projectId}.appspot.com`;
	const { db, storage } = initFirebase(projectId, storageBucket);

	console.error(`Project: ${projectId}`);
	console.error(`Collection: ${args.collection}`);
	console.error(`Output: ${args.output}`);
	console.error(`Images: ${args.imagesDir}`);

	const tagIndex = await fetchTagIndex(db);
	const validTagSlugs = new Set<string>([...tagIndex.values()]);
	const parsed = parseCollectionFilters(args.collection, validTagSlugs);
	const cards = await fetchCards(db, parsed, tagIndex);
	console.error(`Fetched ${cards.length} cards.`);

	fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
	fs.mkdirSync(args.imagesDir, { recursive: true });

	const stream = fs.createWriteStream(args.output, { encoding: 'utf-8' });
	const writeLine = (obj: unknown): Promise<void> =>
		new Promise((resolve, reject) => {
			stream.write(JSON.stringify(obj) + '\n', (err) => err ? reject(err) : resolve());
		});

	await writeLine({
		_type: 'manifest',
		collection: args.collection,
		project_id: projectId,
		dumped_at: new Date().toISOString(),
		card_count: cards.length,
		tag_index: Object.fromEntries(tagIndex),
	});

	let imagesDownloaded = 0;
	for (const card of cards) {
		await writeLine({ _type: 'card', ...serializeCard(card) });
		imagesDownloaded += await downloadImages(card, args.imagesDir, storage);
	}

	await new Promise<void>((resolve, reject) =>
		stream.end((err?: Error | null) => err ? reject(err) : resolve()));

	console.error(`Wrote ${cards.length} cards to ${args.output}`);
	if (imagesDownloaded > 0) {
		console.error(`Downloaded ${imagesDownloaded} new image(s) to ${args.imagesDir}`);
	}
};

main().catch(err => {
	console.error(err);
	process.exit(1);
});
