import {
	TITLE_ALTERNATE_DELIMITER,
	TITLE_ALTERNATE_NEGATION
} from './card_fields.js';

import {
	Card,
	CardFieldHTMLFormatter,
	CardFieldType,
	CardFieldTypeConfiguration,
	CardFieldValidator,
	Cards,
	CardType,
	CardTypeBackportTitleExtractor,
	ReferenceType
} from './types.js';

import {
	IconName
} from './types_simple.js';

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