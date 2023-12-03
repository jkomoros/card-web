import {
	SuggestorArgs
} from '../suggestions.js';

import {
	CardDiff,
	Suggestion
} from '../types.js';

import {
	cardPlainContent,
	isURL
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

	const quoteLines : {line: string, startsQuote: boolean, endsQuote: boolean}[] = [];
	const nonQuoteLines : string[] = [];

	let inQuote = false;

	for (let line of lines) {
		line = line.trim();
		let startsQuote = false;
		let endsQuote = false;
		if (line.startsWith('\'') || line.startsWith('"')) {
			startsQuote = true;
			line = line.slice(1);
		}
			
		if (line.endsWith('\'') || line.endsWith('"')) {
			endsQuote = true;
			line = line.slice(0, -1);
		}
		if (startsQuote || inQuote) {
			quoteLines.push({line, startsQuote, endsQuote});
			if (startsQuote) inQuote = true;
			if (endsQuote) inQuote = false;
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

	const commentaryLines : string[] = [];

	let workURL = '';
	let personName = '';

	for (const line of nonQuoteLines) {

		if (isURL(line)) {
			logger.info(`Found URL: ${line}`);
			workURL = line;
			continue;
		}

		const words = line.split(' ');

		if (words.length == 1 || words.length == 2) {
			//Likely a person, especially since we know it's not a URL.
			personName = line;
			continue;
		}

		commentaryLines.push(line);
	}

	//TODO: actually look for preexisting cards or suggest creating one.
	if (workURL) logger.info(`Work URL: ${workURL}`);
	if (personName) logger.info(`Person: ${personName}`);

	//TODO: allow an ack action to not convert quote

	const body = quoteLines.map(info => {
		return `${info.startsQuote ? '<blockquote>' : ''}<p>${info.line}</p>${info.endsQuote ? '</blockquote>' : ''}`;
	}).join('\n');

	const commentary = commentaryLines.map(line => `<p>${line}</p>`).join('\n');

	const keyCardDiff : CardDiff = {
		card_type: 'quote',
		body,
		set_flags: {
			converted_by_suggestor: type,
			converted_by_suggestor_version: CONVERT_TO_QUOTE_SUGGESTOR_VERSION
		}
	};

	if (commentary) keyCardDiff.commentary = commentary;

	return [{
		type,
		keyCards: [card.id],
		supportingCards: [],
		action: {
			keyCards: keyCardDiff
		}
	}];

};
