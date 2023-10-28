import {
    openai_endpoint
} from './openai.js';

import {
    Card
} from './types.js';

const EMBEDDING_TYPES = {
    'openai.com:text-embedding-ada-002': {
        length: 1536,
        provider: 'openai.com',
        model: 'text-embedding-ada-002'
    }
} as const;

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

const textContentForEmbeddingForCard = (card : Card) : string => {
    //TODO: use the same basic logic as cardPlainContent clientside (which requires all kinds of constants...)
    return card.body;
};

export const embeddingForCard = async (card : Card) : Promise<Embedding> => {
    const text = textContentForEmbeddingForCard(card);

    if (DEFAULT_EMBEDDING_TYPE_INFO.provider != 'openai.com') throw new Error(`Unsupported provider: ${DEFAULT_EMBEDDING_TYPE_INFO.provider}`);

    //TODO: try/catch
    const result = await openai_endpoint.createEmbedding({
        model: DEFAULT_EMBEDDING_TYPE_INFO.model,
        input: text
    });

    const vector = result.data.data[0].embedding;

    return new Embedding(DEFAULT_EMBEDDING_TYPE, vector);
};