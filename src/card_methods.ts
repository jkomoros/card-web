import {
	EMPTY_PROCESSED_CARD
} from './card_fields.js';

import {
	CARD_TYPE_CONFIGURATION,
	TEXT_FIELD_CONFIGURATION,
	TITLE_ALTERNATE_DELIMITER,
	TITLE_ALTERNATE_NEGATION
} from '../shared/card_fields.js';

import {
	Card,
	CardFieldHTMLFormatter,
	CardFieldType,
	CardFieldTypeConfiguration,
	CardFieldValidator,
	Cards,
	CardType,
	CardTypeBackportTitleExtractor,
	ReferenceType,
	ProcessedCard,
	FontSizeBoostMap,
	CardFieldTypeEditable,
	CardDiff,
	IconName
} from './types.js';

import {
	innerTextForHTML,
} from '../shared/util.js';

import {
	elementForHTML,
	validateTopLevelNodes
} from './contenteditable.js';

import {
	isURL
} from './util.js';

import {
	references
} from './references.js';

import {
	CardRenderer
} from './components/card-renderer.js';

import {
	TypedObject
} from '../shared/typed_object.js';

export type CardFieldHTMLFormatterConfigurationMap = {
	[typ in CardFieldType]+?: CardFieldHTMLFormatter
}

export type CardFieldValidatorConfigurationMap = {
	[typ in CardFieldType]+?: CardFieldValidator
}

export type CardTypeBackportTitleExtractorConfigurationMap = {
	[typ in CardType]+?: CardTypeBackportTitleExtractor
}

/*

This approach of allowing 'opposites' of cards to be represented in
title_alternates with a special prefix makes it so all of the other downstream
text processing works, while still making it clear that the term is the opposite of the primary term.

*/
const titleAlternatesHTMLFormatter = (value : string) : string => {
	if (!value) return value;
	const synonyms : string[] = [];
	const antonyms : string[] = [];
	for (const str of value.split(TITLE_ALTERNATE_DELIMITER)) {
		const trimmedStr = str.trim();
		if (!trimmedStr) continue;
		if (trimmedStr[0] == TITLE_ALTERNATE_NEGATION) {
			//Replace the first instance of the negator only, leaving the rest of whitespace intact
			antonyms.push(str.replace(TITLE_ALTERNATE_NEGATION, ''));
		} else {
			synonyms.push(str);
		}
	}
	let result = '';
	if (synonyms.length) result += '<span>Also known as</span> ' + synonyms.join(TITLE_ALTERNATE_DELIMITER);
	if (synonyms.length && antonyms.length) result += ' ';
	if (antonyms.length) result += '<span>In contrast to</span> ' + antonyms.join(TITLE_ALTERNATE_DELIMITER);
	return result;
};

//Use typechecking to catch errors
const LINK_ICON_NAME : IconName = 'LINK_ICON';

export const HTML_FORMATTERS : CardFieldHTMLFormatterConfigurationMap = {
	'title_alternates': titleAlternatesHTMLFormatter,
	'external_link': (input : string) => {
		return `<card-link href=${input} iconname="${LINK_ICON_NAME}">External Link</card-link>`;
	},
};

const bodyValidator = (body : string, cardType : CardType, config : CardFieldTypeConfiguration) : string => {
	if (cardType != 'quote') return '';
	const plainContent = innerTextForHTML(body).trim();
	if (plainContent.startsWith('"') || plainContent.startsWith('\'')) {
		return 'Quote cards should not contain their quoted content in quotes.';
	}
	const ele = elementForHTML(body);
	const err = validateTopLevelNodes(ele, config.overrideLegalTopLevelNodes?.[cardType], true);
	if (err) return err;
	if (config.overrideLegalTopLevelNodes && config.overrideLegalTopLevelNodes[cardType]) {
		//TODO: really this behavior is just hyper-specialized for validating
		//body-for-quote cards. Should it be a separate config line?

		//Verify that all of the content within the blockquote is also wrapped in paragraphs.
		for (const child of ele.children) {
			if (!(child instanceof HTMLElement)) continue;
			const err = validateTopLevelNodes(child, undefined, true);
			if (err) return err;
		}
	}

	return '';
};

export const FIELD_VALIDATORS : CardFieldValidatorConfigurationMap = {
	'body': bodyValidator,
	'external_link': (input) => {
		return !input || isURL(input) ? '' : `${input} is not a valid url`;
	},
};

export const BACKPORT_TITLE_EXTRACTORS : CardTypeBackportTitleExtractorConfigurationMap = {
	'work': (rawCard, _, rawCards) => {
		const authors : string[] = [];
		for (const otherID of (references(rawCard).byTypeArray()['citation-person'] || [])) {
			const otherCard = rawCards[otherID];
			if (!otherCard) continue;
			authors.push(getCardTitleForBackporting(otherCard, 'citation-person', rawCards));
		}
		return rawCard.title + '\n' + authors.join('\n');
	}
};

