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
	config,
	DEV_MODE
} from './common.js';

import {
	Change,
	firestore
} from 'firebase-functions';

import {
	QdrantClient
} from '@qdrant/js-client-rest';

import {
	v4 as uuidv4
} from 'uuid';

const DOM = new JSDOM();

const QDRANT_CLUSTER_URL = (config.qdrant || {}).cluster_url || '';
const QDRANT_API_KEY = (config.qdrant || {}).api_key || '';
const QDRANT_ENABLED = openai_endpoint && QDRANT_API_KEY && QDRANT_CLUSTER_URL;

//Duplicated in gulpfile.js as QDRANT_COLLECTION_NAME
const EMBEDDING_TYPES = {
	'openai.com-text-embedding-ada-002': {
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

const DEFAULT_EMBEDDING_TYPE : EmbeddingType = 'openai.com-text-embedding-ada-002';
const DEFAULT_EMBEDDING_TYPE_INFO = EMBEDDING_TYPES[DEFAULT_EMBEDDING_TYPE];

const PAYLOAD_CARD_ID_KEY = 'card_id';
const PAYLOAD_VERSION_KEY = 'extraction_version';
const QDRANT_BASE_COLLECTION_NAME = DEFAULT_EMBEDDING_TYPE;
const QDRANT_DEV_COLLECTION_NAME = 'dev-' + QDRANT_BASE_COLLECTION_NAME;
const QDRANT_PROD_COLLECTION_NAME = 'prod-' + QDRANT_BASE_COLLECTION_NAME;
const QDRANT_COLLECTION_NAME = DEV_MODE ? QDRANT_DEV_COLLECTION_NAME : QDRANT_PROD_COLLECTION_NAME;

class Embedding {
	_type : EmbeddingType = 'openai.com-text-embedding-ada-002';
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
const CARD_TYPE_WORKING_NOTES = 'working-notes';

//Recreated from src/contenteditable.ts
const legalTopLevelNodes = {
	'p': true,
	'ol': true,
	'ul': true,
	'h1': true,
	'h2': true,
	'h3': true,
	'h4': true,
};

//Recreated from src/contenteditable.ts
const normalizeLineBreaks = (html : string) => {
	if (!html) return html;
	//Remove all line breaks. We'll put them back in.
	html = html.split('\n').join('');

	//Add in line breaks
	for (const key of Object.keys(legalTopLevelNodes)) {
		const closeTag = '</' + key + '>';
		html = html.split(closeTag).join(closeTag + '\n');
	}

	html = html.split('<ul>').join('<ul>\n');
	html = html.split('<ol>').join('<ol>\n');
	html = html.split('<li>').join('\t<li>');
	html = html.split('</li>').join('</li>\n');
	return html;
};

//Recreated from src/util.ts
const innerTextForHTML = (body : string) : string => {
	const ele = DOM.window.document.createElement('section');
	ele.innerHTML = body;
	// makes sure line breaks are in the right place after each legal block level element
	body = normalizeLineBreaks(body);
	//textContent would return things like style and script contents, but those shouldn't be included anyway.
	return ele.textContent || '';
};

const textContentForEmbeddingForCard = (card : Card) : string => {
	//TODO: ideally this would literally be the cardPlainContent implementation from src/util.ts
	const parts : string[] = [card.card_type, '\n'];
	const body = innerTextForHTML(card.body);
	if (body) parts.push(body);
	//Skip the computed title on working-notes cards since they are entire
	//computed. No other field for any card-type is computed yet.
	const title = card.card_type != CARD_TYPE_WORKING_NOTES ? (card.title || '') : '';
	if (title) parts.push(title);
	return parts.join('\n');
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

type PointPayload = {
	//Indexed
	//Same as PAYLOAD_CARD_ID_KEY
	card_id: CardID;
	//Indexed
	//Same as PAYLOAD_VERSION_KEY
	extraction_version: EmbeddingVersion;
	content: string,
	//timestamp in milliseconds since epoch
	last_updated: number
}

type Point = {
	id: string,
	payload: PointPayload
};

class EmbeddingStore {
	_type : EmbeddingType = 'openai.com-text-embedding-ada-002';
	_version : EmbeddingVersion = 0;
	_qdrant : QdrantClient;

	constructor(type : EmbeddingType = 'openai.com-text-embedding-ada-002', version : EmbeddingVersion = 0) {
		if (!QDRANT_ENABLED) throw new Error('Qdrant not enabled');
		this._type = type;
		this._version = version;
		this._qdrant = new QdrantClient({
			url: QDRANT_CLUSTER_URL,
			apiKey: QDRANT_API_KEY
		});
	}

	get dim() : number {
		return EMBEDDING_TYPES[this._type].length;
	}

	async getExistingPoint(cardID : CardID) : Promise<Point | null> {
		const existingPoints = await this._qdrant.scroll(QDRANT_COLLECTION_NAME, {
			filter: {
				must: [
					{
						key: PAYLOAD_CARD_ID_KEY,
						match: {
							value: cardID
						}
					},
					{
						key: PAYLOAD_VERSION_KEY,
						match: {
							value: CURRENT_EMBEDDING_VERSION
						}
					}
				]
			}
		});
		if (existingPoints.points.length == 0) return null;
		const existingPoint = existingPoints.points[0];
		return {
			id: existingPoint.id as string,
			payload: existingPoint.payload as PointPayload
		};
	}

	async updateCard(card : Card) : Promise<void> {

		const existingPoint = await this.getExistingPoint(card.id);

		const text = textContentForEmbeddingForCard(card);

		if (!text.trim()) {
			console.log(`Skipping ${card.id} because text to embed is empty`);
			return;
		}

		if (existingPoint) {
			//The embedding exists and is up to date, no need to do anything else.
			if (text == existingPoint.payload.content) {
				console.log(`The embedding content had not changed for ${card.id} so stopping early`);
				return;
			}
		}

		const embedding = await embeddingForContent(text);
	
		//TODO: stop logging
		console.log(`Embedding: ${text}\n${JSON.stringify(embedding)}`);

		//Qdrant requires either an integer key or a literal UUID
		const id = uuidv4();

		const payload : PointPayload = {
			card_id: card.id,
			extraction_version: CURRENT_EMBEDDING_VERSION,
			content: text,
			last_updated: Date.now()
		};

		await this._qdrant.upsert(QDRANT_COLLECTION_NAME, {
			points: [
				{
					id,
					vector: embedding.vector,
					payload
				}
			]
		});
	}

	async deleteCard(card : Card) : Promise<void> {
		const existingPoint = await this.getExistingPoint(card.id);
		if (!existingPoint) return;
		await this._qdrant.delete(QDRANT_COLLECTION_NAME, {
			points: [
				existingPoint.id
			]
		});
	}
}

const EMBEDDING_STORE = QDRANT_ENABLED ? new EmbeddingStore() : null; 

export const processCardEmbedding = async (change : Change<firestore.DocumentSnapshot>) : Promise<void> => {
	if (!EMBEDDING_STORE) {
		console.warn('Qdrant not enabled, skipping');
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