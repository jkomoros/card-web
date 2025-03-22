import {
	newCardIDPlaceholder
} from '../../shared/card_fields.js';

import {
	PreparedQuery
} from '../nlp.js';

import {
	SuggestorArgs
} from '../suggestions.js';

import {
	TypedObject
} from '../../shared/typed_object.js';

import {
	CardDiff,
	ReferencesEntriesDiff,
	Suggestion,
	SuggestionDiff,
	SuggestionDiffCreateCard,
	CardID
} from '../types.js';

import {
	isURL
} from '../util.js';

import {
	cardPlainContent
} from '../../shared/util.js';

const CONVERT_TO_QUOTE_SUGGESTOR_VERSION = 0;

export const convertToQuote = async (args: SuggestorArgs) : Promise<Suggestion[]> => {

	const {type, card, cards, logger, aggressive} = args;

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

	let supportingCard : CardID = '';

	const referencesDiff : ReferencesEntriesDiff = [];
	const createCards : SuggestionDiffCreateCard[] = [];

	let workCardID : CardID = '';
	let personCardID : CardID = '';

	//See if we can find a workCardID.
	if (workURL) {
		logger.info(`Work URL: ${workURL}`);
		for (const [id, card] of TypedObject.entries(cards)) {
			if (card.card_type != 'work') continue;
			if (card.external_link != workURL) continue;
			//Found a match!
			logger.info(`Found a work card with external_link ${workURL}: ${workCardID}`);
			workCardID = id;
			break;
		}
	}

	if (personName) {
		logger.info(`Person: ${personName}`);
		//We're going to iterate through cards ourselves to avoid expensive
		//filter machinery, but also so we can ask it to search only within
		//Title.
		//TODO: allow passing in a restriction to only title and do that.
		const query = new PreparedQuery(personName);
		let bestScore = Number.MIN_SAFE_INTEGER;
		for (const [id, card] of TypedObject.entries(cards)) {
			if (card.card_type != 'person') continue;
			const [score, fullMatch] = query.cardScore(card);
			if (!fullMatch) continue;
			if (score > bestScore) {
				bestScore = score;
				personCardID = id;
			}
		}
		if (personCardID) logger.info(`Found a person card with name: ${personName}: ${personCardID}`);
	}

	/*
		Now we have possibly set workURL, personName, and workCardID.
		We want to point to a work if it exists first, and then fall back on a person.
		And if we have neither, create a new work card if we have a workURL.
		And if we have neither and no workURL but do have a personName, then create a new person card.
	*/

	if (workURL && !workCardID && !personCardID) {
		logger.info(`No existing work card found with external_link ${workURL}. Will propose creating one.`);
		workCardID = newCardIDPlaceholder();
		createCards.push({
			card_type: 'work',
			//TODO: a better title.
			title: workURL,
			//Since we have a bad title, don't suggest a slug.
			autoSlug: false
		});
	}

	if (personName && !personCardID && !workURL) {
		logger.info(`Could not find a card for person: ${personName}. Will propose creating one.`);
		personCardID = newCardIDPlaceholder();
		createCards.push({
			card_type: 'person',
			title: personName,
			//Since we don't have confidence in the title, don't auto slug.
			autoSlug: false
		});
	}

	if (workCardID) {
		supportingCard = workCardID;
		referencesDiff.push({
			cardID: workCardID,
			referenceType: 'citation',
			value: ''
		});
	}

	if (personCardID && !workCardID) {
		supportingCard = personCardID;
		referencesDiff.push({
			cardID: personCardID,
			referenceType: 'citation-person',
			value: ''
		});
	}

	//TODO: allow an ack action to not convert quote

	const body = quoteLines.map(info => {
		return `${info.startsQuote ? '<blockquote>' : ''}<p>${info.line}</p>${info.endsQuote ? '</blockquote>' : ''}`;
	}).join('\n');

	const commentary = commentaryLines.map(line => `<p>${line}</p>`).join('\n');

	const keyCardDiff : CardDiff = {
		//TODO: note that cardFinishers are not run in this pipeline, so the title will still be the old one.
		card_type: 'quote',
		body,
		set_flags: {
			converted_by_suggestor: type,
			converted_by_suggestor_version: CONVERT_TO_QUOTE_SUGGESTOR_VERSION
		}
	};

	if (commentary) keyCardDiff.commentary = commentary;
	if (referencesDiff.length) keyCardDiff.references_diff = referencesDiff;

	const action : SuggestionDiff = {
		keyCards: keyCardDiff
	};

	if (createCards.length) action.createCard = createCards;

	return [{
		type,
		keyCards: [card.id],
		supportingCards: (supportingCard ? [supportingCard] : []),
		action
	}];

};
