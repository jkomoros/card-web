import {
	openai_endpoint
} from './openai.js';

import {
	Card,
	CardID
} from './types.js';

import {
	JSDOM
} from 'jsdom';

import {
	db,
	storage
} from './common.js';

import {
	File
} from '@google-cloud/storage';

import {
	FieldValue,
	Timestamp,
} from 'firebase-admin/firestore';

import {
	Change,
	firestore
} from 'firebase-functions';

import hnswlib from 'hnswlib-node';
import fs from 'fs';

const DOM = new JSDOM();

const EMBEDDINGS_COLLECTION = 'embeddings';

const EMBEDDING_TYPES = {
	'openai.com:text-embedding-ada-002': {
		length: 1536,
		provider: 'openai.com',
		model: 'text-embedding-ada-002'
	}
} as const;

//All of the versions of content extraction pipelines; when a new one is
//created, a new index should be added an CURRENT_EMBEDDING_VERSION Should be
//incremented.
type EmbeddingVersion = 0;
const CURRENT_EMBEDDING_VERSION : EmbeddingVersion = 0;

type EmbeddingType = keyof typeof EMBEDDING_TYPES;
type EmbeddingVector = number[];

const DEFAULT_EMBEDDING_TYPE : EmbeddingType = 'openai.com:text-embedding-ada-002';
const DEFAULT_EMBEDDING_TYPE_INFO = EMBEDDING_TYPES[DEFAULT_EMBEDDING_TYPE];

class Embedding {
	_type : EmbeddingType = 'openai.com:text-embedding-ada-002';
	_vector : EmbeddingVector = [];

	constructor(type: EmbeddingType, vector : EmbeddingVector) {
		const typeInfo = EMBEDDING_TYPES[type];
		if (!typeInfo) throw new Error(`Unknown type: ${type}`);
		if (vector.length != typeInfo.length) throw new Error(`Invalid length: expected ${typeInfo.length}, got ${vector.length}`);
		this._type = type;
		this._vector = vector;
	}

	get vector() : EmbeddingVector {
		return this._vector;
	}

	get type() : EmbeddingType {
		return this._type;
	}
}

//Copied from src/type_constants.ts
const TEXT_FIELD_BODY = 'body';
const TEXT_FIELD_TITLE = 'title';
const CARD_TYPE_CONTENT = 'content';
const CARD_TYPE_WORKING_NOTES = 'working-notes';

const innerTextForHTML = (html : string) : string => {
	const ele = DOM.window.document.createElement('section');
	ele.innerHTML = html;
	//textContent would return things like style and script contents, but those shouldn't be included anyway.
	return ele.textContent || '';
};

const textContentForEmbeddingForCard = (card : Card) : string => {
	//TODO: ideally this would literally be the cardPlainContent implementation from src/util.ts
	//TODO: this shouldn't use the title for working-notes cards, since it's computed.
	//TODO: this needs the new line behavior after blocks from innerTextForHTML.
	if (card.card_type != CARD_TYPE_CONTENT && card.card_type != CARD_TYPE_WORKING_NOTES) return '';
	const body = innerTextForHTML(card[TEXT_FIELD_BODY]);
	const title = card[TEXT_FIELD_TITLE] || '';
	return title ? title + '\n' + body : body;

};

const embeddingForContent = async (cardContent : string) : Promise<Embedding> => {

	if (DEFAULT_EMBEDDING_TYPE_INFO.provider != 'openai.com') throw new Error(`Unsupported provider: ${DEFAULT_EMBEDDING_TYPE_INFO.provider}`);

	if (!openai_endpoint) throw new Error('No openai_endpoint');

	//TODO: try/catch
	const result = await openai_endpoint.createEmbedding({
		model: DEFAULT_EMBEDDING_TYPE_INFO.model,
		input: cardContent
	});

	const vector = result.data.data[0].embedding;

	return new Embedding(DEFAULT_EMBEDDING_TYPE, vector);
};

type EmbeddingInfoID = string;

type EmbeddingInfo = {
	card: CardID,
	embedding_type: EmbeddingType,
	content: string,
	version: EmbeddingVersion,
	lastUpdated: Timestamp | FieldValue
	vectorIndex: number
}

const embeddingInfoIDForCard = (card : Card, embeddingType : EmbeddingType = DEFAULT_EMBEDDING_TYPE, version : EmbeddingVersion = CURRENT_EMBEDDING_VERSION) : EmbeddingInfoID => {
	return card.id + '+' + embeddingType + '+' + version;
};

const HNSW_FILENAME = 'hnsw.db';
const HNSW_TEMP_LOCATION = '/tmp/' + HNSW_FILENAME;

//The default bucket is already configured, just use that
const hnswBucket = storage.bucket();

const readIndex = async (hnsw : hnswlib.HierarchicalNSW, file : File) => {
	//hnsw only knows how to load from filesystem, so downlaod and write a file.
	//Cloud Functions has a whole fake filesystem in memory.
	const response = await file.download();
	const data = response[0];
	fs.writeFileSync(HNSW_TEMP_LOCATION, data);
	await hnsw.readIndex(HNSW_TEMP_LOCATION);
	fs.unlinkSync(HNSW_TEMP_LOCATION);
};

