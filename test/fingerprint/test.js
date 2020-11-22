/*eslint-env node*/

import {
	JSDOM
} from 'jsdom';

import {
	overrideDocument
} from '../../src/document.js';

const dom = new JSDOM('');

overrideDocument(dom.window.document);

import {
	cardSetNormalizedTextProperties
} from '../../src/nlp.js';

import {
	CARD_TYPE_CONTENT
} from '../../src/card_fields.js';

import assert from 'assert';

const CARD_ID_ONE = 'one';

const baseCards = (extras) => {
	if (!extras) extras = {};
	const cards = {
		...extras,
		...{
			[CARD_ID_ONE]: {
				'body': '<p>This is the body of this card.</p>\n<p>Seed crystals crystalize gradients <card-link card=\'two\'>surfing down</card-link> <strong>them</strong> a lot.</p>',
				'title': 'This is the title of this card',
			}
		}
	};

	for (let card of Object.values(cards)) {
		if (!card.card_type) card.card_type = CARD_TYPE_CONTENT;
		cardSetNormalizedTextProperties(card);
	}

	return cards;
};

describe('fingerprint generation', () => {
	it('No op simple content', async () => {
		const cards = baseCards();
		const card = cards[CARD_ID_ONE];
		const expectedNormalized = {
			'body': 'thi is the bodi of thi card seed crystal crystal gradient surf down them a lot',
			'title': 'thi is the titl of thi card',
			'subtitle': '',
			'references_info_inbound': '',
		};
		assert.deepStrictEqual(card.normalized, expectedNormalized);
	});

});