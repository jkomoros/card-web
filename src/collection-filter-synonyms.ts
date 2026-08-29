//THE SEARCH METADATA THE COMPOSER'S PALETTE IS BET ON.
//
//The Native Sentence deletes the catalog as a place (meta-proposal, convergence
//5): the filter families stop being a wall you browse and become an index you
//type at. Every proposal that reached that conclusion also flagged the same
//risk in its self-critique — proposal B: "killing the catalog bets on search
//metadata quality"; proposal C: "'Browse all' is the same wall with less
//signage unless the one-line descriptions are excellent, and synonym metadata
//is only as good as its curation."
//
//This file is that curation, and it is deliberately DATA in ONE place so it can
//be reviewed as prose rather than read out of six call sites. Two tables:
//
//  FILTER_SYNONYMS            the words a person would actually type
//  FILTER_DESCRIPTION_COPY    the sentence they should read when they find it
//
//plus two DERIVATION rules for the two families the filter machinery generates
//mechanically (per reference type, per TODO). Those are ~90 of the ~200 filter
//names; hand-writing them would guarantee they rot out of sync with the
//reference-type and TODO registries, so they are derived from those registries'
//OWN user-facing names instead. Everything a human would actually reach for is
//hand-written below.
//
//THE RULE FOR A SYNONYM: it must be a word a user might type meaning THIS
//filter, not a word that merely appears near it. `stale` belongs to the updated
//family because "show me the stale cards" is a real sentence about it; `date`
//does not, because it would match every date family equally and rank noise
//above signal. Three is the floor (test/collection-filter-catalog asserts it),
//not the target.
//
//THE RULE FOR A DESCRIPTION: it is addressed to the person composing, it says
//what the clause KEEPS, and it never contains an internal identifier. The
//shipped registry violates that in three systematic ways this file repairs:
//`Inverse of <filter-id>` (synthesized for ~85 excluding filters), `Selects
//cards that are authored by the give user ID` (a typo plus a raw argument
//name), and `Whether the card…` (a sentence about a boolean field, not about a
//collection). The sweep is asserted, not just performed:
//test/collection-filter-catalog runs every name in the registry through the
//composer's description path and fails on any internal-identifier pattern.

import {
	INVERSE_FILTER_NAMES,
	REVERSE_CARD_FILTER_CONFIG_MAP,
	TODO_ALL_INFOS,
} from './filters.js';

import {
	REFERENCE_TYPES,
} from '../shared/card_fields.js';

import {
	ReferenceType,
} from '../shared/types.js';

//--- Synonyms --------------------------------------------------------------
//
//Grouped the way a reader would want to audit them, not the way the filter
//registry happens to be ordered. Each group's comment says what the group is
//for; each entry's words are lowercase because matching is case-folded and a
//capital here would only ever be decoration.

const READING_AND_ATTENTION_SYNONYMS : Record<string, string[]> = {
	//The personal shelf. These are the filters people reach for by mood
	//("what did I save?", "what haven't I got to?"), so the synonyms are moods.
	'starred': ['favorite', 'favourite', 'saved', 'star', 'bookmarked', 'liked'],
	'unstarred': ['not starred', 'unfavorited', 'not saved', 'no star'],
	'read': ['already read', 'seen', 'finished', 'done reading'],
	//'new' and 'to-read' are the two phrases the inbox metaphor supplies, and
	//neither is derivable from the word 'read'.
	'unread': ['new', 'to read', 'to-read', 'unseen', 'not read', 'inbox', 'backlog'],
	'in-reading-list': ['reading list', 'queue', 'saved for later', 'later'],
	'not-in-reading-list': ['not in reading list', 'off the reading list', 'not queued'],
	'selected': ['selection', 'picked', 'checked', 'highlighted'],
	'not-selected': ['not selected', 'unselected', 'not picked'],
};

const PUBLICATION_SYNONYMS : Record<string, string[]> = {
	//'pub' is the prefix flow ③ of proposal C names by hand ("aliases catch
	//'pub'"), and it is a prefix of 'published' so the name tier catches it —
	//these are the words that are NOT prefixes of the name.
	'published': ['public', 'live', 'shipped', 'visible to everyone'],
	'unpublished': ['draft', 'private', 'not public', 'unshipped', 'hidden'],
	'needs-to-be-published': ['ready to publish', 'publish me', 'wants publishing'],
	'orphaned': ['sectionless', 'no section', 'unfiled', 'loose'],
	'not-orphaned': ['filed', 'in a section', 'has a section'],
};

