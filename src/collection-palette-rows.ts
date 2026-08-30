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
//  - `description` is what the row's count COUNTS and what executing the row
//    makes of the draft. One field, so the number beside a row and the
//    collection it produces cannot come from two derivations.
//  - `pillExpression` is proposal A's token discipline made literal:
//    "completions render as the pill they would become". The row hands the
//    sentence renderer a one-condition expression, so the pill in the row and
//    the pill it becomes in the sentence are the same component over the same
//    node.

import {
	CollectionDescription,
	collectionDescriptionWithSet,
	collectionDescriptionWithSort,
	collectionDescriptionWithSortReversed,
	collectionDescriptionWithViewMode,
} from './collection_description.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	collectionDescriptionWithExpression,
	describeExpressionNode,
	negatedExpressionNode,
	serializeCollectionExpression,
	serializeFilterNode,
	withConditionRemoved,
} from './collection-expression.js';

import {
	CompletionCandidate,
	CompletionMatchTier,
	CompletionValence,
	CompletionValenceKind,
	LITERAL_MATCH_TIERS,
} from './collection-completion-index.js';

import {
	CollectionComposerSuggestion,
	collectionOptionDisplayName,
} from './collection-composer-suggestions.js';

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
	//A WHOLE COLLECTION, made the draft in one action. Renders as a miniature
	//sentence — the same component the draft's own sentence uses — with its count
	//and a one-line diff in the annotation slot.
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

//THE 'REFINE' HEADING IS DELETED (round-3 tightness, S2).
//
//It was the second of three runs in the idle list, and the rows under it were
//the same species as the rows under the third: a pill, a count, one quiet word.
//A heading between two runs of one species is a wall that says nothing except
//"the ranking stops here and starts again", and the constitution's whole model
//is ONE ranked list. So the contextual rows keep their rank — they still lead,
//because they are still scored first — and lose the label that made them look
//like a different kind of offer.

export type PaletteRow = {
	//Stable for the same thing across keystrokes: the preview-count cache key.
	id : string;
	kind : PaletteRowKind;
	section : string;
	label : string;
	detail : string;
	//What this row's count counts, and what executing it makes of the draft.
	//
	//THERE IS NO `navigates` ANY MORE (round 3, D1). It was the one consequence
	//distinction the previous design kept — "Open is the only verb that LEAVES" —
	//and the owner's constitution removes the thing it distinguished: nothing in
	//this list leaves. Navigation is Cmd-Enter and the primary button, and both
	//of those act on the DRAFT, which is the only collection the composer ever
	//opens.
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
	//THIS ROW TAKES ITS PILL OUT rather than putting one in. The anatomy is
	//identical — the pill, the count, the annotation — and the pill wears the
	//removal treatment, which is the same outlined-not vocabulary the sentence
	//uses for a negated clause, one step further: outlined AND struck.
	removes? : boolean;
	//THIS ROW OPENS AN EXISTING CLAUSE'S CONTROLS. It changes nothing on its
	//own, so it carries no count; its consequence is the pill row appearing under
	//the sentence, on the clause it names.
	edits? : boolean;
	//For a remove or an edit: which clause of the draft, in the sentence's own
	//address. memberIndex is -1 for a whole condition.
	targetMemberIndex? : number;
	//The clause this row would add, when the row names one. Present for the
	//Browse-all feed and for a refinement row that names a family.
	filter? : string;
	//A clause this layer will not compose. Source is the honest offer.
	sourceFilter? : string;
	viewerDependent : boolean;
	//A destination that carries its own path — a recent with a selected card.
	destinationPath? : string;
	//This row names the option ALREADY in force. It is not an edit and choosing
	//it changes nothing; it is here so a list of alternatives says which one you
	//are looking at.
	current? : boolean;
	//A QUIET WORD SAYING WHAT KIND OF THING THIS IS ('tag', 'section', 'sort').
	//The idle list is the whole vocabulary in ONE ranked run, so a row has to be
	//able to say what it is without the list growing category walls to say it
	//for them — that wall is exactly what the redesign deleted.
	annotation? : string;
	//The key this row's acceptance is remembered under, for the personal-usage
	//store. Absent for rows there is nothing to learn from.
	usageKey? : string;
	//This row REPLACES a word in the sentence rather than appending a clause:
	//the set, the sort, the view. The palette must never stack these.
	singleton? : boolean;
	//HOW WELL THE TYPED TOKEN NAMED THIS ROW'S CANDIDATE, carried up from the
	//engine because the palette's ranking rule is stated in tiers: the row that
	//IS the typed thing outranks every graft of it and every pivot away from it,
	//and "is the typed thing" is a question about the tier the match was made at.
	//Absent on the feeds that answer no token.
	tier? : CompletionMatchTier;
	//For a `not` row: whether the TYPED TOKEN asked for the negation. See
	//paletteTypedRank — a requested negation is literal, an offered one is a
	//graft.
	negationRequested? : boolean;
};

