import {
	openai_endpoint,
} from './openai.js';

import {
	Card,
	CardID
} from './types.js';

import {
	CardSimilarityItem,
	EmbeddableCard,
	SimilarCardsRequestData,
	SimilarCardsResponseData,
	SemanticSortRequestData,
	SemanticSortResponseData
} from '../../shared/types.js';

import {
	innerTextForHTML
} from '../../shared/util.js';

import {
	overrideDocument
} from '../../shared/document.js';

import {
	JSDOM
} from 'jsdom';

import {
	DEV_MODE,
	getCards,
	QDRANT_API_KEY,
	QDRANT_CLUSTER_URL,
	throwIfUserMayNotUseAI
} from './common.js';

import {
	QdrantClient
} from '@qdrant/js-client-rest';

import {
	v4 as uuidv4
} from 'uuid';

import {
	FirestoreEvent,
	Change,
	DocumentSnapshot
} from 'firebase-functions/v2/firestore';

import {
	CallableRequest
} from 'firebase-functions/v2/https';

//The highest number of cards there might ever be.
const MAX_EMBEDDINGS = 100000;

const DOM = new JSDOM();
overrideDocument(DOM.window.document);

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
//incremented. When adding one, add it like: `0 | 1` and set
//CURRENT_EMBEDDING_VERSION to the new number. When you deploy
//updateCardEmbedding, reindexCardEmbeddings, and similarCards, it will use only
//the new version, which means you should call `gulp reindex-card-embeddings`.
//Note there's currently no tool to remove the old embeddings, although it
//should be pretty simple to do one by looking at getExistingPoint and using
//client.delete() with the filter condition for the old version.
type EmbeddingVersion = 0;
const CURRENT_EMBEDDING_VERSION : EmbeddingVersion = 0;

type EmbeddingType = keyof typeof EMBEDDING_TYPES;
type EmbeddingVector = number[];

const DEFAULT_EMBEDDING_TYPE : EmbeddingType = 'openai.com-text-embedding-ada-002';
const DEFAULT_EMBEDDING_TYPE_INFO = EMBEDDING_TYPES[DEFAULT_EMBEDDING_TYPE];

const PAYLOAD_CARD_ID_KEY = 'card_id';
const PAYLOAD_VERSION_KEY = 'extraction_version';
const PAYLOAD_CONTENT_KEY = 'content';
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


const formatDate = (date :  Date) : string => {
	const year = date.getFullYear();
	const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are 0-indexed, so add 1
	const day = date.getDate().toString().padStart(2, '0');

	return `${year}/${month}/${day}`;
};

type SimpleTimestamp = {
	seconds: number;
	nanoseconds: number;
};

//Gets the date when it might be a literal Timestamp or just an object with {seconds, nanoseconds}
const toDate = (time : SimpleTimestamp) : Date => {
	if ('toDate' in time && typeof time.toDate == 'function') return time.toDate();
	if ('seconds' in time) return new Date(time.seconds * 1000);
	console.warn(`No time, using now: ${time}`);
	return new Date();
};

export const textContentForEmbeddingForCard = (card : EmbeddableCard) : string => {
	//Every time this function is updated, CURRENT_EMBEDDING_VERSION should be incremented.

	//TODO: ideally this would literally be the cardPlainContent implementation from src/util.ts
	//This is now possible because cardPlainContent is now in shared/util.ts.
	const parts : string[] = [];
	//Skip the computed title on working-notes cards since they are entire
	//computed. No other field for any card-type is computed yet.
	const title = card.card_type != 'working-notes' ? (card.title || '') : '';
	if (title) parts.push(title);
	const body = innerTextForHTML(card.body);
	if (body) parts.push(body);
	const commentary = innerTextForHTML(card.commentary || '');
	if (commentary) parts.push(commentary);
	if (parts.length == 0) return '';
	const created = toDate(card.created);
	const suffix = '\n\n' + formatDate(created) + '\n' + card.card_type;
	return parts.join('\n') + suffix;
};

export const embeddingForContent = async (cardContent : string) : Promise<Embedding> => {

	if (DEFAULT_EMBEDDING_TYPE_INFO.provider != 'openai.com') throw new Error(`Unsupported provider: ${DEFAULT_EMBEDDING_TYPE_INFO.provider}`);

	if (!openai_endpoint) throw new Error('No openai_endpoint');

	//TODO: try/catch
	const result = await openai_endpoint.embeddings.create({
		model: DEFAULT_EMBEDDING_TYPE_INFO.model,
		input: cardContent
	});

	const vector = result.data[0].embedding;

	return new Embedding(DEFAULT_EMBEDDING_TYPE, vector);
};

