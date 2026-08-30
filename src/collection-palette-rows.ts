//THE PALETTE'S ONE LIST, AS DATA.
//
//The redesigned composer has exactly one list, and proposal B's whole argument
//for that is that a list with one row anatomy cannot grow a second vocabulary
//(02-proposal-b-the-palette.md §2.1: "Row anatomy everywhere: leading glyph,
//one label, right-aligned quiet count, detail on highlight only. Kills the
//triple verb redundancy"). But the list has four FEEDS — recents and
//refinements when the input is empty, the completion index's valences while
//typing, every filter family under "Browse all", and the alternatives for a
//sentence word — and each of those feeds answers in its own shape.
//
//So this module is the one place those four shapes become one. Everything above
//it renders `PaletteRow`s and knows nothing about candidates, valences,
//suggestions or catalog items; everything below it goes on answering in its own
//vocabulary. The composer's old list did the conversion inline, per feed, which
//is why a row could carry a verb chip in one section and not in another.
//
//WHAT A ROW OWES THE PALETTE, and why each field is here rather than derived at
//the call site:
//
//  - `id` is STABLE across keystrokes for the same thing, because it is the
//    preview-count cache key. A count that changed identity every character
//    would blank on every keystroke, which is the defect the retained-count map
//    exists to prevent.
//  - `description` is what the row's count COUNTS and what a navigating row
//    opens. One field, so the number beside a row and the collection it lands on
//    cannot come from two derivations.
//  - `navigates` is the one consequence distinction the design keeps: "Open is
//    the only verb that LEAVES". It is a boolean rather than a verb chip,
//    because the chips are deleted — the section heading carries the grammar and
//    a navigating row under a typing list gets the one glyph.
//  - `pillExpression` is proposal A's token discipline made literal:
//    "completions render as the pill they would become". The row hands the
//    sentence renderer a one-condition expression, so the pill in the row and
//    the pill it becomes in the sentence are the same component over the same
//    node.

import {
	CollectionDescription,
	collectionDescriptionWithFilterAppended,
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithSortReversed,
	collectionDescriptionWithViewMode,
} from './collection_description.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	collectionDescriptionWithExpression,
	negatedExpressionNode,
} from './collection-expression.js';

import {
	CompletionCandidate,
	CompletionValence,
	CompletionValenceKind,
} from './collection-completion-index.js';

import {
	CollectionComposerSuggestion,
	collectionOptionDisplayName,
} from './collection-composer-suggestions.js';

import {
	CollectionFilterCatalogItem,
	collectionFilterCatalogCategories,
} from './collection-filter-catalog.js';

import {
	SET_INFOS,
	SORTS,
	LEGAL_VIEW_MODES,
} from './filters.js';

import {
	SetName,
	SortName,
	ViewMode,
} from '../shared/types.js';

//WHAT KIND OF ROW, in the terms the RENDERER differs on — not in the terms its
//source module happens to use. A destination renders as a miniature sentence, a
//valence as the pill it would become, and the three flat kinds as one line of
//text; those are three renderings, so there are three kinds and not seven.
export type PaletteRowKind =
	//A collection to go to. Renders as a miniature sentence with its count.
	| 'destination'
	//An edit to the sentence, carrying the pill it would become.
	| 'valence'
	//A one-line row that changes the draft: a refinement, a sentence word, a
	//family from Browse all.
	| 'transform';

//The heading a run of rows sits under. Sentence case, panel-h3 register — the
//section carries the grammar that the deleted verb chips used to restate.
//What a view mode's extra means when nobody has named a card: the collection's
//own first card. The app's own spelling, from collection_description.
const VIEW_MODE_FIRST_CARD = '_';

export const RECENT_SECTION = 'Recent';
export const REFINE_SECTION = 'Refine';

export type PaletteRow = {
	//Stable for the same thing across keystrokes: the preview-count cache key.
	id : string;
	kind : PaletteRowKind;
	section : string;
	label : string;
	detail : string;
	//True when choosing this row LEAVES — it commits a navigation and closes the
	//palette. Everything else rewrites the draft and hands the user back to
	//composing.
	navigates : boolean;
	//What this row's count counts, and what a navigating row opens.
	description : CollectionDescription;
	//Present when this row edits the sentence: the whole next expression, so the
	//palette never re-derives the edit from the row.
	expression? : CollectionExpression;
	//THE PILL IT WOULD BECOME: a one-condition expression for the sentence
	//renderer. Absent for rows that are not a pill.
	pillExpression? : CollectionExpression;
	valenceKind? : CompletionValenceKind;
	//For an 'or' valence: the condition it widens, named, because proposal B
	//§3.1 requires the row to be "labeled with what it widens".
	targetLabel? : string;
	targetIndex? : number;
	//A row whose clause needs its arguments chosen before it means anything: the
	//palette adds it with the family's own defaults and opens its pill row.
	configurable? : boolean;
	//The clause this row would add, when the row names one. Present for the
	//Browse-all feed and for a refinement row that names a family.
	filter? : string;
	//A clause this layer will not compose. Source is the honest offer.
	sourceFilter? : string;
	//THE ONE EXCEPTION TO DETAIL-ON-HIGHLIGHT. Browse all is a list whose whole
	//content is "name + one line of description"; without the line there is no
	//way to tell one family from its neighbour, which is the wall's one virtue
	//and the only part of it worth keeping.
	alwaysDetail? : boolean;
	viewerDependent : boolean;
	//A destination that carries its own path — a recent with a selected card.
	destinationPath? : string;
};