//--- The one ranking rule a typed list has ----------------------------------

//WHAT A ROW IS, TO A USER WHO JUST TYPED SOMETHING. Three classes, in the hard
//order the constitution implies, and every typed feed is sorted by them first.
//
//  LITERAL  the row that IS the typed thing: the parsed phrase's own pill, the
//           exact/prefix/alias/typo match's plain add, the change or removal of
//           the clause it names, the sentence word it spells, the collection a
//           pasted link parses to. Whatever else the list offers, this is what
//           the user wrote, and Enter is aimed at it.
//  READING  a weaker interpretation of the same token: a description or
//           subsequence hit, and the free-text guess — the honest floor.
//  GRAFT    the typed thing FUSED with something already in the sentence: an
//           or, or a negation nobody asked for. It contains the literal row and
//           is not it.
//  PIVOT    a whole other collection replacing the draft. The combinatorial
//           action, which may lead the IDLE list — that is what an idle list is
//           for — and may never be the answer to a token.
//
//WHY THIS EXISTS AS A CLASS RATHER THAN AS SCORE. The count-driven rules — sink
//a zero, suppress a no-op widen — arrive asynchronously and re-rank the list
//after the engine has finished with it, and they were sinking the literal row:
//with two tags in the draft, typing a fresh date phrase put `Created since 5
//days ago · 3 → 0` seventh, under two or-grafts OF ITSELF and three readings of
//the raw words. The honest zero on the literal row is the design's own answer to
//"that clause selects nothing", together with the recovery section; demoting the
//row that says it is the list refusing to show the user their own sentence.
export const TYPED_RANK_LITERAL = 0;
export const TYPED_RANK_READING = 1;
export const TYPED_RANK_GRAFT = 2;
export const TYPED_RANK_PIVOT = 3;

//The valences that are ABOUT the clause the token names, rather than about
//fusing it with a neighbour. A `not` is here only when the token asked for one,
//which the engine has already decided by ranking it above the plain add.
const LITERAL_VALENCE_KINDS : ReadonlySet<CompletionValenceKind> =
	new Set<CompletionValenceKind>(['add', 'change', 'remove', 'edit']);

export const paletteTypedRank = (row : PaletteRow) : number => {
	//A tier-less row in a typed feed is one this module built without an engine
	//match behind it; treat it as a reading rather than promoting it.
	const named = Boolean(row.tier) && LITERAL_MATCH_TIERS.has(row.tier as CompletionMatchTier);
	if (row.kind === 'destination') {
		//A PASTED COLLECTION IS NOT A PIVOT. The parser accepted a collection
		//written in the app's own URL grammar; there is no interpretation left to
		//rank, and it is exactly as literal as a name match is.
		return row.tier === 'parsed' ? TYPED_RANK_LITERAL : TYPED_RANK_PIVOT;
	}
	if (row.valenceKind && !LITERAL_VALENCE_KINDS.has(row.valenceKind)) {
		//A requested negation is the literal reading of a negated token — the
		//engine says so by ranking it first among that candidate's valences, and
		//paletteTypingRows preserves that order, so first-and-not is the test.
		if (row.valenceKind !== 'not' || !row.negationRequested) return TYPED_RANK_GRAFT;
	}
	return named ? TYPED_RANK_LITERAL : TYPED_RANK_READING;
};

