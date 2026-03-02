import { QdrantClient } from '@qdrant/js-client-rest';

import { ModeConfig } from './types.js';

//Duplicated from `functions/src/embeddings.ts`
const EMBEDDING_TYPES: Record<string, { length: number; provider: string; model: string }> = {
	'openai.com-text-embedding-ada-002': {
		length: 1536,
		provider: 'openai.com',
		model: 'text-embedding-ada-002'
	}
};

const DEFAULT_EMBEDDING_TYPE = 'openai.com-text-embedding-ada-002';
const DEFAULT_EMBEDDING_TYPE_INFO = EMBEDDING_TYPES[DEFAULT_EMBEDDING_TYPE];
const PAYLOAD_CARD_ID_KEY = 'card_id';
const PAYLOAD_VERSION_KEY = 'extraction_version';
const QDRANT_BASE_COLLECTION_NAME = DEFAULT_EMBEDDING_TYPE;
const QDRANT_DEV_COLLECTION_NAME = 'dev-' + QDRANT_BASE_COLLECTION_NAME;
const QDRANT_PROD_COLLECTION_NAME = 'prod-' + QDRANT_BASE_COLLECTION_NAME;

const qdrantEnabled = (config: ModeConfig, openaiEnabled: boolean): boolean => {
	if (!config.qdrant) return false;
	return openaiEnabled && !!config.qdrant.api_key && !!config.qdrant.cluster_url;
};

const configureQdrantCollection = async (config: ModeConfig, collectionName: string, openaiEnabled: boolean): Promise<void> => {
	if (!qdrantEnabled(config, openaiEnabled)) {
		console.warn('Qdrant not enabled');
		return;
	}

	const info = config.qdrant;
	if (!info) return;

	const client = new QdrantClient({
		url: info.cluster_url,
		apiKey: info.api_key
	});

	let collectionInfo = null;
	try {
		collectionInfo = await client.getCollection(collectionName);
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404) {
			// Collection doesn't exist yet, will create below
		} else {
			throw e;
		}
	}

	if (!collectionInfo) {
		const size = DEFAULT_EMBEDDING_TYPE_INFO.length;
		console.log(`Creating ${collectionName}`);
		await client.createCollection(collectionName, {
			vectors: {
				size,
				distance: 'Cosine'
			},
			on_disk_payload: true
		});
	}

	if (collectionInfo && !collectionInfo.config.params.on_disk_payload) {
		console.log(`Switching to on_disk_payload for ${collectionName}`);
		await client.updateCollection(collectionName, {
			params: {
				on_disk_payload: true
			}
		});
	}

	if (!collectionInfo || !collectionInfo.payload_schema[PAYLOAD_CARD_ID_KEY]) {
		console.log(`Creating index for ${collectionName}.${PAYLOAD_CARD_ID_KEY}`);
		await client.createPayloadIndex(collectionName, {
			field_name: PAYLOAD_CARD_ID_KEY,
			field_schema: 'keyword'
		});
	}

	if (!collectionInfo || !collectionInfo.payload_schema[PAYLOAD_VERSION_KEY]) {
		console.log(`Creating index for ${collectionName}.${PAYLOAD_VERSION_KEY}`);
		await client.createPayloadIndex(collectionName, {
			field_name: PAYLOAD_VERSION_KEY,
			field_schema: 'integer'
		});
	}
};

export const configureQdrant = async (prodConfig: ModeConfig, devConfig: ModeConfig, devProvided: boolean, openaiEnabled: boolean): Promise<void> => {
	if (devProvided) {
		await configureQdrantCollection(devConfig, QDRANT_DEV_COLLECTION_NAME, openaiEnabled);
	}
	await configureQdrantCollection(prodConfig, QDRANT_PROD_COLLECTION_NAME, openaiEnabled);
};
