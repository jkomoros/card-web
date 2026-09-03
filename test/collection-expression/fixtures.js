/*eslint-env node, es2022*/

//THE ROUND-TRIP MATRIX.
//
//The spec makes round-trip tests mandatory for the boolean draft layer, and
//this file is the list they run over. Every fixture states the `filters[]` a
//real collection URL can carry, the expression tree it must parse into, and the
//`filters[]` the compiler must produce back. Where the compiled spelling
//differs from the input spelling — because the model chose a better one — the
//suite falls through to an ENGINE-level equivalence check on a synthetic corpus
//rather than accepting the difference on faith.
//
//The filter names are chosen to actually discriminate in a bare QueryEngine
//(published/unpublished, has-tags/no-tags, query/…, cards/…), so "these two
//spellings select the same cards" is a real assertion and not two empty sets
//agreeing.

const filter = (name) => ({kind: 'filter', filter: name});
const or = (...members) => ({kind: 'or', members});
const not = (child) => ({kind: 'not', child});
const manual = (source) => ({kind: 'manual', source});

export const ROUND_TRIP_FIXTURES = [

	//--- plain ---------------------------------------------------------------
	{
		name: 'a single plain filter',
		category: 'plain',
		filters: ['published'],
		expression: [filter('published')],
		serialized: ['published'],
	},
	{
		name: 'two plain filters are an AND of two conditions',
		category: 'plain',
		filters: ['published', 'has-tags'],
		expression: [filter('published'), filter('has-tags')],
		serialized: ['published', 'has-tags'],
	},
	{
		name: 'no filters at all',
		category: 'plain',
		filters: [],
		expression: [],
		serialized: [],
	},

	//--- configurable, including multi-part URL spellings --------------------
	{
		name: 'a date range configurable filter is ONE leaf, not four',
		category: 'configurable',
		filters: ['updated/between/2020-01-01/2021-01-01'],
		expression: [filter('updated/between/2020-01-01/2021-01-01')],
		serialized: ['updated/between/2020-01-01/2021-01-01'],
	},
	{
		name: 'a one-argument date filter',
		category: 'configurable',
		filters: ['updated/before/2020-01-01'],
		expression: [filter('updated/before/2020-01-01')],
		serialized: ['updated/before/2020-01-01'],
	},
	{
		name: 'a relative date argument',
		category: 'configurable',
		filters: ['updated/after/7-days-ago'],
		expression: [filter('updated/after/7-days-ago')],
		serialized: ['updated/after/7-days-ago'],
	},
	{
		name: 'a key-card link filter with the include-key-card prefix',
		category: 'configurable',
		//NOTE: `direct-connections` claims ONE url part
		//(CONFIGURABLE_FILTER_URL_PARTS), so as a URL this text is two
		//segments — `direct-connections/+key` and a stray `2`. As a
		//filters[] ENTRY it is one segment, which is what this layer is
		//contracted on, and it survives as one opaque leaf either way.
		filters: ['direct-connections/+key/2'],
		expression: [filter('direct-connections/+key/2')],
		serialized: ['direct-connections/+key/2'],
	},
	{
		name: 'a two-part link filter with a ply',
		category: 'configurable',
		filters: ['connections/+key/2'],
		expression: [filter('connections/+key/2')],
		serialized: ['connections/+key/2'],
	},
	{
		name: 'a three-part reference filter',
		category: 'configurable',
		filters: ['references/abc/link/2'],
		expression: [filter('references/abc/link/2')],
		serialized: ['references/abc/link/2'],
	},
	{
		name: 'a text query',
		category: 'configurable',
		filters: ['query/foo'],
		expression: [filter('query/foo')],
		serialized: ['query/foo'],
	},
	{
		name: 'a multiple-cards argument keeps its + inside the leaf',
		category: 'configurable',
		filters: ['cards/one+three'],
		expression: [filter('cards/one+three')],
		serialized: ['cards/one+three'],
	},
	{
		name: 'an author filter',
		category: 'configurable',
		filters: ['author/me'],
		expression: [filter('author/me')],
		serialized: ['author/me'],
	},
	{
		name: 'a similarity cutoff',
		category: 'configurable',
		filters: ['similar-cutoff/one/0.5'],
		expression: [filter('similar-cutoff/one/0.5')],
		serialized: ['similar-cutoff/one/0.5'],
	},

	//--- unions --------------------------------------------------------------
	{
		name: 'a two-member + union',
		category: 'union',
		filters: ['published+has-tags'],
		expression: [or(filter('published'), filter('has-tags'))],
		serialized: ['published+has-tags'],
	},
	{
		name: 'a three-member + union',
		category: 'union',
		filters: ['published+has-tags+orphaned'],
		expression: [or(filter('published'), filter('has-tags'), filter('orphaned'))],
		serialized: ['published+has-tags+orphaned'],
	},
	{
		name: 'a union containing a named inverse',
		category: 'union',
		filters: ['unpublished+no-tags'],
		expression: [or(filter('unpublished'), filter('no-tags'))],
		serialized: ['unpublished+no-tags'],
	},
	{
		name: 'a union alongside another condition',
		category: 'union',
		filters: ['published+has-tags', 'query/zebra'],
		expression: [or(filter('published'), filter('has-tags')), filter('query/zebra')],
		serialized: ['published+has-tags', 'query/zebra'],
	},

	//--- combine -------------------------------------------------------------
	{
		name: 'combine over two plain filters compiles down to the + spelling',
		category: 'combine',
		filters: ['combine/published/no-tags'],
		expression: [or(filter('published'), filter('no-tags'))],
		//The model chose the shorter legal spelling; the suite proves the
		//engine agrees.
		serialized: ['published+no-tags'],
	},
	{
		name: 'combine over configurables stays combine',
		category: 'combine',
		filters: ['combine/query/zebra/query/yak'],
		expression: [or(filter('query/zebra'), filter('query/yak'))],
		serialized: ['combine/query/zebra/query/yak'],
	},
	{
		name: 'combine over a configurable and a plain filter',
		category: 'combine',
		filters: ['combine/query/zebra/published'],
		expression: [or(filter('query/zebra'), filter('published'))],
		serialized: ['combine/query/zebra/published'],
	},
	{
		name: 'combine chained LEFT for three members',
		category: 'combine',
		filters: ['combine/combine/query/zebra/query/yak/published'],
		expression: [or(filter('query/zebra'), filter('query/yak'), filter('published'))],
		serialized: ['combine/combine/query/zebra/query/yak/published'],
	},
	{
		name: 'combine chained RIGHT is read as the same three-way OR and re-spelled left',
		category: 'combine',
		filters: ['combine/query/zebra/combine/query/yak/published'],
		expression: [or(filter('query/zebra'), filter('query/yak'), filter('published'))],
		serialized: ['combine/combine/query/zebra/query/yak/published'],
	},
	{
		name: 'combine over a negated configurable',
		category: 'combine',
		filters: ['combine/exclude/query/zebra/no-tags'],
		expression: [or(not(filter('query/zebra')), filter('no-tags'))],
		serialized: ['combine/exclude/query/zebra/no-tags'],
	},
	{
		name: 'combine whose first half is a + union flattens into one OR',
		category: 'combine',
		filters: ['combine/published+no-tags/query/zebra'],
		expression: [or(filter('published'), filter('no-tags'), filter('query/zebra'))],
		serialized: ['combine/combine/published/no-tags/query/zebra'],
	},
	{
		name: 'combine over an exclude of a plain filter reads as its named inverse',
		category: 'combine',
		filters: ['combine/exclude/published/no-tags'],
		expression: [or(filter('unpublished'), filter('no-tags'))],
		serialized: ['unpublished+no-tags'],
	},

	//--- exclude -------------------------------------------------------------
	{
		name: 'exclude over a plain filter with a named inverse becomes the word',
		category: 'exclude',
		filters: ['exclude/published'],
		expression: [filter('unpublished')],
		serialized: ['unpublished'],
	},
	{
		name: 'exclude over a set-equivalent filter finds its not- word',
		category: 'exclude',
		filters: ['exclude/in-reading-list'],
		expression: [filter('not-in-reading-list')],
		serialized: ['not-in-reading-list'],
	},
	{
		name: 'exclude over a configurable filter',
		category: 'exclude',
		filters: ['exclude/query/zebra'],
		expression: [not(filter('query/zebra'))],
		serialized: ['exclude/query/zebra'],
	},
	{
		name: 'exclude over a multi-part date filter',
		category: 'exclude',
		filters: ['exclude/updated/between/2020-01-01/2021-01-01'],
		expression: [not(filter('updated/between/2020-01-01/2021-01-01'))],
		serialized: ['exclude/updated/between/2020-01-01/2021-01-01'],
	},
	{
		name: 'exclude over a + union is NOT of a group',
		category: 'exclude',
		filters: ['exclude/published+no-tags'],
		expression: [not(or(filter('published'), filter('no-tags')))],
		serialized: ['exclude/published+no-tags'],
	},
	{
		name: 'exclude over a combine re-spells the group and keeps the negation',
		category: 'exclude',
		filters: ['exclude/combine/published/no-tags'],
		expression: [not(or(filter('published'), filter('no-tags')))],
		serialized: ['exclude/published+no-tags'],
	},
	{
		name: 'exclude over a combine of configurables',
		category: 'exclude',
		filters: ['exclude/combine/query/zebra/query/yak'],
		expression: [not(or(filter('query/zebra'), filter('query/yak')))],
		serialized: ['exclude/combine/query/zebra/query/yak'],
	},
	{
		name: 'exclude over a cards list',
		category: 'exclude',
		filters: ['exclude/cards/one+three'],
		expression: [not(filter('cards/one+three'))],
		serialized: ['exclude/cards/one+three'],
	},

	//--- named inverses, both directions -------------------------------------
	{
		name: 'a named inverse is a plain condition, not an operator',
		category: 'inverse',
		filters: ['unpublished'],
		expression: [filter('unpublished')],
		serialized: ['unpublished'],
	},
	{
		name: 'the todo pair',
		category: 'inverse',
		filters: ['no-todo'],
		expression: [filter('no-todo')],
		serialized: ['no-todo'],
	},
	{
		name: 'exclude over a named inverse is the positive word',
		category: 'inverse',
		filters: ['exclude/unpublished'],
		expression: [filter('published')],
		serialized: ['published'],
	},
	{
		name: 'exclude over an inverse-less set filter',
		category: 'inverse',
		filters: ['exclude/not-in-reading-list'],
		expression: [filter('in-reading-list')],
		serialized: ['in-reading-list'],
	},

	//--- pathological but legal ----------------------------------------------
	{
		name: 'double exclude over a named pair cancels',
		category: 'pathological',
		filters: ['exclude/exclude/published'],
		expression: [filter('published')],
		serialized: ['published'],
	},
	{
		name: 'double exclude over a configurable cancels',
		category: 'pathological',
		filters: ['exclude/exclude/query/zebra'],
		expression: [filter('query/zebra')],
		serialized: ['query/zebra'],
	},
	{
		name: 'expand is preserved verbatim as a manual condition',
		category: 'pathological',
		filters: ['expand/published/children/+one'],
		expression: [manual('expand/published/children/+one')],
		serialized: ['expand/published/children/+one'],
	},
	{
		name: 'a negated expand keeps the negation outside the manual text',
		category: 'pathological',
		filters: ['exclude/expand/published/children/+one'],
		expression: [not(manual('expand/published/children/+one'))],
		serialized: ['exclude/expand/published/children/+one'],
	},
	{
		name: 'an expand inside a combine is an OR with a manual member',
		category: 'pathological',
		filters: ['combine/expand/published/children/+one/no-tags'],
		expression: [or(manual('expand/published/children/+one'), filter('no-tags'))],
		serialized: ['combine/expand/published/children/+one/no-tags'],
	},
	{
		name: 'combine whose first half the engine would eat as a SET NAME is manual',
		category: 'pathological',
		//`CollectionDescription.deserialize` shifts a leading set name off
		//before it looks for filters, so the engine itself only finds ONE
		//sub-filter here and no-ops the whole clause. We refuse to model what
		//we cannot re-spell without changing behavior.
		filters: ['combine/everything/query/zebra'],
		expression: [manual('combine/everything/query/zebra')],
		serialized: ['combine/everything/query/zebra'],
	},
	{
		name: 'combine with only one sub-filter is manual',
		category: 'pathological',
		filters: ['combine/query/zebra'],
		expression: [manual('combine/query/zebra')],
		serialized: ['combine/query/zebra'],
	},
	{
		name: 'a bare exclude with nothing after it is an opaque leaf',
		category: 'pathological',
		filters: ['exclude/'],
		expression: [filter('exclude/')],
		serialized: ['exclude/'],
	},
	{
		name: 'a bare combine token is just an unknown filter',
		category: 'pathological',
		filters: ['combine'],
		expression: [filter('combine')],
		serialized: ['combine'],
	},
	{
		name: 'an orphan multi-part head is an opaque leaf, not a boolean',
		category: 'pathological',
		filters: ['before/2020-01-01'],
		expression: [filter('before/2020-01-01')],
		serialized: ['before/2020-01-01'],
	},
	{
		name: 'a deeply nested combine-in-combine-in-combine flattens to one OR',
		category: 'pathological',
		filters: ['combine/combine/combine/query/zebra/query/yak/published/no-tags'],
		expression: [or(filter('query/zebra'), filter('query/yak'), filter('published'), filter('no-tags'))],
		serialized: ['combine/combine/combine/query/zebra/query/yak/published/no-tags'],
	},
	{
		name: 'a negated group next to a negated leaf next to a union',
		category: 'pathological',
		filters: ['exclude/combine/query/zebra/query/yak', 'exclude/published', 'has-tags+orphaned'],
		expression: [
			not(or(filter('query/zebra'), filter('query/yak'))),
			filter('unpublished'),
			or(filter('has-tags'), filter('orphaned')),
		],
		serialized: ['exclude/combine/query/zebra/query/yak', 'unpublished', 'has-tags+orphaned'],
	},
];