//--- Destinations and refinements (the idle feed) --------------------------

//A SUGGESTION IS ALREADY A ROW; what it is missing is the section it sits in
//and the one consequence bit. `action === 'open'` is the existing module's own
//answer to "does this leave?", so it is read rather than re-decided.
const rowForSuggestion = (suggestion : CollectionComposerSuggestion, section : string) : PaletteRow => ({
	id: suggestion.id,
	kind: suggestion.kind === 'recent' ? 'destination' : 'transform',
	section,
	//A ROW IS NAMED BY WHAT IT IS, NOT BY WHAT IT DOES TO YOU.
	//
	//The suggestion module's `label` carries a verb in front of the name ('Add
	//Starred', 'Open Everything · starred'), which is the verb-chip vocabulary
	//one level down in the string. The section heading says the grammar now, so
	//a destination and an added clause both read as themselves — `name` is the
	//same module's verb-free name, so the row and the receipt that follows it
	//still cannot disagree.
	//
	//A row that PIVOTS ('Start from Everything') keeps its label, because there
	//the verb is not a restatement: the name alone would be the set, and the row
	//does not merely add it.
	label: suggestion.action === 'add' || suggestion.kind === 'recent' ? suggestion.name : suggestion.label,
	detail: suggestion.detail,
	navigates: suggestion.action === 'open',
	description: suggestion.description,
	sourceFilter: suggestion.sourceFilter,
	configurable: Boolean(suggestion.configureFilter),
	filter: suggestion.configureFilter,
	viewerDependent: Boolean(suggestion.viewerDependent),
	destinationPath: suggestion.destinationPath,
});

//THE IDLE CONTRACT, IN TWO SECTIONS AND NOTHING ELSE. The cap on the second one
//is the completion index's (IDLE_CONTEXTUAL_ROW_LIMIT); this only names the
//sections, because "recents first, always" is a promise about ORDER and order is
//what a flat list has instead of layout.
export const paletteIdleRows = (
	recents : readonly CollectionComposerSuggestion[],
	contextual : readonly CollectionComposerSuggestion[]
) : PaletteRow[] => [
	...recents.map(suggestion => rowForSuggestion(suggestion, RECENT_SECTION)),
	//"REMOVE X" ROWS ARE DELETED, and the design says where their question went:
	//`without this pill: N` in the pill row answers it, beside the clause it is
	//about, instead of in a list of offers to undo things the user chose. A
	//clause exists in exactly one place — the sentence — and its removal belongs
	//there too.
	...contextual.filter(suggestion => suggestion.action !== 'remove')
		.map(suggestion => rowForSuggestion(suggestion, REFINE_SECTION)),
];

//--- Valences (the typing feed) --------------------------------------------

//THE ONE CONDITION A VALENCE ROW IS ABOUT, so the row can render it as the pill
//it would become. An `add` shows the clause; a `not` shows the flipped clause,
//which — through the draft layer — is the app's own inverse WORD when it has
//one; an `or` shows the FUSED group, because that is the single pill the
//sentence will contain afterwards, and showing only the new alternative would
//promise a pill the edit does not make.
const pillExpressionForValence = (valence : CompletionValence, node : FilterExpressionNode) : CollectionExpression => {
	if (valence.kind === 'or' && valence.targetIndex !== undefined) {
		const fused = valence.expression[valence.targetIndex];
		if (fused) return [fused];
	}
	if (valence.kind === 'not') return [negatedExpressionNode(node)];
	return [node];
};