export const getCardTitleForBackporting = (rawCard : Card, referenceType : ReferenceType, rawCards : Cards) : string => {
	const backporter = BACKPORT_TITLE_EXTRACTORS[rawCard.card_type];
	if (backporter) {
		return backporter(rawCard, referenceType, rawCards);
	}
	return rawCard.title;
};

const AUTO_FONT_SIZE_BOOST_FIELDS_FOR_CARD_TYPE : {[cardType in CardType]+?: {[fieldType in CardFieldTypeEditable]+?: true}} = Object.fromEntries(TypedObject.keys(CARD_TYPE_CONFIGURATION).map(typ => {
	return [typ, Object.fromEntries(TypedObject.entries(TEXT_FIELD_CONFIGURATION).filter(entry => entry[1].autoFontSizeBoostForCardTypes ? entry[1].autoFontSizeBoostForCardTypes[typ] : false).map(entry => [entry[0], true]))];
}));

//Returns an object with field -> boosts to set. It will return
//card.font_size_boosts if no change, or an object like font_size_boosts, but
//with modifications made as appropriate leaving any untouched keys the same,
//and any keys it modifies but sets to 0.0 deleted. It checks the diff to see
//which fields are modified, so it can avoid resizing fields that were not modified.
export const fontSizeBoosts = async (card : Card, diff? : CardDiff) : Promise<FontSizeBoostMap> => {
	if (!card) return {};
	const fields = AUTO_FONT_SIZE_BOOST_FIELDS_FOR_CARD_TYPE[card.card_type] || {};
	const currentBoost = card.font_size_boost || {};
	if (Object.keys(fields).length === 0) return currentBoost;
	const result : FontSizeBoostMap = {...currentBoost};
	for (const field of TypedObject.keys(fields)) {
		//Skip fields that weren't modified.
		if (diff && diff[field] === undefined) continue;
		const boost = await calculateBoostForCardField(card, field);
		if (boost == 0.0) {
			if (result[field] !== undefined) delete result[field];
			continue;
		}
		result[field] = boost;
	}
	return result;
};

type CardRendererProvider = {
	sizingCardRenderer : CardRenderer
}

let cardRendererProvider : CardRendererProvider | null = null;

//Custom elements that have a sizing card-renderer should all this to offer
//themselves up. This module can't create its own card-renderer because a)
//importing card-renderer leads to a circular dependency, but also because the
//card-renderer has to be within the main web app to get the right css vars so
//it can size accurately. provider should hae a sizingCardRenderer property we
//can fetch an instance of card-renderer from that we may inject our own card
//into.
export const setFontSizingCardRendererProvider = (provider : CardRendererProvider) => {
	if (!cardRendererProvider) cardRendererProvider = provider;
};

const MAX_FONT_BOOST_BISECT_STEPS = 3;

//calculateBoostForCardField is an expensive method because it repeatedly
//changes layout and then reads it back. But even with that, it typically takes
//less than 15ms or so on a normal computer.
const calculateBoostForCardField = async (card : Card, field : CardFieldTypeEditable) : Promise<number> => {

	const config = TEXT_FIELD_CONFIGURATION[field].autoFontSizeBoostForCardTypes;

	if (!config) throw new Error('no config');

	const max = config[card.card_type] || 0;
	let low = 0.0;
	let high = max;
	let alwaysLow = true;
	let alwaysHigh = true;

	let middle = ((high - low) / 2) + low;
	let count = 0;
	while (count < MAX_FONT_BOOST_BISECT_STEPS) {
		const overflows = await cardOverflowsFieldForBoost(card, field, middle);
		if (overflows) {
			high = middle;
			alwaysHigh = false;
		} else {
			low = middle;
			alwaysLow = false;
		}
		middle = ((high - low) / 2) + low;
		count++;
	}
	//No matter where we stopped, the value of middle might now overflow (even
	//if there had been no overflows yet). Check one more time. If it does
	//overflow, round down.
	const overflows = await cardOverflowsFieldForBoost(card, field, middle);
	if (overflows) {
		middle = low;
		alwaysHigh = false;
	}

	//Check if it should return the extremes
	if (alwaysHigh && !await cardOverflowsFieldForBoost(card, field, max)) return max;
	if (alwaysLow && await cardOverflowsFieldForBoost(card, field, 0.0)) return 0.0;

	return middle;
};

const cardOverflowsFieldForBoost = async (card : Card, field : CardFieldTypeEditable, proposedBoost : number) : Promise<boolean> => {
	if (!cardRendererProvider) {
		console.warn('No card renderer provider provided');
		return false;
	}
	const ele = cardRendererProvider.sizingCardRenderer;
	if (!ele) {
		console.warn('No active card renderer');
		return false;
	}
	const tempCard : ProcessedCard = {...EMPTY_PROCESSED_CARD, ...card, font_size_boost: {...card.font_size_boost, [field]:proposedBoost}};
	ele.card = tempCard;
	await ele.updateComplete;
	const isOverflowing = ele.isOverflowing();
	return isOverflowing;
};