//PAIRS THE ENGINE MUST NOT TELL APART. The round-trip loop already runs an
//engine comparison whenever a fixture's compiled spelling differs from its
//input, but these state the equivalences the compiler RELIES on directly, so a
//regression names the rule it broke instead of a fixture number.
export const ENGINE_EQUIVALENT_SPELLINGS = [
	{
		name: 'a + union and a combine are the same OR',
		a: ['published+no-tags'],
		b: ['combine/published/no-tags'],
	},
	{
		name: 'a three-way union, left-chained and right-chained combine all agree',
		a: ['combine/combine/query/zebra/query/yak/published'],
		b: ['combine/query/zebra/combine/query/yak/published'],
	},
	{
		name: 'a named inverse and an exclude of its positive',
		a: ['unpublished'],
		b: ['exclude/published'],
	},
	{
		name: 'a named inverse and an exclude of its positive, second pair',
		a: ['no-tags'],
		b: ['exclude/has-tags'],
	},
	{
		name: 'excluding a union and excluding the equivalent combine',
		a: ['exclude/published+no-tags'],
		b: ['exclude/combine/published/no-tags'],
	},
	{
		name: 'double negation is the identity',
		a: ['query/zebra'],
		b: ['exclude/exclude/query/zebra'],
	},
	{
		name: 'a combine with a negated member and the union of the named inverse',
		a: ['unpublished+no-tags'],
		b: ['combine/exclude/published/no-tags'],
	},
];

//A four-card corpus with exactly enough structure to tell the fixtures' filters
//apart: published/unpublished splits it 2/2, has-tags/no-tags splits it 3/1,
//and each query matches exactly one title.
export const CORPUS = {
	one: {tags: ['alpha'], published: true, title: 'Zebra one'},
	two: {tags: ['beta'], published: false, title: 'Yak two'},
	three: {tags: ['alpha', 'beta'], published: true, title: 'Xray three'},
	four: {tags: [], published: false, title: 'Walrus four'},
};