const CARD_TYPE_SYNONYMS : Record<string, string[]> = {
	//A card type is typed by its own name, so these are the OTHER words for the
	//same idea — what the type is FOR.
	'content': ['essay', 'article', 'prose card', 'main card'],
	'working-notes': ['notes', 'scratch', 'draft notes', 'thinking out loud', 'wip'],
	'section-head': ['section header', 'heading', 'divider', 'chapter'],
	'concept': ['idea', 'term', 'definition', 'vocabulary'],
	'person': ['people', 'author card', 'who', 'humans'],
	'work': ['book', 'paper', 'source', 'publication', 'citation target'],
	'quote': ['quotation', 'excerpt', 'passage', 'saying'],
	'not-content': ['not an essay', 'other than content'],
	'not-working-notes': ['not notes', 'not scratch'],
	'not-section-head': ['not a heading', 'not a divider'],
	'not-concept': ['not an idea', 'not a term'],
	'not-person': ['not a person', 'not people'],
	'not-work': ['not a book', 'not a source'],
	'not-quote': ['not a quotation', 'not an excerpt'],
};

const STRUCTURE_SYNONYMS : Record<string, string[]> = {
	//What the card is MADE of. 'thin'/'stub'/'empty' are how people describe a
	//card that has not been written yet, and none of them appear in the names.
	'has-content': ['written', 'has text', 'not empty', 'has words'],
	'no-content': ['empty', 'blank', 'stub', 'nothing written', 'placeholder'],
	'has-substantive-content': ['substantial', 'developed', 'fleshed out', 'real content'],
	'no-substantive-content': ['thin', 'skimpy', 'barely written', 'shallow', 'stub'],
	'has-body': ['has a body field', 'body', 'writable'],
	'no-body': ['no body field', 'bodyless'],
	'has-slug': ['has a url name', 'named url', 'slug', 'permalink'],
	'no-slug': ['no url name', 'unnamed url', 'missing slug', 'no permalink'],
	'has-tags': ['tagged', 'categorized', 'labeled'],
	'no-tags': ['untagged', 'uncategorized', 'unlabeled', 'no labels'],
	'has-images': ['illustrated', 'pictures', 'photos', 'visual'],
	'no-images': ['no pictures', 'text only', 'unillustrated'],
	'has-notes': ['annotated', 'has margin notes', 'notes field'],
	'no-notes': ['unannotated', 'no margin notes'],
	'has-comments': ['discussed', 'commented on', 'has a thread', 'conversation'],
	'no-comments': ['undiscussed', 'no thread', 'silent'],
	'has-prose': ['flowing prose', 'written up', 'paragraphs'],
	'no-prose': ['bullets', 'disjoint details', 'not written up'],
	'has-diagram': ['diagrammed', 'illustrated with a diagram', 'has a figure'],
	'no-diagram': ['undiagrammed', 'needs a picture', 'no figure'],
	'has-tweet': ['tweeted', 'posted', 'announced', 'shared'],
	'no-tweet': ['untweeted', 'never posted', 'unannounced'],
};

const CONNECTION_SYNONYMS : Record<string, string[]> = {
	//The graph. 'linked'/'related'/'connected' are the three words people
	//actually use for the same relationship, and the filter names use none of
	//them consistently.
	'has-links': ['linked', 'links out', 'outgoing links', 'connected out', 'references others'],
	'no-links': ['unlinked', 'dead end', 'no outgoing links', 'links nowhere'],
	'has-inbound-links': ['linked to', 'incoming links', 'cited', 'referenced by others', 'popular'],
	'no-inbound-links': ['orphan link', 'nothing links here', 'uncited', 'no incoming links'],
	'has-all-reciprocal-links': ['reciprocated', 'mutual links', 'links both ways'],
	'missing-reciprocal-links': ['unreciprocated', 'one way links', 'needs a link back', 'asymmetric'],
	'has-substantive-references': ['related', 'connected', 'meaningful references', 'real links'],
	'no-substantive-references': ['disconnected', 'unrelated', 'isolated', 'no real links'],
	'has-inbound-substantive-references': ['referenced', 'pointed at', 'meaningful inbound references'],
	'no-inbound-substantive-references': ['nothing points here', 'no meaningful inbound references'],
	'has-concept-references': ['uses concepts', 'linked to ideas', 'concept linked'],
	'no-concept-references': ['no concepts', 'conceptless', 'not linked to ideas'],
	'has-inbound-concept-references': ['used as a concept', 'ideas point here'],
	'no-inbound-concept-references': ['unused concept', 'no ideas point here'],
};