//THE RECOVERY SECTION, and it exists only when there is something to recover
//from. A draft that matches nothing is a valid draft, and the honest offer is
//not a note saying so — it is the clauses, each with the count the collection
//would have without it, so the user can see which one emptied the collection
//and take it out.
//
//THE HEADING IS A RANK ANNOTATION, NOT A ZONE (round 3, D3). It read 'Nothing
//matches — try removing': a sentence, in the place where every other heading is
//a two-word label, which made the run under it look like a different KIND of
//list rather than the same list ranked differently. The fact it was carrying —
//that the draft resolves to nothing — is stated once, beside the commit control,
//where it always was.
export const RECOVER_SECTION = 'Try removing';

//IT IS BUILT FROM THE SENTENCE, NOT FROM A SECOND ENUMERATION OF THE DRAFT
//(round-3 tightness, M4).
//
//These rows used to come through the suggestion module's removal generator and
//then through rowForSuggestion, which gave them a verb-label ('Remove Tagged
//Ecosystems') and no pill — the one species in the list wearing the vocabulary
//the redesign deleted, in the one place a user is already confused. A removal is
//a removal: the typed `remove` row shows the pill it takes out, struck, with the
//word `remove` in the annotation slot, and so does this one now, because both
//are built here out of the SAME expression the sentence is rendering.
//
//ONE ROW PER CONDITION, by construction. parseCollectionExpression is 1:1 with
//the description's filters, so walking the expression cannot omit a clause the
//sentence shows — which is what it is for: the clause that emptied the
//collection is precisely the one the user needs offered back.
export const paletteRecoveryRows = (
	expression : CollectionExpression,
	description : CollectionDescription,
	labels : Record<string, string> = {},
	cardNames : Record<string, string> = {}
) : PaletteRow[] =>
	expression.map((condition, index) => {
		const label = describeExpressionNode(condition, labels, cardNames).label;
		const next = withConditionRemoved(expression, index);
		return {
			//Stable across keystrokes for the same clause — it is a preview-count
			//cache key — and distinct per clause even when two spell alike.
			id: `recover:${index}:${serializeFilterNode(condition)}`,
			kind: 'valence' as const,
			section: RECOVER_SECTION,
			label,
			detail: `Takes ${label} back out of this collection.`,
			description: collectionDescriptionWithExpression(description, next),
			expression: next,
			pillExpression: [condition],
			valenceKind: 'remove' as const,
			removes: true,
			targetIndex: index,
			targetMemberIndex: -1,
			annotation: EXISTING_CLAUSE_ANNOTATIONS.remove,
			viewerDependent: false,
		};
	});

//--- Destinations and refinements (the idle feed) --------------------------

//A SUGGESTION IS ALREADY A ROW; what it is missing is the section it sits in
//and the one consequence bit.
//
//`navigates` IS FALSE FOR EVERY ROW NOW (round 3, D1/D3). The owner's
//constitution has exactly one navigation — Cmd-Enter, which commits the draft —
//and every row in the list is an ACTION ON THE DRAFT. A recent used to be the
//exception, and it was the exception that made the list two kinds of thing: a
//row that leaves cannot be compared to a row that edits, so the destination rows
//grew their own glyph, their own footer branch and their own verb. Executing one
//now REPLACES the draft with that collection — the combinatorial action the
//constitution names — and the user is still in the composer with a preview in
//front of them.
//
//THE ANNOTATION SLOT CARRIES ONE QUIET WORD, AND THE DIFF IS NOT ONE (round-3
//tightness, S1).
//
//A combinatorial row's whole diff used to live here — 'Uses Main instead of
//Everything · Removes Tagged Ecosystems, Tagged Platforms, Created since 7 days
//ago · Adds Section About' — a three-clause sentence in the slot where every
//other row says 'tag'. It wrapped to three lines, it made one species of row
//twice the height of the rest, and it was ALREADY on screen: the row's own
//detail line is that same sentence, shown on the highlighted row like every
//other row's explanation. So the slot says what kind of thing this row is, and
//the diff stays where the reader can ask for it.
const DESTINATION_ANNOTATION = 'recent';

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
	description: suggestion.description,
	sourceFilter: suggestion.sourceFilter,
	configurable: Boolean(suggestion.configureFilter),
	filter: suggestion.configureFilter,
	viewerDependent: Boolean(suggestion.viewerDependent),
	destinationPath: suggestion.destinationPath,
	annotation: suggestion.kind === 'recent' ? DESTINATION_ANNOTATION : undefined,
});

