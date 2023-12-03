import {
	SuggestorArgs
} from '../suggestions.js';

import {
	Suggestion
} from '../types.js';

import {
	cardPlainContent
} from '../util.js';

//TODO: once this is reliably suggesting changes, flip to true and then remove flag.
const ENABLE_CONVERT_TO_QUOTE = false;

const CONVERT_TO_QUOTE_SUGGESTOR_VERSION = 0;

export const convertToQuote = async (args: SuggestorArgs) : Promise<Suggestion[]> => {

	const {type, card, logger, aggressive} = args;

	if (!ENABLE_CONVERT_TO_QUOTE) {
		logger.info('Covert to quote not enabled');
		return [];
	}

	if (card.card_type == 'quote') {
		//TODO: are there other card types to skip, e.g. ones without a body?
		logger.info('Already a quote card');
		return [];
	}

	const plainContent = cardPlainContent(card);

	const lines = plainContent.split('\n');

	const quoteLines : string[] = [];
	const nonQuoteLines : string[] = [];

	for (let line of lines) {
		line = line.trim();
		if (line.startsWith('\'') || line.startsWith('"')) {
			line = line.slice(1);
			if (line.endsWith('\'') || line.endsWith('"')) line = line.slice(0, -1);
			quoteLines.push(line);
		} else {
			nonQuoteLines.push(line);
		}
	}

	logger.info(`Quote lines: ${JSON.stringify(quoteLines, null, '\t')}\nNon-quote lines: ${JSON.stringify(nonQuoteLines, null, '\t')}`);

	if (quoteLines.length == 0) {
		logger.info('No quote lines');
		return [];
	}

	if (nonQuoteLines.length == 0) {
		//TODO: in some cases you do want to suggest a quote even in this case.
		logger.info('There are no non-quote lines, so there\'s no one to attribute the quote to.');
		return [];
	}

	//If aggressive, then we only need a single quote line to suggest something.
	if (!aggressive && (quoteLines.length - nonQuoteLines.length) < 0) {
		logger.info('Fewer quote lines than non-quote lines and not aggressive');
		return [];
	}

	//TODO: allow an ack action to not convert quote

	//TODO: start a new block quote for any line that strated with a quote.
	const body = '<blockquote>' + quoteLines.map(line => `<p>${line}</p>`).join('\n') + '</blockquote>';

	//TODO: remove any lines that are entirely about a person or work citation.
	const commentary = nonQuoteLines.map(line => `<p>${line}</p>`).join('\n');

	//TODO: link to person or work (creating if necessary)

	return [{
		type,
		keyCards: [card.id],
		supportingCards: [],
		action: {
			keyCards: {
				card_type: 'quote',
				body,
				commentary,
				set_flags: {
					converted_by_suggestor: type,
					converted_by_suggestor_version: CONVERT_TO_QUOTE_SUGGESTOR_VERSION
				}
			}
		}
	}];

};
