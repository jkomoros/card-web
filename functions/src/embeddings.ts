import {
    openai_endpoint
} from './openai.js';

import {
    Card
} from './types.js';

import {
    JSDOM
} from 'jsdom';

const DOM = new JSDOM();

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
    if (card.card_type != CARD_TYPE_CONTENT && card.card_type != CARD_TYPE_WORKING_NOTES) return '';
    const body = innerTextForHTML(card[TEXT_FIELD_BODY]);
    const title = card[TEXT_FIELD_TITLE] || '';
    return title ? title + '\n' + body : body;

};

export const embeddingForCard = async (card : Card) : Promise<Embedding | null> => {
    const text = textContentForEmbeddingForCard(card);

    if (!text) return null;

    if (DEFAULT_EMBEDDING_TYPE_INFO.provider != 'openai.com') throw new Error(`Unsupported provider: ${DEFAULT_EMBEDDING_TYPE_INFO.provider}`);

    //TODO: try/catch
    const result = await openai_endpoint.createEmbedding({
        model: DEFAULT_EMBEDDING_TYPE_INFO.model,
        input: text
    });

    const vector = result.data.data[0].embedding;

    return new Embedding(DEFAULT_EMBEDDING_TYPE, vector);
};