//A CANDIDATE BECOMES AS MANY ROWS AS IT HAS MEANINGS. That is the graft proposal
//B calls "where booleans are born": one typed token, three sentences with
//numbers on them, and the user authors `a AND (b OR c) AND NOT d` by choosing
//between them. The ORDER is the engine's — candidates by score, valences by rank
//— and this function preserves it rather than re-sorting, because the ranking
//rule ("add leads; or labeled with its target; not below unless the token was
//negated") lives in the index where it can be tested against the token.
//
//A candidate with no valences is not a clause: a recent is a destination, and a
//set/sort/view is a word in the sentence. Both change the DESCRIPTION rather
//than the expression, so both come through with the description they carry.
export const paletteTypingRows = (
	candidates : readonly CompletionCandidate[],
	description : CollectionDescription,
	section = ''
) : PaletteRow[] => {
	const rows : PaletteRow[] = [];
	for (const candidate of candidates) {
		if (candidate.kind === 'recent') {
			rows.push({
				id: candidate.id,
				kind: 'destination',
				section,
				label: candidate.label,
				detail: candidate.detail,
				//A RECENT NAVIGATES; IT DOES NOT EDIT. The completion index's own
				//note says so — offering valences would mean offering to AND
				//somebody's whole saved collection onto the draft.
				navigates: true,
				description: candidate.description || description,
				viewerDependent: candidate.viewerDependent,
			});
			continue;
		}
		if (!candidate.valences.length) {
			//A sentence word: set, sort or view. It replaces a word in the
			//sentence and leaves the conditions alone.
			if (!candidate.description) continue;
			rows.push({
				id: candidate.id,
				kind: 'transform',
				section,
				label: candidate.label,
				detail: candidate.detail,
				navigates: false,
				description: candidate.description,
				viewerDependent: candidate.viewerDependent,
			});
			continue;
		}
		const node = candidate.node;
		if (!node) continue;
		for (const valence of candidate.valences) {
			rows.push({
				id: valence.id,
				kind: 'valence',
				section,
				//A FAMILY ROW OPENS ITS OWN CONTROLS AFTER IT LANDS. The clause
				//is spelled with the family's default, which is a real collection
				//— but the arguments are the point of a configurable family, so
				//the palette selects the pill it just added and the row appears
				//under it. The flag rides on the row rather than being
				//re-derived from the filter name at the call site.
				configurable: candidate.kind === 'filter-family',
				filter: candidate.filter,
				label: valence.label,
				detail: candidate.detail,
				navigates: false,
				description: collectionDescriptionWithExpression(description, valence.expression),
				expression: valence.expression,
				pillExpression: pillExpressionForValence(valence, node),
				valenceKind: valence.kind,
				targetLabel: valence.targetLabel,
				targetIndex: valence.targetIndex,
				viewerDependent: candidate.viewerDependent,
			});
		}
	}
	return rows;
};

//--- The or-scoped feed -----------------------------------------------------

//"OR…" NARROWS THE WHOLE LIST TO ONE QUESTION. The pill row's or… verb is a
//request, so the palette answers it by scoping the input: every row is now an
//alternative joining ONE named condition, and a candidate whose engine valences
//do not include that target is simply not an answer to the question being asked.
//
//The rows come out of the SAME valences the unscoped list would show, filtered
//rather than rebuilt, so a scoped row and an unscoped one apply the identical
//edit — there is no second path that could fuse a group differently.
export const paletteOrScopedRows = (
	candidates : readonly CompletionCandidate[],
	description : CollectionDescription,
	targetIndex : number,
	section = ''
) : PaletteRow[] =>
	paletteTypingRows(candidates, description, section)
		.filter(row => row.valenceKind === 'or' && row.targetIndex === targetIndex);

//--- Browse all -------------------------------------------------------------

//THE CATALOG STOPS BEING A PLACE (meta-proposal convergence 5). What survives is
//one quiet link that seeds THIS list with every family under the same headings —
//one line each, name and gray description. No examples, no Not toggles, no
//"Show N more", no setup strip: those were the wall, and the wall is what the
//owner's complaints were about.
//
//The DATA is the catalog module's, unchanged and still tested on its own terms.
//Only the surface died.
export const paletteBrowseRows = (
	items : readonly CollectionFilterCatalogItem[],
	description : CollectionDescription
) : PaletteRow[] => {
	const rows : PaletteRow[] = [];
	for (const category of collectionFilterCatalogCategories) {
		for (const item of items) {
			if (item.category !== category) continue;
			//A FAMILY HAS NO COLLECTION YET; A PLAIN FILTER DOES. The first keeps
			//the draft's own description, because its arguments have not been
			//chosen and any count beside it would be a number for a clause that
			//does not exist. The second is a whole clause already, so its row
			//carries the collection it would produce — which is what makes
			//choosing it an ordinary add rather than a special case.
			const guidedClause = item.guided && !item.configurable;
			rows.push({
				id: `browse:${item.filter}`,
				kind: 'transform',
				section: category,
				label: item.label,
				detail: item.detail,
				navigates: false,
				description: guidedClause ? collectionDescriptionWithFilterAppended(description, item.filter) : description,
				//A clause this layer cannot compose opens in Source instead of
				//pretending to a guided editor.
				sourceFilter: item.guided ? undefined : item.filter,
				configurable: item.configurable,
				filter: item.filter,
				alwaysDetail: true,
				viewerDependent: false,
			});
		}
	}
	return rows;
};

