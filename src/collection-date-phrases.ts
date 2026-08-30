//DATES ARE THE ONE FAMILY PEOPLE TYPE AS A PHRASE.
//
//Every other clause in this product has a NAME — a tag, a section, a person, a
//card type — and typing part of that name finds it. A date does not: nobody
//types 'updated/after/7-days-ago', and nobody types the family name 'updated'
//either. They type "last 7 days", or "stuff from this month", or "created since
//2024". Before this module those phrases fell all the way through the ranking to
//`Text contains "last 7 days"`, which is a search over card prose for the words
//'last' and 'days' — a confident, useless answer to a question the app can
//actually answer exactly.
//
//A RULE-BASED GRAMMAR, NOT FUZZY NLP. Every production below is a regular
//expression over a normalized token list, every one of them names itself, and
//the whole table is exercised by a fixture in test/collection-date-phrases. The
//parser is PURE: it takes the phrase and the reference date, and it has no other
//inputs. Two consequences that are the reason it is built this way — the same
//phrase always parses to the same clause, and a fixture row is a specification
//rather than an observation.
//
//THE GRAMMAR
//
//    PHRASE   := NOISE* FIELD? NOISE* WINDOW NOISE*
//    FIELD    := 'updated' | 'modified' | 'changed' | 'edited'      -> updated
//              | 'created' | 'added' | 'made'                       -> created
//    NOISE    := 'in' | 'the' | 'from' | 'within' | 'over'
//              | 'during' | 'on' | 'at' | 'card' | 'cards'
//    WINDOW   := ('last'|'past') COUNT UNIT      -> after/<count><unit>-ago
//              | ('last'|'past') UNIT            -> after/1<unit>-ago
//              | 'this' ('month'|'year')         -> after/<start of period>
//              | 'today'                         -> after/today
//              | 'yesterday'                     -> between/yesterday/today
//              | 'since' MOMENT                  -> after/MOMENT
//              | ('before'|'until') MOMENT       -> before/MOMENT
//    UNIT     := 'day' | 'week' | 'month' | 'year' (plural accepted)
//    MOMENT   := YEAR (4 digits)                 -> <year>-1-1
//              | ('last'|'past') COUNT? UNIT     -> the same relative token
//              | 'today' | 'yesterday'
//
//WEEKS ARE NORMALIZED TO DAYS. '1-week-ago' and '7-days-ago' resolve to the
//identical instant in the app's own relative-date resolver, so spelling weeks as
//weeks would produce a SECOND clause meaning exactly what the corpus's own
//seeded 'Updated since 7 days ago' candidate means — two rows, one collection,
//different names. Normalizing makes 'past week' and 'last 7 days' the same row,
//which is also the honest thing to tell the user.
//
//WHEN THE PHRASE NAMES THE FIELD, ONLY THAT FIELD. 'created this month' offers
//exactly one candidate. When it does not, both are offered with `updated` first:
//in a corpus of working notes "when did this change" is asked far more often
//than "when did this begin", and the composer's own seeded date candidates are
//both `updated` for the same reason.
//
//CALENDAR ANCHORS ARE SPELLED THE WAY THE APP SPELLS ABSOLUTE DATES —
//`YYYY-M-D`, unpadded, exactly what `makeDateSection` in filters.ts writes and
//what `parseDateSection` reads back as a LOCAL date. An ISO-padded string would
//be parsed as UTC by the same code and land the boundary in the wrong day for
//most of the world.

//The two date families a phrase can name. `last-tweeted` is deliberately absent:
//no ordinary phrase means it, and offering it for every date phrase would put a
//clause nobody asked for in a list whose whole promise is that the top row is
//what you meant.
export const DATE_PHRASE_FAMILIES = ['updated', 'created'] as const;

export type DatePhraseFamily = typeof DATE_PHRASE_FAMILIES[number];

export type DatePhraseParse = {
	//The production that fired, named. The fixture table asserts on this, so a
	//phrase that starts being handled by a different rule is a visible change
	//rather than a silent one.
	rule : string;
	//The clause tail: everything after the family name, e.g. 'after/7-days-ago'.
	clause : string;
	//Which families to offer, in the order to offer them.
	families : readonly DatePhraseFamily[];
};