type PointPayload = {
	//Indexed
	//Same as PAYLOAD_CARD_ID_KEY
	card_id: CardID;
	//Indexed
	//Same as PAYLOAD_VERSION_KEY
	extraction_version: EmbeddingVersion;
	//Same as PAYLOAD_CONTENT_KEY
	content: string,
	//when the point was updated. timestamp in milliseconds since epoch
	last_updated: number,
	//These next two fields are just useful for visualization in the dashboard.
	card_type: string,
	//timestamp in milliseconds since epoch
	card_created: number
}

type Point = {
	id: string,
	vector? : EmbeddingVector,
	payload?: PointPayload
};


//A subset of Point
type PointSummary = {
	id: string,
	payload?: {
		content: string
	}
};

type GetPointsOptions = {
	includePayload? : boolean | (keyof PointPayload)[],
	includeVector? : boolean
};

const DEFAULT_SIMLIAR_POINTS_LIMIT = 500;

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

	async similarPoints(cardID : CardID, vector : EmbeddingVector, limit : number = DEFAULT_SIMLIAR_POINTS_LIMIT) : Promise<CardSimilarityItem[]> {
		const points = await this._qdrant.search(QDRANT_COLLECTION_NAME, {
			vector,
			limit,
			filter: {
				must_not: [
					{
						key: PAYLOAD_CARD_ID_KEY,
						match: {
							value: cardID
						}
					},
				],
				must: [

					{
						key: PAYLOAD_VERSION_KEY,
						match: {
							value: CURRENT_EMBEDDING_VERSION
						}
					}
				]
			},
			with_payload: [
				PAYLOAD_CARD_ID_KEY
			],
			with_vector: false
		});

		return points.map(point => {
			if (!point.payload) throw new Error('No payload as expected');
			const cardID = point.payload[PAYLOAD_CARD_ID_KEY] as string || '';
			return [cardID, point.score];
		});
	}

	async getExistingPointsVectors(cardIDs : CardID[]) : Promise<Record<CardID, EmbeddingVector>> {
		const existingPoints = await this._qdrant.scroll(QDRANT_COLLECTION_NAME, {
			filter: {
				must: [
					{
						key: PAYLOAD_CARD_ID_KEY,
						match: {
							any: cardIDs
						}
					},
					{
						key: PAYLOAD_VERSION_KEY,
						match: {
							value: CURRENT_EMBEDDING_VERSION
						}
					}
				]
			},
			limit: MAX_EMBEDDINGS,
			with_vector: true
		});
		const result =  Object.fromEntries(existingPoints.points.map(point => {
			const cardID = point.payload?.card_id;
			if (!cardID) throw new Error('No card_id as expected');
			if (!point.vector) throw new Error('No vector as expected');
			return [cardID, point.vector];
		}));

		if (Object.keys(result).length != cardIDs.length) {
			const missingIDs = cardIDs.filter(cardID => !result[cardID]);
			console.warn(`Got ${Object.keys(result).length} vectors. Missing vectors for ${missingIDs.length} cards: ${missingIDs.join(', ')}`);
		}

		return result;
	}

	//TODO: more clever typing so we can affirmatively say if the Point has a payload and/or vector fields
	async getExistingPoint(cardID : CardID, opts : GetPointsOptions = {}) : Promise<Point | null> {
		const defaultOpts : Required<GetPointsOptions> = {includePayload: false, includeVector: false};
		const finalOpts : Required<GetPointsOptions> = {...defaultOpts, ...opts};

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
			},
			with_vector: finalOpts.includeVector,
			with_payload: finalOpts.includePayload
		});
		if (existingPoints.points.length == 0) return null;
		const existingPoint = existingPoints.points[0];
		return {
			id: existingPoint.id as string,
			vector: existingPoint.vector ? existingPoint.vector as EmbeddingVector : undefined,
			payload: existingPoint.payload as PointPayload
		};
	}

	//cardInfo if provided will be consulted instead of going out to hit the endpoint.
	async updateCard(card : Card, cardsContent? : Record<CardID, PointSummary>) : Promise<void> {

		const text = textContentForEmbeddingForCard(card);

		let existingPoint : PointSummary | null = null;
		if (cardsContent) {
			existingPoint = cardsContent[card.id];
		}
		if (!existingPoint) {
			if (cardsContent) console.log(`No existing point for ${card.id} despite cardsContent being provided. Will fetch it from the endpoint.`);
			existingPoint = await this.getExistingPoint(card.id, {includePayload: true});
		}

		if (existingPoint && existingPoint.payload && existingPoint.payload.content === text) {
			//The embedding exists and is up to date, no need to recompute the
			//embedding. We do still want to update the timestamp in the vector
			//store though, so in the future last_updated will note that it's
			//current as of this moment, not when the embedding changed...
			//because a card itself doesn't know the timestamp when the
			//embeddable content last changed.
			await this._qdrant.setPayload(QDRANT_COLLECTION_NAME, {
				points: [
					existingPoint.id
				],
				payload: {
					last_updated: Date.now()
				}
			});

			console.log(`Updated the metadata for ${card.id} (${existingPoint.id}) because its embedding had not changed`);
			return;
		}

		const embedding = await embeddingForContent(text);
	
		//Qdrant requires either an integer key or a literal UUID
		//We want to reuse the id to upsert if we can.
		const id = existingPoint ? existingPoint.id : uuidv4();

		const payload : PointPayload = {
			card_id: card.id,
			extraction_version: CURRENT_EMBEDDING_VERSION,
			content: text,
			last_updated: Date.now(),
			card_type: card.card_type,
			card_created: card.created.toMillis()
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

		console.log(`Stored embedding for ${card.id} (${id})`);
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

export const EMBEDDING_STORE = QDRANT_ENABLED ? new EmbeddingStore() : null; 

export const processCardEmbedding = async (event : FirestoreEvent<Change<DocumentSnapshot> | undefined, {cardID: string;}>) => {

	const change = event.data;

	//Note: this will be called not only when a card's text properties change,
	//but also for example when a referenced card's references_inbound changes.
	//When cards are created and first saved they often are empty, and then
	//later they have their first text and concepts added.

	if (!change) {
		console.warn('No data');
		return;
	}

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

const TOO_MANY_ERRORS = 5;

export const reindexCardEmbeddings = async () : Promise<void> => {
	if (!EMBEDDING_STORE) {
		console.warn('Qdrant not enabled, skipping');
		return;
	}

	const cards = await getCards();

	const indexedCardInfoResult = await EMBEDDING_STORE._qdrant.scroll(QDRANT_COLLECTION_NAME, {
		filter: {
			must: [
				{
					key: PAYLOAD_VERSION_KEY,
					match: {
						value: CURRENT_EMBEDDING_VERSION
					}
				}
			]
		},
		limit: MAX_EMBEDDINGS,
		with_payload: {
			include: [
				PAYLOAD_CONTENT_KEY,
				PAYLOAD_CARD_ID_KEY
			]
		}
	});

	const cardsInfo = Object.fromEntries(indexedCardInfoResult.points.map(point => [point.payload?.card_id, {id: point.id, payload: {content: point.payload?.content}}])) as Record<CardID, PointSummary>;

	let i = 1;
	let errCount = 0;
	for (const card of cards) {
		console.log(`Processing card ${i}/${cards.length}`);
		//This could fail for example for too-long embeddings
		try {
			await EMBEDDING_STORE.updateCard(card, cardsInfo);
			errCount = 0;
		} catch(err) {
			console.warn(`${card.id} failed: ${String(err)}`);
			errCount++;
		}
		if (errCount > TOO_MANY_ERRORS) {
			throw new Error(`Received ${TOO_MANY_ERRORS} in a row so quitting`);
		}
		i++;
	}
	console.log('Done indexing cards');
};

//Higher cosineSimilarity means more similar
const cosineSimilarity = (a : EmbeddingVector, b : EmbeddingVector) : number => {
	if (a.length != b.length) throw new Error(`Vectors are different lengths: ${a.length} and ${b.length}`);
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		magA += a[i] * a[i];
		magB += b[i] * b[i];
	}
	magA = Math.sqrt(magA);
	magB = Math.sqrt(magB);
	return dot / (magA * magB);
};

const MAXIMUM_SEMANTIC_SORT_CARDS = 500;

const POSITION_WEIGHT = 0.5; // Adjust this to balance between similarity and original order

const calculateScore = (
	cardIndex: number,
	insertIndex: number,
	newOrder: CardID[],
	vectors: Record<CardID, EmbeddingVector>,
	originalOrder: CardID[]
): number => {
	const card = originalOrder[cardIndex];
	const cardVector = vectors[card];
  
	let similarityScore = 0;
	if (insertIndex > 0) {
		const prevCard = newOrder[insertIndex - 1];
		similarityScore += cosineSimilarity(cardVector, vectors[prevCard]);
	}
	if (insertIndex < newOrder.length) {
		const nextCard = newOrder[insertIndex];
		similarityScore += cosineSimilarity(cardVector, vectors[nextCard]);
	}
  
	const positionScore = Math.abs(cardIndex - insertIndex);
  
	return similarityScore - POSITION_WEIGHT * positionScore;
};

export const semanticSort = async (request: CallableRequest<SemanticSortRequestData>): Promise<SemanticSortResponseData> => {
	const originalOrder = [...request.data.cards];
	if (!EMBEDDING_STORE) {
		throw new Error('No embedding store');
	}

	if (originalOrder.length < 2) return { cards: originalOrder, swaps: 0 };

	if (originalOrder.length > MAXIMUM_SEMANTIC_SORT_CARDS) throw new Error(`Too many cards: ${originalOrder.length}`);

	const vectors = await EMBEDDING_STORE.getExistingPointsVectors(originalOrder);

	const newOrder: CardID[] = [];
	let swaps = 0;

	for (let i = 0; i < originalOrder.length; i++) {
		const card = originalOrder[i];
		if (!vectors[card]) {
			console.warn(`No embedding for ${card}`);
			newOrder.push(card);
			continue;
		}

		let bestScore = -Infinity;
		let bestIndex = 0;

		for (let j = 0; j <= newOrder.length; j++) {
			const score = calculateScore(i, j, newOrder, vectors, originalOrder);
			if (score > bestScore) {
				bestScore = score;
				bestIndex = j;
			}
		}

		newOrder.splice(bestIndex, 0, card);
		if (bestIndex !== newOrder.length - 1) swaps++;
	}

	console.log(`Made ${swaps} insertions over ${originalOrder.length} cards`);

	return { cards: newOrder, swaps };
};

//How many milliseconds of slop do we allow for last_updated check? This gets
//across that the server and client times might be out of sync. If this is too
//big, then the common case of 'create-a-card' (which gets a generic embedding
//for '') and then 'edit and paste' will erronously report that the old
//embedding is current, which will give a faux, generic embedding similiarity
//even after the card is edited (until the client refetches). We can set this
//quite small because the timestamps we're preparing all come from Google
//Servers (never a user's client machine), and we can assume their time is
//extremely accurate.
const LAST_UPDATED_EPISLON = 500;

export const similarCards = async (request : CallableRequest<SimilarCardsRequestData>) : Promise<SimilarCardsResponseData> => {
	const data = request.data;
	if (!EMBEDDING_STORE) {
		throw new Error('No embedding store');
	}

	let vector : EmbeddingVector | null = null;

	if (data.card) {
		//We will hit the openai endpoint, so verify we're allowed.
		try {
			await throwIfUserMayNotUseAI(request.auth?.uid);
		} catch(err) {
			return {
				success: false,
				code: 'insufficient-permissions',
				error: String(err)
			};
		}

		if (data.card.id != data.card_id) {
			return {
				success: false,
				code: 'unknown',
				error: `Card.id was ${data.card.id} which did not match card_id: ${data.card_id}`
			};
		}

		const content = textContentForEmbeddingForCard(data.card);
		const embedding = await embeddingForContent(content);
		vector = embedding.vector;

	} else {
		//We'll use the embeddeding that is already stored.
		const point = await EMBEDDING_STORE.getExistingPoint(data.card_id, {includeVector: true, includePayload: ['last_updated']});
		if (!point) {
			return {
				success: false,
				code: 'no-embedding',
				error: `Could not find embedding for ${data.card_id}`
			};
		}

		if (data.last_updated !== undefined) {
			const point_last_updated = point.payload?.last_updated;
			if (!point_last_updated) {
				return {
					success: false,
					code: 'unknown',
					error: 'Point didn\'t have last_updated as expected'
				};
			}
			if (!(point_last_updated >= data.last_updated - LAST_UPDATED_EPISLON)) {
				//Point is less current than epsilon
				return {
					success: false,
					code: 'stale-embedding',
					error: `Embedding has timestamp of ${point_last_updated} but card last_updated is ${data.last_updated}`
				};
			}
		}
	
		//TODO: allow passing a custom limit (validate it)
	
		if (!point.vector) {
			return {
				success: false,
				code: 'unknown',
				error: 'Point did not include vector as expected'
			};
		}

		vector = point.vector;
	}

	if (!vector) {
		return {
			success: false,
			code: 'unknown',
			error: 'vector was empty'
		};
	}

	const points = await EMBEDDING_STORE.similarPoints(data.card_id, vector);

	return {
		success: true,
		cards:points
	};
};