const CITATION_SYNONYMS : Record<string, string[]> = {
	'has-citations': ['cited properly', 'sourced', 'has sources'],
	'no-citations': ['uncited', 'unsourced', 'needs sources', 'missing citations'],
	'has-author-citation': ['credits its author', 'attributed', 'has a byline'],
	'no-author-citation': ['unattributed', 'missing byline', 'no author'],
	'has-quote-citation': ['sourced quote', 'attributed quote', 'has a source'],
	'no-quote-citation': ['unsourced quote', 'quote with no source'],
};

const CURATION_SYNONYMS : Record<string, string[]> = {
	//The grooming vocabulary. These filters exist to answer "what still needs
	//work?", so the synonyms are the words for work left over.
	'has-todo': ['todo', 'todos', 'unfinished', 'needs work', 'chores', 'open items'],
	'no-todo': ['finished', 'complete', 'done', 'nothing left', 'clean'],
	'has-freeform-todo': ['has a note to self', 'freeform todo', 'written todo', 'reminder'],
	//The polarity of this pair reads backwards from its name: `no-freeform-todo`
	//is the POSITIVE half in the inverse map, so it inherits no `not …` words
	//from the derivation and has to say its own.
	'no-freeform-todo': ['no note to self', 'no freeform todo', 'no reminder', 'nothing jotted down'],
	'not-automatically-prioritized': ['unprioritized', 'not important', 'ordinary'],
	'automatically-prioritized': ['important', 'priority', 'flagged as important', 'key cards'],
	'prioritized': ['marked priority', 'deliberately prioritized', 'important'],
	'not-prioritized': ['not a priority', 'deprioritized', 'ordinary'],
	'mined-for-content': ['mined', 'harvested', 'insights extracted', 'used up'],
	'not-mined-for-content': ['unmined', 'unharvested', 'still has insights', 'untapped'],
};

const SET_SYNONYMS : Record<string, string[]> = {
	'in-everything-set': ['everything', 'all cards', 'the whole corpus', 'no set filter'],
	'not-in-everything-set': ['outside everything', 'not in the corpus'],
	'in-all-set': ['main', 'the main set', 'sectioned cards', 'the ordered corpus'],
	'not-in-all-set': ['outside main', 'not in the main set'],
	'none': ['nothing', 'empty set', 'matches nothing', 'placeholder'],
	'all-cards': ['everything', 'all', 'no filter at all'],
};

