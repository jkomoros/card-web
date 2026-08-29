/*eslint-env node, es2022*/

//THE CURATION CANNOT ROT.
//
//The Native Sentence deletes the filter catalog as a browsable wall and makes
//typing the only way most people will ever reach a filter family
//(05-meta-proposal-native-sentence.md, convergence 5). Every proposal that
//reached that conclusion also wrote down the same risk: the bet only pays if
//the synonyms and descriptions are good, and metadata quality is exactly the
//kind of thing that silently degrades — a new reference type lands, a new TODO
//is defined, and the family ships with `Inverse of <id>` as its only sentence
//and its own URL spelling as its only search word.
//
//So the sweep is a TEST rather than a one-time pass. It runs every filter name
//the app can resolve through the two curated paths and requires:
//
//  1. at least three search words per family, and
//  2. a description with no internal identifier in it.
//
//A family added tomorrow fails this suite until somebody writes it words, which
//is the only mechanism that keeps a data file honest.

import { JSDOM } from 'jsdom';
import assert from 'assert';

const dom = new JSDOM('');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Document = dom.window.Document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;

let filterSynonyms;
let curatedFilterDescription;
let internalIdentifierDefect;
let FILTER_SYNONYMS;
let collectionFilterDescription;
let buildCollectionFilterCatalog;
let CollectionDescription;
let CARD_FILTER_DESCRIPTIONS;
let INVERSE_FILTER_NAMES;