//--- Sentence words ---------------------------------------------------------

//SET, SORT AND VIEW ARE WORDS IN THE SENTENCE, and clicking one fills the list
//with its alternatives (meta-proposal convergence 7). The four-select setup
//strip is deleted; these rows are what replaced it, and they are the same rows
//the completion index produces for a typed set or sort name — the same edit,
//reachable two ways.
export type PaletteWordScope = 'set' | 'sort';

export const paletteWordRows = (
	description : CollectionDescription,
	scope : PaletteWordScope
) : PaletteRow[] => {
	if (scope === 'set') {
		return Object.entries(SET_INFOS)
			.filter(entry => entry[0] !== description.set)
			.map(([name, info]) => ({
				id: `set:${name}`,
				kind: 'transform' as const,
				section: 'Start from',
				label: collectionOptionDisplayName(name),
				detail: info.description,
				navigates: false,
				description: collectionDescriptionWithSet(description, name as SetName),
				viewerDependent: false,
			}));
	}
	const rows : PaletteRow[] = Object.entries(SORTS)
		.filter(entry => entry[0] !== description.sort)
		.map(([name, info]) => ({
			id: `sort:${name}`,
			kind: 'transform' as const,
			section: 'Order by',
			label: collectionOptionDisplayName(name),
			detail: info.description,
			navigates: false,
			description: collectionDescriptionWithSort(description, name as SortName),
			viewerDependent: false,
		}));
	//Reversing is a property of the order, so it belongs in the order's own
	//list rather than in a fifth control the strip used to carry.
	rows.push({
		id: 'sort-reversed',
		kind: 'transform',
		section: 'Order by',
		label: description.sortReversed ? 'Normal order' : 'Reverse order',
		detail: description.sortReversed ? 'Puts the order back the way round it usually runs.' : 'Runs the same order backwards.',
		navigates: false,
		description: collectionDescriptionWithSortReversed(description, !description.sortReversed),
		viewerDependent: false,
	});
	for (const mode of Object.keys(LEGAL_VIEW_MODES)) {
		if (mode === description.viewMode) continue;
		rows.push({
			id: `view:${mode}`,
			kind: 'transform',
			section: 'Show as',
			label: collectionOptionDisplayName(mode),
			detail: `Shows this collection as ${collectionOptionDisplayName(mode)}.`,
			navigates: false,
			//A view that takes a focus card gets the app's own "whichever card
			//the collection opens on" rather than an empty argument. The old
			//setup strip seeded it from the active card and offered a picker
			//beside it; the strip is deleted, and `_` is the honest default —
			//naming a specific card is Source's job now.
			description: collectionDescriptionWithViewMode(description, mode as ViewMode, description.viewModeExtra || VIEW_MODE_FIRST_CARD),
			viewerDependent: false,
		});
	}
	return rows;
};

//--- Order ------------------------------------------------------------------

//THE LIST DOES NOT MOVE UNDER THE KEYBOARD. Counts arrive asynchronously and can
//re-rank the idle feed, and the spec's MUST is that "the transformation accepted
//on keydown is the one visibly highlighted on keydown" — so while a row is
//highlighted the order is frozen to the one that was on screen. Ported verbatim
//from the composer's own suggestion-order memo; only the element type changed.
export const frozenPaletteOrder = (rows : readonly PaletteRow[], order : readonly string[]) : PaletteRow[] => {
	const position = new Map(order.map((id, index) => [id, index]));
	return rows
		.map((row, index) => ({row, index}))
		.sort((left, right) =>
			(position.get(left.row.id) ?? left.index) - (position.get(right.row.id) ?? right.index))
		.map(({row}) => row);
};

//THE IDENTITY OF A LIST IS ITS SET OF ROWS, NOT THEIR ORDER — which is the
//whole point of asking. The question the freeze needs answered is "was this list
//REBUILT?", and a count arriving late re-ranks the same rows without rebuilding
//anything. Keying on the rendered order would make every re-rank look like a new
//list and unfreeze exactly the case the freeze exists for, so the ids are sorted
//before they are joined.
export const paletteOrderKey = (rows : readonly PaletteRow[]) : string =>
	rows.map(row => row.id).sort().join('\n');