//THE IDLE CONTRACT, IN TWO RUNS: recents, and then ONE RANKED LIST of
//everything you can do to the draft — the contextual suggestions first, because
//they are scored first, and the entire vocabulary behind them.
//
//This is the owner's round-2 correction, and it reverses a decision the previous
//build made deliberately. The old contract was "recents + 3 contextual rows and
//nothing else", with everything else behind a `Browse all filters` link. The
//owner's model is the opposite: "the list should show some pre-configured items
//(recents/suggestions) but also just filter the WHOLE set — don't hide the full
//set of filters, it shows the power." A gate that hides the vocabulary makes the
//product look smaller than it is, and it makes typing feel like a search against
//an unknown index rather than a filter over a visible one.
//
//The cap on the contextual rows is unchanged (IDLE_CONTEXTUAL_ROW_LIMIT); those
//are still the deterministic contextual rows, and complaint #6 was about THEM
//being arbitrary, not about the vocabulary being absent.
//
//THE SECOND RUN IS ONE SECTION, NOT A WALL — and, since the round-3 tightness
//pass, it is one section for the contextual rows too. It is ranked purely by
//personal likelihood — usage, corpus fit, description context — and every row
//carries a quiet annotation saying what kind of thing it is. Grouping it by
//category would rebuild the catalog inside the list it replaced, and the
//categories would then outrank the ranking, which is precisely the defect that
//made 'Suggested for this card' beat an exact name match under the old
//Browse-all feed. A 'Refine' heading over the first three rows of that one run
//was the same defect at three rows instead of thirty: the rows under it are the
//same species, doing the same thing, in the same order they would be in without
//it.
export const VOCABULARY_SECTION = 'Everything you can add';

export const paletteIdleRows = (
	recents : readonly CollectionComposerSuggestion[],
	contextual : readonly CollectionComposerSuggestion[],
	vocabulary : readonly PaletteRow[] = []
) : PaletteRow[] => {
	const rows = [
		...recents.map(suggestion => rowForSuggestion(suggestion, RECENT_SECTION)),
		//"REMOVE X" ROWS ARE DELETED, and the design says where their question
		//went: `without this pill: N` in the pill row answers it, beside the
		//clause it is about, instead of in a list of offers to undo things the
		//user chose. A clause exists in exactly one place — the sentence — and
		//its removal belongs there too.
		...contextual.filter(suggestion => suggestion.action !== 'remove')
			.map(suggestion => rowForSuggestion(suggestion, VOCABULARY_SECTION)),
	];
	//A ROW THAT IS ALREADY ABOVE IS NOT SHOWN AGAIN. The suggestion feed and the
	//vocabulary feed are two views of one world, so they overlap by design; the
	//dedupe is on the EDIT (a row's own description), which is the same identity
	//the typing feed dedupes on, so "the same offer twice" cannot survive either
	//path.
	//
	//EXCEPT FOR THE ROWS THAT MAKE NO EDIT. A row that opens Source carries the
	//draft's own description because nothing has been added yet — so all three
	//of them serialize identically, and an edit-keyed dedupe silently kept the
	//first and deleted the rest. Those rows are identified by the family they
	//open at, which is the thing that actually differs between them.
	const identityOf = (row : PaletteRow) : string =>
		row.sourceFilter ? `source:${row.sourceFilter}` : row.description.serialize();
	const seen = new Set(rows.map(identityOf));
	for (const row of vocabulary) {
		const identity = identityOf(row);
		if (seen.has(identity)) continue;
		seen.add(identity);
		rows.push({...row, section: VOCABULARY_SECTION});
	}
	return rows;
};