describe('Collection filter metadata', () => {
	before(async () => {
		({
			filterSynonyms,
			curatedFilterDescription,
			internalIdentifierDefect,
			FILTER_SYNONYMS,
		} = await import('../../lib/src/collection-filter-synonyms.js'));
		({ collectionFilterDescription } = await import('../../lib/src/collection-composer-suggestions.js'));
		({ buildCollectionFilterCatalog } = await import('../../lib/src/collection-filter-catalog.js'));
		({ CollectionDescription } = await import('../../lib/src/collection_description.js'));
		({ CARD_FILTER_DESCRIPTIONS, INVERSE_FILTER_NAMES } = await import('../../lib/src/filters.js'));
	});

	const everyFilterName = () => Object.keys(CARD_FILTER_DESCRIPTIONS);

	it('gives every filter family at least three search words', () => {
		const thin = everyFilterName()
			.map(name => ({ name, synonyms: filterSynonyms(name) }))
			.filter(entry => entry.synonyms.length < 3);
		assert.deepStrictEqual(thin, [],
			`these families have fewer than three search words: ${thin.map(entry => entry.name).join(', ')}`);
	});

	//THE FLOOR IS NOT THE POINT — the words are. A family whose only three
	//"synonyms" are its own name said three ways is findable by people who
	//already know what it is called, which is the population that does not need
	//search. So the families a person actually composes with are required to
	//have words that are NOT derivable from the name.
	it('gives the composable families words that are not just their own name', () => {
		const composable = [
			'starred', 'unread', 'published', 'unpublished', 'has-todo', 'no-todo',
			'has-tags', 'no-tags', 'orphaned', 'has-links', 'no-links',
			'has-inbound-links', 'working-notes', 'concept', 'person', 'work', 'quote',
			'updated', 'created', 'author', 'query', 'similar', 'children', 'parents',
			'direct-connections', 'connections', 'about-concept', 'cards',
		];
		for (const name of composable) {
			const words = filterSynonyms(name);
			const nameWords = new Set(name.split('-'));
			const original = words.filter(word => !word.split(' ').every(part => nameWords.has(part)));
			assert.ok(original.length >= 3,
				`${name} needs at least three words that are not restatements of its own name, has ${original.length}: ${words.join(' | ')}`);
		}
	});

	it('curates every family the palette leads with', () => {
		//The curated table is allowed to be incomplete for the machine-generated
		//long tail (those derive), but not for the families a person reaches for.
		for (const name of ['starred', 'unread', 'published', 'has-todo', 'updated', 'author', 'query', 'similar', 'exclude', 'combine']) {
			assert.ok(FILTER_SYNONYMS[name], `${name} has no hand-written synonyms`);
			assert.ok(FILTER_SYNONYMS[name].length >= 3, `${name} has fewer than three hand-written synonyms`);
		}
	});

	//THE SWEEP. Every name, through the path the composer actually shows.
	it('shows no internal identifier in any description the composer can display', () => {
		const identifiers = new Set([
			...Object.keys(CARD_FILTER_DESCRIPTIONS),
			...Object.keys(INVERSE_FILTER_NAMES),
		]);
		const defects = [];
		for (const name of everyFilterName()) {
			const description = collectionFilterDescription(name, CARD_FILTER_DESCRIPTIONS);
			assert.ok(description, `${name} has no description at all`);
			const defect = internalIdentifierDefect(description, identifiers);
			if (defect) defects.push(`${name}: ${defect} — “${description}”`);
		}
		assert.deepStrictEqual(defects, [], defects.join('\n'));
	});

	it('repairs the three defects the shipped registry actually had', () => {
		//'Selects cards that are authored by the give user ID' — a typo plus the
		//argument's internal type name.
		const author = collectionFilterDescription('author', CARD_FILTER_DESCRIPTIONS);
		assert.ok(!/give user ID/i.test(author), `author still leaks its argument type: ${author}`);
		assert.ok(/person|wrote|collaborat/i.test(author), `author must say what it keeps: ${author}`);

		//'Inverse of has-todo' — a raw filter id pointed at a reader.
		const noTodo = collectionFilterDescription('no-todo', CARD_FILTER_DESCRIPTIONS);
		assert.ok(!/Inverse of/.test(noTodo), `no-todo still shows the synthesized sentence: ${noTodo}`);

		//'Whether the card has a slug set' — a sentence about a boolean field.
		const hasSlug = collectionFilterDescription('has-slug', CARD_FILTER_DESCRIPTIONS);
		assert.ok(!/^Whether the card/.test(hasSlug), `has-slug still speaks in the field's voice: ${hasSlug}`);
		assert.ok(/^Cards\b/.test(hasSlug), `has-slug must describe cards: ${hasSlug}`);
	});

	//A LIVE TAG'S OWN DESCRIPTION IS NOT THE CURATION'S BUSINESS. The corpus
	//knows its tags better than a static table does, and overriding one would
	//be the same defect in the other direction.
	it('leaves a live section or tag description alone', () => {
		const description = collectionFilterDescription(
			'inductively-knowable',
			{ 'inductively-knowable': 'Matches cards in the Inductively Knowable tag' }
		);
		assert.strictEqual(description, 'Matches cards in the Inductively Knowable tag');
	});

	it('derives words and a sentence for a machine-generated reference family', () => {
		//`has-see-also-references` is one of 56 generated per reference type. It
		//is never hand-written, and it must still be findable and readable.
		const words = filterSynonyms('has-see-also-references');
		assert.ok(words.length >= 3, `derived family has too few words: ${words.join(' | ')}`);
		assert.ok(words.some(word => word.includes('see also')),
			`derived words must use the reference type's own user-facing name: ${words.join(' | ')}`);
		const description = curatedFilterDescription('has-see-also-references');
		assert.ok(/^Cards\b/.test(description), `derived sentence must describe cards: ${description}`);
	});

	it('carries the curated words into the catalog rows', () => {
		//"Browse all" survives as a seeded expansion of the same list, so the
		//same word has to find the same family in both.
		const rows = buildCollectionFilterCatalog(
			CARD_FILTER_DESCRIPTIONS,
			[],
			CollectionDescription.deserialize('everything/'),
			'stale'
		);
		assert.ok(rows.some(row => row.filter.split('/')[0] === 'updated'),
			'typing “stale” in the catalog must reach the updated family');
	});
});