const CONFIGURABLE_SYNONYMS : Record<string, string[]> = {
	//DATES. The inverse of `updated` has no name of its own, so the words for
	//"has NOT been updated" — stale, old, neglected — live on the family and
	//the palette's `not` valence carries them the rest of the way. That is why
	//typing 'stale' finds the updated family: it is the one honest home for the
	//word.
	'updated': ['recent', 'changed', 'modified', 'stale', 'fresh', 'edited', 'touched', 'old', 'neglected'],
	'created': ['new', 'added', 'written', 'started', 'age', 'born'],
	'last-tweeted': ['tweeted', 'posted', 'announced', 'shared', 'promoted'],
	//TEXT.
	'query': ['search', 'text', 'contains', 'find', 'words', 'mentions', 'about'],
	'query-strict': ['exact search', 'exact phrase', 'quoted search', 'literal text'],
	'about-concept': ['concept', 'idea', 'topic', 'subject', 'theme'],
	'missing-concept': ['missing concept', 'should reference', 'unlinked idea', 'suggested concept'],
	//PEOPLE.
	'author': ['by', 'wrote', 'written by', 'contributor', 'collaborator', 'who', 'mine', 'my cards'],
	//GRAPH. Every one of these is "connections" to somebody, so they share the
	//common words and are separated by direction words.
	'children': ['links to', 'outgoing', 'downstream one step', 'points at', 'linked from here'],
	'parents': ['links here', 'incoming', 'upstream one step', 'points at this', 'backlinks'],
	'direct-connections': ['linked', 'related', 'connected', 'neighbors', 'either direction'],
	'descendants': ['downstream', 'everything below', 'follows from', 'transitive links out'],
	'ancestors': ['upstream', 'everything above', 'leads to', 'transitive links in'],
	'connections': ['linked', 'related', 'reachable', 'network', 'neighborhood'],
	'references': ['linked', 'related', 'connected by type', 'typed links'],
	'references-inbound': ['upstream by type', 'cited by', 'typed backlinks'],
	'references-outbound': ['downstream by type', 'cites', 'typed forward links'],
	'direct-references': ['linked by type', 'one step by type', 'typed neighbors'],
	'direct-references-inbound': ['cited by', 'typed incoming', 'points at this by type'],
	'direct-references-outbound': ['cites', 'typed outgoing', 'points at by type'],
	//SIMILARITY.
	'similar': ['like this', 'related', 'nearby', 'resembles', 'closest'],
	'similar-cutoff': ['very similar', 'similarity threshold', 'closer than', 'strongly related'],
	'same-type': ['same kind', 'matching type', 'like this card type'],
	'different-type': ['other kinds', 'different kind', 'not this type'],
	//SPECIFIC CARDS AND SLICING.
	'cards': ['these cards', 'specific cards', 'this list', 'by id', 'handpicked'],
	'limit': ['first n', 'top', 'cap', 'only n', 'take'],
	'offset': ['skip', 'page', 'after the first n', 'drop'],
	//STRUCTURAL. Source-mode only, but still typeable, and the words people
	//reach for are the boolean words the UI otherwise never shows them.
	'exclude': ['not', 'without', 'except', 'invert', 'negate', 'minus'],
	'combine': ['or', 'either', 'union', 'any of', 'plus'],
	'expand': ['grow', 'widen', 'follow links out from', 'include connected'],
};

//THE ONE TABLE, assembled from the audit groups above. Splitting it for review
//and merging it for lookup means the file reads as prose and the lookup stays a
//single object access.
export const FILTER_SYNONYMS : Readonly<Record<string, readonly string[]>> = Object.freeze({
	...READING_AND_ATTENTION_SYNONYMS,
	...PUBLICATION_SYNONYMS,
	...CARD_TYPE_SYNONYMS,
	...STRUCTURE_SYNONYMS,
	...CONNECTION_SYNONYMS,
	...CITATION_SYNONYMS,
	...CURATION_SYNONYMS,
	...SET_SYNONYMS,
	...CONFIGURABLE_SYNONYMS,
});

//--- Derived synonyms for the machine-generated families --------------------

//`has-see-also-references` and its 55 siblings are generated per reference
//type, so their synonyms are generated per reference type too — out of
//REFERENCE_TYPES' own `name`, which is the string the card editor already shows
//for that type. A new reference type therefore arrives in the palette with
//working search words on the day it is defined, which is the only way this
//stays true.
const REFERENCE_FAMILY_PATTERN = /^(has|no)-(inbound-)?(.+)-references$/;

const referenceTypeWords = (type : string) : string[] => {
	const configuration = REFERENCE_TYPES[type as ReferenceType];
	const name = configuration ? configuration.name.toLowerCase() : type.split('-').join(' ');
	return [name, type.split('-').join(' ')];
};

const derivedReferenceSynonyms = (filter : string) : string[] => {
	const match = REFERENCE_FAMILY_PATTERN.exec(filter);
	if (!match) return [];
	const [, polarity, inbound, type] = match;
	const words = referenceTypeWords(type);
	const direction = inbound ? 'inbound' : 'outbound';
	const result : string[] = [];
	for (const word of words) {
		if (polarity === 'has') {
			result.push(`${word} references`, `${direction} ${word}`);
			result.push(inbound ? `cited by ${word}` : `cites by ${word}`);
		} else {
			result.push(`no ${word} references`, `without ${word}`, `missing ${word}`);
		}
	}
	return result;
};

//The TODO family is generated per card-filter config, and the config's own
//`title` (`Substantive Content`, `Reciprocal Links`) is what the editor's TODO
//list shows. Same argument as above: derive from the registry that owns the
//user-facing words.
const TODO_FAMILY_PATTERN = /^(needs|does-not-need)-(.+)$/;

