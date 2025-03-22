import {
	TITLE_ALTERNATE_DELIMITER,
	TITLE_ALTERNATE_NEGATION
} from './card_fields.js';

import {
	CardFieldHTMLFormatter,
	CardFieldType
} from './types.js';

import {
	IconName
} from './types_simple.js';

export type CardFieldHTMLFormatterConfigurationMap = {
	[typ in CardFieldType]+?: CardFieldHTMLFormatter
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