const FIELD_WORDS : Readonly<Record<string, DatePhraseFamily>> = {
	'updated': 'updated',
	'update': 'updated',
	'modified': 'updated',
	'changed': 'updated',
	'edited': 'updated',
	'touched': 'updated',
	'created': 'created',
	'added': 'created',
	'made': 'created',
	'written': 'created',
};

const NOISE_WORDS : ReadonlySet<string> = new Set([
	'in', 'the', 'from', 'within', 'over', 'during', 'on', 'at', 'a', 'an',
	'card', 'cards', 'stuff', 'anything', 'things',
]);

const UNIT_WORDS : Readonly<Record<string, string>> = {
	'day': 'day', 'days': 'day',
	'week': 'week', 'weeks': 'week',
	'month': 'month', 'months': 'month',
	'year': 'year', 'years': 'year',
	'fortnight': 'fortnight', 'fortnights': 'fortnight',
};

const NUMBER_WORDS : Readonly<Record<string, number>> = {
	'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
	'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'twelve': 12, 'thirty': 30,
	'couple': 2, 'few': 3,
};

//A window bigger than this is not a window. 'last 900 days' is not a phrase
//anybody means, and an unbounded count is an unbounded string in a URL.
const MAXIMUM_WINDOW_COUNT = 999;

//The app's own spelling for an absolute date (filters.ts makeDateSection).
const absoluteDate = (year : number, month : number, day : number) : string => `${year}-${month}-${day}`;

//A relative token in the app's own grammar (relative-date.ts parseRelativeDate),
//with weeks and fortnights folded into days — see the note above.
const relativeToken = (count : number, unit : string) : string => {
	if (unit === 'week') return `${count * 7}-days-ago`;
	if (unit === 'fortnight') return `${count * 14}-days-ago`;
	return `${count}-${unit}${count === 1 ? '' : 's'}-ago`;
};

const tokenize = (raw : string) : string[] =>
	raw.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter(Boolean);

const countAt = (word : string) : number => {
	if (word === undefined) return NaN;
	if (NUMBER_WORDS[word] !== undefined) return NUMBER_WORDS[word];
	if (/^\d{1,3}$/.test(word)) return Number(word);
	return NaN;
};

//A MOMENT: the right-hand side of 'since' or 'before'. Returns the date token
//the filter grammar wants, or '' when the words are not a moment.
const momentToken = (words : readonly string[], now : Date) : string => {
	if (!words.length) return '';
	if (words.length === 1) {
		if (words[0] === 'today') return 'today';
		if (words[0] === 'yesterday') return 'yesterday';
		//A bare four-digit year means its first day. 'since 2024' is the phrase
		//the task names; 'since 1970' is the same rule and equally honest.
		if (/^\d{4}$/.test(words[0])) return absoluteDate(Number(words[0]), 1, 1);
		//A bare unit after 'since' means one of it: 'since last week' arrives
		//here as ['last','week'] rather than as one word, so this branch is only
		//'since week', which is not a phrase. Decline.
		return '';
	}
	if (words[0] === 'last' || words[0] === 'past') {
		const rest = words.slice(1);
		const explicit = countAt(rest[0]);
		const unitWord = Number.isNaN(explicit) ? rest[0] : rest[1];
		const unit = UNIT_WORDS[unitWord];
		if (!unit) return '';
		if (rest.length > (Number.isNaN(explicit) ? 1 : 2)) return '';
		const count = Number.isNaN(explicit) ? 1 : explicit;
		if (count < 1 || count > MAXIMUM_WINDOW_COUNT) return '';
		return relativeToken(count, unit);
	}
	//'2024 01 15' — an absolute date the user spelled out. Accepted because the
	//app's own compiled paths contain exactly this shape, so somebody who has
	//looked at one will type it.
	if (words.length === 3 && /^\d{4}$/.test(words[0]) && /^\d{1,2}$/.test(words[1]) && /^\d{1,2}$/.test(words[2])) {
		const month = Number(words[1]);
		const day = Number(words[2]);
		if (month < 1 || month > 12 || day < 1 || day > 31) return '';
		return absoluteDate(Number(words[0]), month, day);
	}
	void now;
	return '';
};