const todoTitle = (filter : string) : string => {
	const key = REVERSE_CARD_FILTER_CONFIG_MAP[filter];
	const info = key ? TODO_ALL_INFOS[key] : undefined;
	return info ? info.title.toLowerCase() : '';
};

const derivedTodoSynonyms = (filter : string) : string[] => {
	const match = TODO_FAMILY_PATTERN.exec(filter);
	if (!match) return [];
	const title = todoTitle(filter) || match[2].split('-').join(' ');
	if (match[1] === 'needs') return [`needs ${title}`, `${title} todo`, `todo ${title}`, `missing ${title}`];
	return [`${title} done`, `no ${title} todo`, `skip ${title}`, `${title} not needed`];
};

//The last resort, and the reason the ≥3 floor is reachable for a filter nobody
//has curated yet: its own name, said as words, plus the negation words for a
//name the inverse map knows is a negation. Not good synonyms — findable ones.
const nameWords = (filter : string) : string[] => {
	const words = filter.split('/')[0].split('-').join(' ');
	const result = [words];
	const positive = INVERSE_FILTER_NAMES[filter];
	if (positive) {
		const positiveWords = positive.split('-').join(' ');
		result.push(`not ${positiveWords}`, `without ${positiveWords}`, `except ${positiveWords}`);
	}
	return result;
};

//filterSynonyms is THE lookup: curated words first (they rank best because they
//are what a person types), then the derived ones, then the name words, deduped
//and case-folded. Called with a whole clause (`updated/after/7-days-ago`) it
//answers for the clause's FAMILY, because that is the thing a synonym names.
export const filterSynonyms = (filter : string) : string[] => {
	const family = filter.split('/')[0];
	const seen = new Set<string>();
	const result : string[] = [];
	const push = (value : string) => {
		const normalized = value.trim().toLowerCase();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		result.push(normalized);
	};
	for (const value of FILTER_SYNONYMS[family] || []) push(value);
	for (const value of derivedReferenceSynonyms(family)) push(value);
	for (const value of derivedTodoSynonyms(family)) push(value);
	for (const value of nameWords(family)) push(value);
	return result;
};

//--- Descriptions ----------------------------------------------------------
//
//USER-VOICED MEANS: second person or none, present tense, says what the
//resulting collection CONTAINS, and names no identifier the URL happens to use.
//An override here wins over the registry's own sentence, which is why the
//registry's `Whether the card…` boolean-field voice can be repaired without
//touching filters.ts's own test surface (the configurable descriptions are
//asserted against the ENGINE by test/collection-filter-catalog and must keep
//their direction words).

const READING_AND_ATTENTION_COPY : Record<string, string> = {
	'starred': 'Cards you have starred. Only you see your own stars, so a shared link shows the reader theirs.',
	//Deliberately not "not starred": the row that shows this sentence may be the
	//excluding half of the pair, and naming the including half's own filter id
	//in it is the leak the catalog's polarity test watches for.
	'unstarred': 'Cards you have never marked with a star.',
	'read': 'Cards you have already marked as read.',
	'unread': 'Cards you have not read yet — your unread pile.',
	'in-reading-list': 'Cards on your reading list.',
	'not-in-reading-list': 'Cards that are not on your reading list.',
	'selected': 'The cards currently selected on screen. Change the selection to change what this keeps.',
	'not-selected': 'Every card except the ones currently selected on screen.',
	'none': 'Keeps no cards at all. The app uses this as a placeholder while a link resolves.',
	'all-cards': 'Keeps every card, filtering nothing out.',
};

const SET_COPY : Record<string, string> = {
	'in-everything-set': 'Cards in the Everything set — the whole corpus, in no particular order.',
	'not-in-everything-set': 'Cards outside the Everything set.',
	'in-all-set': 'Cards in the Main set — the ones filed into a section, in their section order.',
	'not-in-all-set': 'Cards outside the Main set.',
};

const PUBLICATION_COPY : Record<string, string> = {
	'published': 'Cards you have published for anyone to read.',
	'unpublished': 'Cards that are still drafts, visible only to people who can edit them.',
	'orphaned': 'Cards that are not filed into any section.',
	'not-orphaned': 'Cards that are filed into a section.',
};

