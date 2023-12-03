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

export const convertToQuote = async (args: SuggestorArgs) : Promise<Suggestion[]> => {

	const {card, logger} = args;

	if (!ENABLE_CONVERT_TO_QUOTE) {
		logger.info('Covert to quote not enabled');
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

	//TODO: suggest converting card.

	//TODO: add a flag to note it was converted

	return [];

};