//THE WINDOW PRODUCTIONS, tried in order. Each returns the clause tail and the
//name of the rule that produced it.
const parseWindow = (words : readonly string[], now : Date) : {rule : string, clause : string} | null => {
	if (!words.length) return null;

	//('last'|'past') COUNT? UNIT
	if (words[0] === 'last' || words[0] === 'past') {
		const token = momentToken(words, now);
		if (token) return {rule: 'rolling-window', clause: `after/${token}`};
		return null;
	}

	//'this' ('month'|'year')
	if (words[0] === 'this' && words.length === 2) {
		if (words[1] === 'month') {
			return {rule: 'this-month', clause: `after/${absoluteDate(now.getFullYear(), now.getMonth() + 1, 1)}`};
		}
		if (words[1] === 'year') {
			return {rule: 'this-year', clause: `after/${absoluteDate(now.getFullYear(), 1, 1)}`};
		}
		return null;
	}

	if (words.length === 1 && words[0] === 'today') return {rule: 'today', clause: 'after/today'};
	//YESTERDAY IS A DAY, NOT A BOUNDARY. 'after/yesterday' would keep everything
	//touched today as well, which is not what the word means — so the one phrase
	//that names a closed day compiles to the closed range the engine already has
	//a spelling for.
	if (words.length === 1 && words[0] === 'yesterday') return {rule: 'yesterday', clause: 'between/yesterday/today'};

	if (words[0] === 'since' || words[0] === 'after') {
		const token = momentToken(words.slice(1), now);
		if (token) return {rule: `${words[0]}-moment`, clause: `after/${token}`};
		return null;
	}
	if (words[0] === 'before' || words[0] === 'until' || words[0] === 'prior') {
		const rest = words[0] === 'prior' && words[1] === 'to' ? words.slice(2) : words.slice(1);
		const token = momentToken(rest, now);
		if (token) return {rule: 'before-moment', clause: `before/${token}`};
		return null;
	}

	//A BARE WINDOW: 'week', '7 days'. Only with an explicit count, because a
	//bare unit word is far more likely to be a tag or a section than a date
	//phrase, and this parser ranks at the TOP of the list when it fires.
	const explicit = countAt(words[0]);
	if (!Number.isNaN(explicit) && words.length === 2) {
		const unit = UNIT_WORDS[words[1]];
		if (unit && explicit >= 1 && explicit <= MAXIMUM_WINDOW_COUNT) {
			return {rule: 'bare-window', clause: `after/${relativeToken(explicit, unit)}`};
		}
	}

	return null;
};

//THE ENTRY POINT. Returns null for anything that is not a date phrase, which is
//the overwhelmingly common case and must therefore be cheap: the tokenizer runs,
//and the first production that cannot match returns immediately.
export const parseCollectionDatePhrase = (raw : string, now : Date = new Date()) : DatePhraseParse | null => {
	const tokens = tokenize(raw);
	if (!tokens.length) return null;

	//FIELD, if the phrase names one — anywhere in the phrase, because 'created
	//this month' and 'cards created last week' and 'this month created' are the
	//same request. Exactly one field word: two of them is not a phrase this
	//grammar models.
	let family : DatePhraseFamily | null = null;
	let fieldCount = 0;
	const remaining : string[] = [];
	for (const token of tokens) {
		const field = FIELD_WORDS[token];
		if (field) {
			fieldCount++;
			family = field;
			continue;
		}
		if (NOISE_WORDS.has(token)) continue;
		remaining.push(token);
	}
	if (fieldCount > 1) return null;

	const window = parseWindow(remaining, now);
	if (!window) return null;

	return {
		rule: window.rule,
		clause: window.clause,
		families: family ? [family] : DATE_PHRASE_FAMILIES,
	};
};

//The filters a parse names, in the order to offer them. One call site, but it is
//the seam the completion index uses and it keeps the family/clause join in the
//module that owns both halves.
export const collectionDatePhraseFilters = (parse : DatePhraseParse) : string[] =>
	parse.families.map(family => `${family}/${parse.clause}`);
