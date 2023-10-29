import {
    openai_endpoint
} from './openai.js';

import {
    Card, CardID
} from './types.js';

import {
    JSDOM
} from 'jsdom';

import {
    db
} from './common.js';

import {
    FieldValue,
    Timestamp,
} from 'firebase-admin/firestore';

import {
    Change,
    firestore
} from 'firebase-functions'

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
    if (card.card_type != CARD_TYPE_CONTENT && card.card_type != CARD_TYPE_WORKING_NOTES) return '';
    const body = innerTextForHTML(card[TEXT_FIELD_BODY]);
    const title = card[TEXT_FIELD_TITLE] || '';
    return title ? title + '\n' + body : body;

};

const embeddingForContent = async (cardContent : string) : Promise<Embedding> => {

    if (DEFAULT_EMBEDDING_TYPE_INFO.provider != 'openai.com') throw new Error(`Unsupported provider: ${DEFAULT_EMBEDDING_TYPE_INFO.provider}`);

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
    //TODO: store the index in the hsnw index of the item.
}

const embeddingInfoIDForCard = (card : Card, embeddingType : EmbeddingType = DEFAULT_EMBEDDING_TYPE, version : EmbeddingVersion = CURRENT_EMBEDDING_VERSION) : EmbeddingInfoID => {
    return card.id + '+' + embeddingType + '+' + version;
};

const processCard = async (card : Card) : Promise<void> => {
    const id = embeddingInfoIDForCard(card);
    const record = await db.collection(EMBEDDINGS_COLLECTION).doc(id).get();
    const text = textContentForEmbeddingForCard(card);
    if (record.exists) {
        const info = record.data() as EmbeddingInfo;
        //The embedding exists and is up to date, no need to do anything else.
        if (text == info.content) return;
    }
    const embedding = await embeddingForContent(text);

    //TODO: stop logging
    console.log(`Embedding: ${text}\n${JSON.stringify(embedding)}`);
    //TODO: also insert into HSNW index.

    const info : EmbeddingInfo = {
        card: card.id,
        embedding_type: DEFAULT_EMBEDDING_TYPE,
        content: text,
        version: CURRENT_EMBEDDING_VERSION,
        lastUpdated: FieldValue.serverTimestamp()
    };

    await db.collection(EMBEDDINGS_COLLECTION).doc(id).update(info);

};

const deleteCard = async (card : Card) : Promise<void> => {
    const id = embeddingInfoIDForCard(card);
    await db.collection(EMBEDDINGS_COLLECTION).doc(id).delete();
    //TODO: also delete item from hnsw index.
};

export const processCardEmbedding = async (change : Change<firestore.DocumentSnapshot>) : Promise<void> => {
    //TODO: if openai key not set, then silently exit.
    if (!change.after.exists) {
        const card = {id : change.before.id, ...change.before.data()} as Card;
        await deleteCard(card);
        return;
    }
    const card = {id : change.after.id, ...change.after.data()} as Card;
    await processCard(card);
};