const CARD_TYPE_COPY : Record<string, string> = {
	'content': 'Content cards — the ordinary written cards that make up most of the corpus.',
	'not-content': 'Every card that is not an ordinary content card.',
	'working-notes': 'Working notes — the informal cards you think out loud in.',
	'not-working-notes': 'Every card that is not a working note.',
	'section-head': 'Section heads — the cards that introduce a section.',
	'not-section-head': 'Every card that is not a section head.',
	'concept': 'Concept cards — the ones that define a term the rest of the corpus uses.',
	'not-concept': 'Every card that does not define a concept.',
	'person': 'Person cards — one per human the corpus talks about.',
	'not-person': 'Every card that is not about a person.',
	'work': 'Work cards — books, papers, and other things the corpus cites.',
	'not-work': 'Every card that is not a cited work.',
	'quote': 'Quote cards — a passage from somewhere else, kept whole.',
	'not-quote': 'Every card that is not a quote.',
};

const STRUCTURE_COPY : Record<string, string> = {
	'has-content': 'Cards with something written in them.',
	'no-content': 'Cards with nothing written in them yet.',
	'has-substantive-content': 'Cards written out past a bare minimum.',
	'no-substantive-content': 'Cards with only a line or two — still stubs.',
	'has-body': 'Cards of a type that can hold body text at all.',
	'no-body': 'Cards of a type that holds no body text.',
	'has-slug': 'Cards with a readable name in their URL.',
	'no-slug': 'Cards that still show up under a generated id instead of a readable name.',
	'has-tags': 'Cards with at least one tag on them.',
	'no-tags': 'Cards with no tags at all.',
	'has-images': 'Cards with at least one image.',
	'no-images': 'Cards with no images.',
	'has-notes': 'Cards with something in their notes field.',
	'no-notes': 'Cards with an empty notes field.',
	'has-comments': 'Cards somebody has commented on.',
	'no-comments': 'Cards nobody has commented on.',
	'has-prose': 'Cards flagged as still needing to become flowing prose rather than loose details.',
	'no-prose': 'Cards whose details have already been written up as prose, or never needed to be.',
	'has-diagram': 'Cards flagged as needing a diagram drawn or redrawn.',
	'no-diagram': 'Cards that need no diagram work.',
	'has-tweet': 'Cards the bot has tweeted at least once.',
	'no-tweet': 'Cards the bot has never tweeted.',
};

const CONNECTION_COPY : Record<string, string> = {
	'has-links': 'Cards that link out to at least one other card.',
	'no-links': 'Cards that link nowhere — dead ends.',
	'has-inbound-links': 'Cards that at least one other card links to.',
	'no-inbound-links': 'Cards nothing else links to.',
	'has-all-reciprocal-links': 'Cards where every link in has a matching link back out.',
	'missing-reciprocal-links': 'Cards linked to by something they do not link back to.',
	'has-substantive-references': 'Cards connected to something else by a reference that carries meaning.',
	'no-substantive-references': 'Cards with no meaningful connections out.',
	'has-inbound-substantive-references': 'Cards something else points at with a meaningful reference.',
	'no-inbound-substantive-references': 'Cards nothing points at meaningfully.',
	'has-concept-references': 'Cards that reference at least one concept card.',
	'no-concept-references': 'Cards that reference no concepts.',
	'has-inbound-concept-references': 'Concept cards that something else actually uses.',
	'no-inbound-concept-references': 'Cards nothing references as a concept.',
};

const CITATION_COPY : Record<string, string> = {
	'has-citations': 'Cards flagged as needing their citations formally represented.',
	'no-citations': 'Cards whose citations are already represented, or that need none.',
	'has-author-citation': 'Work cards that name their author.',
	'no-author-citation': 'Work cards with no author named.',
	'has-quote-citation': 'Quote cards that say where the quote came from.',
	'no-quote-citation': 'Quote cards with no source named.',
};