//--- Valences (the typing feed) --------------------------------------------

//The verb for the two actions that are ABOUT a clause the sentence already has.
//Lowercase and quiet, in the annotation slot every other row uses for the word
//'tag' or 'date' — the same shape, saying the thing this row actually needs to
//say.
const EXISTING_CLAUSE_ANNOTATIONS : Partial<Record<CompletionValenceKind, string>> = {
	remove: 'remove',
	edit: 'edit',
	//The third one, in the same register: this row moves a clause you have to a
	//value you just typed.
	change: 'change',
};

//THE ONE CONDITION A VALENCE ROW IS ABOUT, so the row can render it as the pill
//it would become. An `add` shows the clause; a `not` shows the flipped clause,
//which — through the draft layer — is the app's own inverse WORD when it has
//one; an `or` shows the FUSED group, because that is the single pill the
//sentence will contain afterwards, and showing only the new alternative would
//promise a pill the edit does not make.
//
//A `remove` and an `edit` show the pill the sentence ALREADY HAS — the one they
//are about — which the engine hands over as `targetNode` for exactly this. The
//removal treatment goes on the row, not on the pill's own expression: a struck
//pill is a rendering, and inventing a negated node to draw it with would be the
//row lying about which clause it names.
//A `change` shows the clause WITH ITS NEW VALUE — one pill, the one the sentence
//will contain a keystroke later — which is the plain `[node]` at the bottom.
//What it replaces is said by the count (`current → after`) and by the detail
//line, rather than by a second pill in a row that produces one.
const pillExpressionForValence = (valence : CompletionValence, node : FilterExpressionNode) : CollectionExpression => {
	if (valence.targetNode && (valence.kind === 'remove' || valence.kind === 'edit')) return [valence.targetNode];
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
	//TWO ROWS THAT MAKE THE SAME EDIT ARE ONE ROW.
	//
	//`published` and `unpublished` are both real filters and both match the
	//token 'published', and each of them can be added or flipped — so four rows
	//came back naming two collections, with the twins carrying contradictory
	//descriptions ("Unpublished — Keeps cards you have published"). Dedupe on
	//the thing a row IS, which is the expression it produces: the same edit,
	//however it was reached, is one row. First wins, and first is best, because
	//the engine already ranked candidates by score and valences by rank before
	//this flattening ran.
	const seenEdits = new Set<string>();
	for (const candidate of candidates) {
		if (candidate.kind === 'recent' || candidate.kind === 'source') {
			rows.push({
				id: candidate.id,
				kind: 'destination',
				section,
				label: candidate.label,
				detail: candidate.detail,
				//A RECENT REPLACES THE DRAFT; IT DOES NOT AND IT ONTO IT. The
				//completion index's own note says so — offering valences would mean
				//offering to AND somebody's whole saved collection onto the draft —
				//and the round-3 model gives that replacement its name: a
				//combinatorial action, several changes at once, said in one line.
				description: candidate.description || description,
				destinationPath: candidate.destinationPath,
				//ONE QUIET WORD (S1). A pasted link is a collection SOURCE the
				//parser accepted; a remembered collection is a recent. Both say what
				//they are; neither says what it would do to the draft, which is the
				//detail line's job.
				annotation: candidate.kind === 'source' ? 'source' : DESTINATION_ANNOTATION,
				tier: candidate.tier,
				viewerDependent: candidate.viewerDependent,
			});
			continue;
		}
		if (candidate.sourceFilter) {
			//A CLAUSE THIS LAYER WILL NOT COMPOSE. Source is the honest offer —
			//it carries the draft's own description, because nothing has been
			//added yet and a count here would be a number for a clause that does
			//not exist.
			rows.push({
				id: candidate.id,
				kind: 'transform',
				section,
				label: candidate.label,
				detail: candidate.detail,
				description,
				sourceFilter: candidate.sourceFilter,
				filter: candidate.filter,
				//IT USED TO PIN ITS DETAIL LINE OPEN (`alwaysDetail`), which is a
				//visual grammar exactly one species of row had — the thing D3
				//forbids. Its annotation ('source') already says what kind of row it
				//is, and its explanation appears on highlight like every other
				//row's.
				annotation: candidate.annotation,
				usageKey: candidate.usageKey,
				tier: candidate.tier,
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
				description: candidate.description,
				viewerDependent: candidate.viewerDependent,
				annotation: candidate.annotation,
				usageKey: candidate.usageKey,
				//A SET, A SORT AND A VIEW ARE NOT STACKING CLAUSES. The flag
				//rides the row so the palette can refuse to treat accepting one
				//as an append, wherever the row came from.
				singleton: candidate.singleton,
				tier: candidate.tier,
			});
			continue;
		}
		const node = candidate.node;
		if (!node) continue;
		for (const valence of candidate.valences) {
			//AN `edit` IS NOT AN EDIT, so it is not deduped as one. Its expression
			//is the draft unchanged, which every other row in this list would have
			//been rejected for; here it is the honest description of an action
			//whose consequence is a pill row opening, not a new collection.
			const edit = serializeCollectionExpression(valence.expression).join('\n');
			if (valence.kind !== 'edit') {
				if (seenEdits.has(edit)) continue;
				seenEdits.add(edit);
			}
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
				//
				//A `remove` or an `edit` is about a clause the sentence ALREADY has,
				//so neither of them adds one and neither wants the add-then-open
				//treatment: `configurable` is a fact about what a row would ADD.
				//A `change` does not want it either: it REPLACES a configured
				//clause with the value the user just typed, so opening the family's
				//controls on top of the value they named would ask them for it
				//twice.
				configurable: candidate.kind === 'filter-family' && valence.kind === 'add',
				removes: valence.kind === 'remove',
				edits: valence.kind === 'edit',
				targetMemberIndex: valence.targetMemberIndex,
				filter: candidate.filter,
				label: valence.label,
				//A VALENCE'S OWN SENTENCE WHERE IT HAS ONE. A negation keeps a
				//different collection from the clause it negates, so it does not
				//inherit that clause's description — which is how the palette came
				//to print "not Tagged tag-2 — Keeps cards tagged tag-2".
				detail: valence.detail || candidate.detail,
				description: collectionDescriptionWithExpression(description, valence.expression),
				expression: valence.expression,
				pillExpression: pillExpressionForValence(valence, node),
				valenceKind: valence.kind,
				targetLabel: valence.targetLabel,
				targetIndex: valence.targetIndex,
				viewerDependent: candidate.viewerDependent,
				//THE TWO ROWS ABOUT A CLAUSE YOU ALREADY HAVE SAY SO IN THE
				//ANNOTATION SLOT, and the strike is the echo rather than the whole
				//message. Found by looking at it on the real corpus: `Remove
				//Created since 5 days ago` and `Edit Created since 5 days ago` sat
				//one above the other showing the SAME pill, and the only thing
				//telling them apart was a line through the first — which left the
				//second reading as the add grammar every other row uses. What a
				//user needs from these two is not what KIND of clause it is (it is
				//in the sentence above; they can see) but which of the two things
				//this row would do to it.
				annotation: EXISTING_CLAUSE_ANNOTATIONS[valence.kind] || candidate.annotation,
				usageKey: candidate.usageKey,
				tier: candidate.tier,
				negationRequested: valence.kind === 'not' ? Boolean(valence.requested) : undefined,
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

//--- Browse all, deleted ----------------------------------------------------

//THE `Browse all filters` GATE IS GONE, AND SO IS THE FEED BEHIND IT.
//
//The previous build kept the catalog's DATA behind a quiet link that seeded this
//list with every family under its own category headings. The owner's round-2
//model retires the link and the headings together: "the list should show some
//pre-configured items (recents/suggestions) but also just filter the WHOLE set
//(don't hide the full set of filters — it shows the power)". A list that already
//contains the whole vocabulary has nothing to browse TO, and a second feed over
//the same data could only ever rank it differently from the one feed that
//matters — which is exactly what happened: the category order outranked the
//match relevance, and Tab added the wrong filter.
//
//The vocabulary now arrives through paletteIdleRows' third run, built by the
//completion index with an empty token, ranked by the one scoring function, and
//annotated per row instead of walled per category. collection-filter-catalog
//survives as the metadata-quality gate it always also was (its test sweeps every
//filter description for internal identifiers); it no longer feeds a surface.

//--- Sentence words ---------------------------------------------------------

//SET, SORT AND VIEW ARE WORDS IN THE SENTENCE, and clicking one fills the list
//with its alternatives (meta-proposal convergence 7). The four-select setup
//strip is deleted; these rows are what replaced it, and they are the same rows
//the completion index produces for a typed set or sort name — the same edit,
//reachable two ways.
//
//AND THEY WEAR THE SAME ANATOMY AS EVERY OTHER ROW (round-3 tightness, S4).
//This feed used to be the one that carried no annotation at all: three runs of
//bare labels, in a list where every other row says what kind of thing it is. The
//word goes in the same slot ('set', 'sort', 'view'), and the option already in
//force takes '✓ current' IN THAT SLOT rather than in a fourth element of its own
//— it is the same fact the slot always carries, answered more usefully for the
//one row where "which one am I in" is the question being asked.
export type PaletteWordScope = 'set' | 'sort';

export const paletteWordRows = (
	description : CollectionDescription,
	scope : PaletteWordScope
) : PaletteRow[] => {
	//THE LIST SAYS WHICH ONE YOU ARE ALREADY IN.
	//
	//A list of alternatives with the current option silently deleted from it
	//is a list that cannot answer "what is it now?" — the sentence declines to
	//print a default sort or a list view (rightly: "sorted by default" is a
	//fact about a field), so with the option missing from its own list too
	//there was nowhere left to read it. The option stays, marked; choosing it
	//is not an edit and the palette simply closes the scope.
	if (scope === 'set') {
		return Object.entries(SET_INFOS)
			.map(([name, info]) => ({
				id: `set:${name}`,
				kind: 'transform' as const,
				section: 'Start from',
				label: collectionOptionDisplayName(name),
				detail: info.description,
				description: collectionDescriptionWithSet(description, name as SetName),
				viewerDependent: false,
				current: name === description.set,
				annotation: 'set',
			}));
	}
	const rows : PaletteRow[] = Object.entries(SORTS)
		.map(([name, info]) => ({
			id: `sort:${name}`,
			kind: 'transform' as const,
			section: 'Order by',
			label: collectionOptionDisplayName(name),
			detail: info.description,
			description: collectionDescriptionWithSort(description, name as SortName),
			viewerDependent: false,
			current: name === description.sort,
			annotation: 'sort',
		}));
	//Reversing is a property of the order, so it belongs in the order's own
	//list rather than in a fifth control the strip used to carry.
	rows.push({
		id: 'sort-reversed',
		kind: 'transform',
		section: 'Order by',
		label: description.sortReversed ? 'Normal order' : 'Reverse order',
		detail: description.sortReversed ? 'Puts the order back the way round it usually runs.' : 'Runs the same order backwards.',
		description: collectionDescriptionWithSortReversed(description, !description.sortReversed),
		viewerDependent: false,
		annotation: 'sort',
	});
	for (const mode of Object.keys(LEGAL_VIEW_MODES)) {
		rows.push({
			id: `view:${mode}`,
			kind: 'transform',
			section: 'Show as',
			label: collectionOptionDisplayName(mode),
			detail: `Shows this collection as ${collectionOptionDisplayName(mode)}.`,
			current: mode === description.viewMode,
			annotation: 'view',
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