const saveIndex = async (hnsw : hnswlib.HierarchicalNSW, file : File) => {
	//hnsw only knows how to load from filesystem, so downlaod and write a file.
	//Cloud Functions has a whole fake filesystem in memory.
	await hnsw.writeIndex(HNSW_TEMP_LOCATION);
	const data = fs.readFileSync(HNSW_TEMP_LOCATION);
	await file.save(data);
	fs.unlinkSync(HNSW_TEMP_LOCATION);
};

class EmbeddingStore {
	_type : EmbeddingType = 'openai.com:text-embedding-ada-002';
	_version : EmbeddingVersion = 0;
	_hnsw : hnswlib.HierarchicalNSW | null = null;

	constructor(type : EmbeddingType = 'openai.com:text-embedding-ada-002', version : EmbeddingVersion = 0) {
		this._type = type;
		this._version = version;
	}

	get dim() : number {
		return EMBEDDING_TYPES[this._type].length;
	}

	get hnswFile() : File {
		const path = 'embeddings/' + this._type + '/' + this._version + '/' + HNSW_FILENAME;
		return hnswBucket.file(path);
	}

	async _getHNSW() : Promise<hnswlib.HierarchicalNSW> {
		if (this._hnsw) return this._hnsw;
		const memoryFile = this.hnswFile;
		const memoryExistsResponse = await memoryFile.exists();
		const memoryExists = memoryExistsResponse[0];
		const hnsw = new hnswlib.HierarchicalNSW('cosine', this.dim);
		if (memoryExists) {
			await readIndex(hnsw, memoryFile);
			console.log(`Loaded ${memoryFile.name} with ${hnsw.getCurrentCount()} items`);
		} else {
			//We'll start small and keep growing if necessary.
			hnsw.initIndex(32);
			console.log('Created a new hnsw index');
		}
		this._hnsw = hnsw;
		return hnsw;
	}

	async _saveHNSW(): Promise<void> {
		const hnsw = await this._getHNSW();
		saveIndex(hnsw, this.hnswFile);
		console.log(`Saving hnsw with ${hnsw.getCurrentCount()} items.`);
	}

	async updateCard(card : Card) : Promise<void> {
		const id = embeddingInfoIDForCard(card);
		const record = await db.collection(EMBEDDINGS_COLLECTION).doc(id).get();
		const text = textContentForEmbeddingForCard(card);
		if (record.exists) {
			const info = record.data() as EmbeddingInfo;
			//The embedding exists and is up to date, no need to do anything else.
			if (text == info.content) {
				console.log(`The embedding content had not changed for ${id} so stopping early`);
				return;
			}
		}
		const embedding = await embeddingForContent(text);
	
		//TODO: stop logging
		console.log(`Embedding: ${text}\n${JSON.stringify(embedding)}`);

		const hnsw = await this._getHNSW();

		if (record.exists) {
			//We want to remove the earlier index item for it so we don't get duplicates
			const info = record.data() as EmbeddingInfo;
			hnsw.markDelete(info.vectorIndex);
		}

		//hsnw requires an integer key, so do one higher than has ever been in it.
		const vectorIndex = hnsw.getCurrentCount();
		//Double the index size if we were about to run over.
		if (vectorIndex >= hnsw.getMaxElements()) {
			const newSize = hnsw.getMaxElements() * 2;
			console.log(`Resizing hnsw index to ${newSize}`);
			hnsw.resizeIndex(newSize);
		}

		hnsw.addPoint(embedding.vector, vectorIndex);
		await this._saveHNSW();

		const info : EmbeddingInfo = {
			card: card.id,
			embedding_type: DEFAULT_EMBEDDING_TYPE,
			content: text,
			version: CURRENT_EMBEDDING_VERSION,
			lastUpdated: FieldValue.serverTimestamp(),
			vectorIndex
		};
	
		await db.collection(EMBEDDINGS_COLLECTION).doc(id).set(info, {merge: true});
	}

	async deleteCard(card : Card) : Promise<void> {
		const id = embeddingInfoIDForCard(card);
		const ref = db.collection(EMBEDDINGS_COLLECTION).doc(id);
		const doc = await ref.get();
		const info = doc.data() as EmbeddingInfo;
		const hnsw = await this._getHNSW();
		hnsw.markDelete(info.vectorIndex);
		await this._saveHNSW();
		await ref.delete();
	}
}

const EMBEDDING_STORE = new EmbeddingStore();

export const processCardEmbedding = async (change : Change<firestore.DocumentSnapshot>) : Promise<void> => {
	if (!openai_endpoint) {
		console.warn('OpenAI endpoint not configured, skipping.');
		return;
	}
	if (!change.after.exists) {
		//Put ID after the data because of issue #672.
		const card = {...change.before.data(), id : change.before.id} as Card;
		await EMBEDDING_STORE.deleteCard(card);
		return;
	}
	//Put ID after the data because of issue #672.
	const card = {...change.after.data(), id : change.after.id} as Card;
	await EMBEDDING_STORE.updateCard(card);
};