const CURATION_COPY : Record<string, string> = {
	'has-todo': 'Cards with at least one unfinished TODO.',
	'no-todo': 'Cards with nothing left to do.',
	'has-freeform-todo': 'Cards with a note to yourself in their freeform TODO field.',
	'no-freeform-todo': 'Cards with an empty freeform TODO field.',
	'not-automatically-prioritized': 'Cards not marked as a priority to develop.',
	'automatically-prioritized': 'Cards marked as a priority to develop, because they talk about important topics.',
	'mined-for-content': 'Working notes whose insights have already been moved into other cards.',
	'not-mined-for-content': 'Working notes whose insights are still only here.',
};

//THE CONFIGURABLE FAMILIES. These are named by their family in the palette
//(their values come later, through the argument editor), so the sentence has to
//describe the SHAPE of the question, not one answer to it. `author` is the
//worst offender in the shipped registry — "Selects cards that are authored by
//the give user ID" is a typo wrapped around a raw argument name — and it is
//the reason the internal-identifier sweep exists as a test.
const CONFIGURABLE_COPY : Record<string, string> = {
	'updated': 'Cards changed inside a date window you choose — recently updated, or, flipped, gone stale since a date.',
	'created': 'Cards first written inside a date window you choose.',
	'last-tweeted': 'Cards the bot tweeted inside a date window you choose.',
	'author': 'Cards a particular person wrote or collaborated on. Choose yourself and a shared link follows whoever opens it; choose a name and it stays that person.',
	'query': 'Cards whose text matches what you type, including cards that match only some of the words.',
	'query-strict': 'Cards whose text contains exactly the phrase you type.',
	'about-concept': 'Cards that reference a concept you name.',
	'missing-concept': 'Cards that talk about a concept but never reference its card.',
	'cards': 'A precise handful of cards you pick by name.',
	'limit': 'Only the first few cards, however the collection is sorted. One limit per collection.',
	'offset': 'Skips the first few cards, so a limit after it reads as the next page.',
	'similar': 'Cards that read like a card you pick, closest first.',
	'similar-cutoff': 'Cards that read like a card you pick, but only those above a closeness you set.',
	'same-type': 'Cards of the same kind as a card you pick.',
	'different-type': 'Cards of a different kind from a card you pick.',
	'exclude': 'Everything a nested condition does not keep. The palette spells this as flipping a condition; you only meet the word in source.',
	'combine': 'Everything either of two nested conditions keeps. The palette spells this as an “or” inside one condition.',
	'expand': 'Starts from a nested condition and then grows the result along a kind of connection you choose.',
};

//The graph families keep the DIRECTION words their engine-checked descriptions
//already establish (test/collection-filter-catalog runs each of these filters
//against a two-card corpus and requires the sentence to name the direction the
//filter actually walks). These rewrites say the same directions in the
//composer's voice, and the same test guards them.
const GRAPH_COPY : Record<string, string> = {
	'children': 'Cards that the key card references — one step downstream of what it references.',
	'parents': 'Cards that reference the key card — one step upstream of what references it.',
	'direct-connections': 'Cards one step away from the key card in either direction.',
	'descendants': 'Everything downstream of the key card: what it references, what those reference, out to a number of steps you set.',
	'ancestors': 'Everything upstream of the key card: what references it, what references those, out to a number of steps you set.',
	'connections': 'Everything reachable from the key card in either direction, out to a number of steps you set.',
	'direct-references': 'Cards one step from the key card in either direction, through a reference type you choose.',
	'direct-references-inbound': 'Cards that reference the key card through a reference type you choose.',
	'direct-references-outbound': 'Cards referenced by the key card through a reference type you choose.',
	'references': 'Cards connected to the key card in either direction through a reference type you choose, out to a number of steps.',
	'references-inbound': 'Everything upstream of the key card through a reference type you choose: what references it that way, what references those, and onward.',
	'references-outbound': 'Everything downstream of the key card through a reference type you choose: what it references that way, what those reference, and onward.',
};

export const FILTER_DESCRIPTION_COPY : Readonly<Record<string, string>> = Object.freeze({
	...READING_AND_ATTENTION_COPY,
	...SET_COPY,
	...PUBLICATION_COPY,
	...CARD_TYPE_COPY,
	...STRUCTURE_COPY,
	...CONNECTION_COPY,
	...CITATION_COPY,
	...CURATION_COPY,
	...CONFIGURABLE_COPY,
	...GRAPH_COPY,
});

//The two machine-generated families get machine-generated sentences, for the
//same reason they get machine-generated synonyms: a new reference type or TODO
//must not be able to ship with `Inverse of <id>` as its only description.
const derivedReferenceDescription = (filter : string) : string => {
	const match = REFERENCE_FAMILY_PATTERN.exec(filter);
	if (!match) return '';
	const [, polarity, inbound, type] = match;
	const configuration = REFERENCE_TYPES[type as ReferenceType];
	if (!configuration) return '';
	const name = configuration.name.toLowerCase();
	if (polarity === 'has') {
		return inbound ?
			`Cards that another card points at with a ${name} reference.` :
			`Cards that point at another card with a ${name} reference.`;
	}
	return inbound ?
		`Cards that nothing points at with a ${name} reference.` :
		`Cards that point at nothing with a ${name} reference.`;
};

const derivedTodoDescription = (filter : string) : string => {
	const match = TODO_FAMILY_PATTERN.exec(filter);
	if (!match) return '';
	const title = todoTitle(filter);
	if (!title) return '';
	if (match[1] === 'needs') return `Cards that still have the ${title} TODO open.`;
	return `Cards marked as not needing the ${title} TODO.`;
};

//curatedFilterDescription is the override collectionFilterDescription consults
//BEFORE the registry's own sentence. It answers '' for a filter this file has
//nothing better to say about, which is the caller's cue to keep what it had.
export const curatedFilterDescription = (filter : string) : string => {
	const authored = FILTER_DESCRIPTION_COPY[filter];
	if (authored) return authored;
	const reference = derivedReferenceDescription(filter);
	if (reference) return reference;
	return derivedTodoDescription(filter);
};

//--- The rot guard ---------------------------------------------------------

//THE PATTERNS THAT MEAN A SENTENCE IS NOT ADDRESSED TO A USER. Each one is a
//shape the shipped registry actually contained, named so a failure says which
//defect came back rather than only that something matched.
export const INTERNAL_IDENTIFIER_PATTERNS : ReadonlyArray<{name : string, pattern : RegExp}> = Object.freeze([
	//'Inverse of has-todo' — a raw filter id pointed at a reader.
	{name: 'synthesized inverse', pattern: /\bInverse of\b/},
	//'the give user ID' — a typo plus the argument's internal type name.
	{name: 'raw argument identifier', pattern: /\bthe give\b|\buser ID\b/i},
	//'Inverts a sub-filter expression' — the engine's word for a nested
	//condition, which the composer promises never to show.
	{name: 'engine vocabulary', pattern: /\bsub-filter\b|\bsub expression\b/i},
	//'A filter equivalent of the set everything' — describes the plumbing.
	{name: 'plumbing description', pattern: /\bfilter equivalent of the set\b/i},
	//'Whether the card has a slug set' — a sentence about a boolean field
	//rather than about the cards the clause keeps.
	{name: 'boolean-field voice', pattern: /^Whether the card\b/},
]);

//A RAW ID IS RECOGNIZED BY BEING ONE, not by looking hyphenated.
//
//The first cut of this guard matched any lowercase kebab-case token, and it
//failed on `non-substantive acknowledgement` — a real reference type's real
//English name. Hyphens are not the defect; naming an identifier the user never
//chose is. So the check takes the identifier vocabulary it is guarding against
//and asks whether a whole word IS one of them. Single-word ids ('published',
//'starred') are excluded: those are ordinary English, and the sentence that
//describes the published filter is allowed to use the word published.
const rawIdentifierIn = (description : string, identifiers : ReadonlySet<string>) : string => {
	if (!identifiers.size) return '';
	for (const word of description.toLowerCase().split(/[^a-z0-9-]+/)) {
		if (!word.includes('-')) continue;
		if (identifiers.has(word)) return word;
	}
	return '';
};

//internalIdentifierDefect names the defect, or '' when the sentence is clean.
//`identifiers` is the vocabulary that must not appear verbatim — the caller
//passes the filter registry's own key set, so this cannot fall behind it.
export const internalIdentifierDefect = (
	description : string,
	identifiers : ReadonlySet<string> = new Set<string>()
) : string => {
	for (const {name, pattern} of INTERNAL_IDENTIFIER_PATTERNS) {
		if (pattern.test(description)) return name;
	}
	const raw = rawIdentifierIn(description, identifiers);
	return raw ? `raw identifier “${raw}”` : '';
};
