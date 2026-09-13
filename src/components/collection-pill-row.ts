//THE PILL ROW: ONE LINE, UNDER THE SENTENCE, FOR THE PILL YOU JUST SELECTED.
//
//This replaces the anchored editor panels. Proposal C's argument is that a
//clause exists in exactly one place — the sentence — and that everything you can
//do to it should appear at the place you see it, in one row rather than in a
//panel that hosts a whole filter-family editor. The shape it specifies is
//literally the line below:
//
//    updated after [2026-01-01] [–– no end ––]                          ✕
//    Also match…  Invert          · removing this: 184 cards → 1,842 cards
//
//with the ✕ pinned to the section's upper right, where this app dismisses
//things (DialogElement's #close), rather than sitting in the verb row.
//
//A one-row editor cannot squash, and every pill has real contents — polarity,
//or, remove at minimum — so a dead Edit affordance is structurally impossible.
//
//EVERY ARGUMENT CONTROL THE GUIDED FAMILIES NEED IS REPARENTED HERE. The first
//cut carried only the date control, as proof that reparenting is all it takes;
//the palette needs the rest, so the whole switch from configure-collection-filter
//moved across — card values through the find-dialog picker
//(configure-collection-key-card already opens it), multiple cards, contributor
//ids, reference types, and the plain number/text fields a ply or a limit is.
//What did NOT move is `sub-filter` / `expand-filter`: those are the structural
//families this layer models as manual pills, and offering a control for a clause
//we said we could not edit is exactly the dead affordance the design forbids.
//
//The counts stay PROPERTIES: this component never asks what a draft would match,
//because the thing that knows is the palette's preview machinery.
//
//NO STORE, LIKE THE SENTENCE. Invert and remove produce a whole new expression and
//hand it over; "or…" is a REQUEST, because this row knows which token an
//alternative would join but not what the alternative is.

import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { live } from 'lit/directives/live.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './configure-collection-date.js';
import './configure-collection-key-card.js';
import './configure-collection-multiple-cards.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	conditionCanUseNamedInverse,
	describeExpressionNode,
	negatedExpressionNode,
	serializeFilterNode,
	withConditionRemoved,
	withMemberNegationToggled,
	withMemberRemoved,
	withNegationToggled,
	withNodeReplaced,
} from '../collection-expression.js';

import {
	formatCollectionCardCount,
} from '../collection-composer-preview.js';

import {
	collectionFilterIsStructural,
} from '../collection-pill-palette.js';

import {
	CONFIGURABLE_FILTER_INFO,
	ME_AUTHOR_ID,
	QUERY_FILTER_NAME,
	QUERY_STRICT_FILTER_NAME,
	piecesForConfigurableFilter,
	queryFilter,
	queryTextFromQueryFilter,
	splitCompoundFilter,
} from '../filters.js';

import {
	REFERENCE_TYPES,
} from '../../shared/card_fields.js';

import {
	CANCEL_ICON,
} from '../../shared/icons.js';

import {
	FilterModifiedEvent,
	makeExpressionModifiedEvent,
	makePillOrRequestedEvent,
} from '../events.js';

import {
	ConfigurableFilterControlPiece,
	TagInfos,
	Uid,
} from '../types.js';

//THE WIDENING VERB SAYS WHAT THE NEXT SCREEN ASKS.
//
//It used to read 'Or…', which is the URL's operator with an ellipsis after it:
//a person who has not read the source grammar cannot tell whether it means "or
//what?", "or else", or a menu. The owner's complaint was that the three verbs
//"are kind of confusing", and this is the one carrying the confusion.
//
//'Also match…' is the phrase the palette ALREADY uses for the question this
//button opens — the or-scoped input's placeholder is `Also match… (widens
//<clause>)` — so the button names the next screen in the next screen's own
//words, and no concept is added: 'alternative' stays an implementation word,
//and the operator stays in source mode where it is spelled `+`.
export const OR_VERB_LABEL = 'Also match…';

//THE POLARITY VERB NAMES THE RESULT, NOT THE GESTURE (owner, F2).
//
//It read 'Flip' — a word about the motion of the control rather than about the
//clause. What the button actually does is replace a condition with its
//opposite, and the title under it was ALREADY promising that in those terms
//("This becomes “Unpublished”"). 'Invert' is the word for that, and it is now
//the app's one user-facing word for the operation: the filter descriptions that
//spelled it 'flip' say 'invert' too.
//
//Only the LABEL changes. The expression layer's negatedExpressionNode /
//withNegationToggled keep their names, because they name an operation on a
//tree, and nobody but a reader of this file meets them.
export const INVERT_VERB_LABEL = 'Invert';

//THE KEY HINTS ARE DELETED WITH THE LINE THAT RENDERED THEM (owner, F4: "this
//text … is unnecessary"). This table existed for exactly one consumer — the
//composer's footer — and a table whose only job was to keep that line honest
//has nothing left to be honest about. The KEYS are untouched: `+`, `-`, Enter
//and Delete are still performed by this row and by the palette's keydown
//handler, and the app's shortcut sheet is where a contract now lives.

//THE TWO CONTROL TYPES THIS ROW REFUSES, stated as a refusal rather than as an
//allow-list so that a family which grows a new argument type gets the plain
//field the filter editor's own switch would have given it, instead of silently
//losing its control.
//
//`sub-filter` and `expand-filter` are the structural families the draft layer
//preserves as manual pills. A clause we told the user we cannot edit here must
//not sprout a control that says otherwise — that is complaint #8's dead
//affordance, one level down.
const REFUSED_CONTROL_TYPES : ReadonlySet<string> = new Set(['sub-filter', 'expand-filter']);

//The two families whose one argument is free text rather than a name — the two
//filters.js's queryFilter writes and queryTextFromQueryFilter reads.
const queryFamily = (family : string) : boolean =>
	family === QUERY_FILTER_NAME || family === QUERY_STRICT_FILTER_NAME;

//THE ARGUMENT'S NAME, IN THE COMPOSER'S VOICE.
//
//A configurable filter's `description` was written for the filter registry, and
//it shows: 'Date Range' is Title Case engine vocabulary, and beside a pill that
//reads "Updated since 7 days ago" it labels the control with a noun rather than
//with the question the control answers. These are the ones the palette actually
//puts on screen; anything not listed keeps the registry's own word, so a family
//that grows an argument gets a real label rather than a blank one.
const ARGUMENT_LABEL_COPY : Readonly<Record<string, string>> = {
	'Date Range': 'When',
	'The key card': 'Which card',
	'Key Card': 'Which card',
	'Ply': 'How many steps',
	'Reference Type': 'Kind of link',
	'User ID': 'Whose cards',
	'Query': 'Words to look for',
	'Cards': 'Which cards',
	'Count': 'How many',
};

const argumentLabel = (description : string) : string => ARGUMENT_LABEL_COPY[description] || description;

@customElement('collection-pill-row')
class CollectionPillRow extends LitElement {

	@property({ type : Array })
		expression : CollectionExpression = [];

	//WHICH TOKEN THIS ROW IS ABOUT, in the same two numbers the sentence's own
	//events carry: `index` is the condition, and `memberIndex` is one
	//alternative inside a group when it is >= 0 and the condition itself
	//otherwise. A row with an out-of-range index renders nothing rather than
	//guessing.
	@property({ type : Number })
		index = -1;

	@property({ type : Number })
		memberIndex = -1;

	@property({ type : Object })
		labels : Record<string, string> = {};

	@property({ type : Object })
		cardNames : Record<string, string> = {};

	//What the card-valued controls need to call a card by its title rather than
	//its id, and what the contributor control needs to offer names. Passed
	//straight through to the reparented controls, exactly as
	//configure-collection-filter passed them.
	@property({ type : Object })
		cardTagInfos : TagInfos = {};

	@property({ type : Array })
		userIDs : Uid[] = [];

	@property({ type : Object })
		userInfos : TagInfos = {};

	//THE TWO SIDES OF ONE CONSEQUENCE, and the row states both or neither
	//(owner, F2).
	//
	//It used to render only the second: `· without this pill: 34.4k cards`, a
	//number with no counterpart beside it. Read cold, that says a collection is
	//34.4k cards — the opposite of what it means — because the value it is a
	//comparison AGAINST was three inches away in the footer and never named as
	//the other half of the same sentence. A consequence stated one-sided is not
	//a consequence; it is a number.
	//
	//So the row now says the transition, in the SAME grammar every other
	//consequence in the composer is written in: `current → after`, the palette
	//list's own `_rowCountText` spelling, both sides formatted by the one
	//`formatCollectionCardCount`. One consequence language everywhere, whether
	//the consequence is a row you might press or the clause you have selected.
	//
	//`draftCount` is the WITH side and is REUSED, not re-measured: the palette
	//already runs a preview for the draft (it is what the footer prints), so
	//this is the same number arriving over the same wire, and no second worker
	//run exists to disagree with it.
	//
	//Undefined means "not known yet". BOTH must be known before either is
	//shown: half a transition is exactly the one-sided reading this fix exists
	//to delete, so a row mid-flight prints nothing rather than a number that
	//would be misread while it waits.
	@property({ type : Number })
		draftCount : number | undefined = undefined;

	@property({ type : Number })
		withoutCount : number | undefined = undefined;

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display: block;
			}

			/* ONE ROW THAT WRAPS, not a grid: the argument controls for a date
			   are several controls wide and the verbs must stay beside them on a
			   wide screen and fall under them on a narrow one, which is what
			   wrap does and what a fixed layout would have to be told twice.

			   IT IS ALSO THE SURFACE THE ✕ IS PINNED TO (owner, F1), so it is
			   positioned, and it reserves the ✕'s column on the right. The
			   reservation is unconditional and full-height rather than clever:
			   this row wraps, so anything that fitted "beside" the glyph on one
			   viewport would slide under it on another, and the whole
			   requirement is that the ✕ never overlaps a control or a label at
			   any editor size. 44px is the glyph's own target (§4.2). */
			.row {
				align-items: center;
				display: flex;
				flex-wrap: wrap;
				gap: 0.5em;
				padding: 0.35em 44px 0.35em 0;
				position: relative;
			}

			/* THE ROW ALWAYS NAMES ITS SCOPE. On a group, clicking a segment and
			   clicking the edge open the same row about different things, and a
			   row that did not say which would make that difference invisible —
			   the spatial rule the meta-proposal flags as a risk. */
			.scope {
				color: var(--app-dark-text-color-darker);
				font-weight: bold;
			}

			.scope-note,
			.count {
				color: var(--app-dark-text-color-light);
				font-size: 0.85em;
			}

			/* AN ARGUMENT IS A LABELLED CONTROL ON ONE CENTERLINE (owner, F3:
			   "the labels on some configurable filter controls … are not
			   consistent vertically").

			   The label used to ride ABOVE its field, and that is what produced
			   the inconsistency, because it was only ever half a rule. A row of
			   arguments centres its items, so a tall argument (the date, which
			   stacks a legend over two radios over a field) hangs its label at
			   the TOP of a 90px block while a short one (a ply, a limit) hangs
			   its label 30px lower — and the date control's own boundary legend
			   landed at a third height again. Measured on the live app before
			   this change: 'When' at y=150, 'Date' at y=167, the radios at
			   y=193, the fields at y=216. Four lines for one question.

			   ONE RULE INSTEAD: every label/control pair is a flex ROW with
			   align-items: center, here and inside each reparented editor, so
			   the label sits on its control's centerline whatever that control's
			   height is — and every pair therefore sits on the row's own
			   centerline too. It costs horizontal space, which is what
			   flex-wrap on .row is for. */
			.argument {
				align-items: center;
				display: inline-flex;
				flex-direction: row;
				gap: 0.4em;
				/* AND THE OTHER HALF OF THE CAUSE, which is easy to miss because
				   it is not written here: ButtonSharedStyles gives every <label> a
				   margin-top of 1em, for the stacked form it was written for. An
				   .argument IS a <label>, so it arrived with 12px of margin on
				   top — and a flex row centres the MARGIN box, which parks the
				   control 6px below the line everything else is on. Zeroed
				   explicitly rather than by luck. */
				margin: 0;
				min-width: 0;
			}

			/* 0.85em, not 0.75em. This row sits inside a dialog that has already
			   stepped down once, and the date control below it steps down again
			   for its own legends — three compounding reductions put the words
			   'Date Range', 'Fixed' and 'Rolling' on screen at nine pixels, which
			   is not a size anything a user has to READ may be rendered at. The
			   label is subordinate by COLOUR; it does not also have to be small.
			   --app-dark-text-color-darker for the same reason the receipt takes
			   it: -light is ~2.3:1 on white and this is text, not decoration. */
			.argument-label {
				color: var(--app-dark-text-color-darker);
				font-size: 0.85em;
				/* A label that wraps to two lines re-centres itself against its
				   control and breaks the very centerline this rule exists to
				   hold. These are two or three words each. */
				white-space: nowrap;
			}

			/* §4.2's 44px floor: the reparented controls brought their own
			   sizing from a panel that had room, and this is a one-line row. */
			.argument select,
			.argument input {
				max-width: 100%;
				min-height: 44px;
			}

			/* The verbs are a GROUP, and they are separated from the argument
			   controls to their left by a rule rather than by whitespace alone:
			   in a row that wraps, loose words floating after a date field read
			   as more of the sentence. 0.4em between them so adjacent verbs do
			   not read as one segmented control. */
			.verbs {
				align-items: center;
				border-left: 1px solid var(--app-divider-color);
				display: flex;
				gap: 0.4em;
				padding-left: 0.6em;
			}

			/* THE VERBS WEAR THE TEXT-VERB TREATMENT THIS DIALOG ALREADY SHIPS
			   (owner, F2), copied rule for rule rather than approximated.

			   SUPERSEDED: the previous wave gave them a 1px --app-primary-color
			   outline, borrowed from the palette's
			   .suggestion-action[data-consequence='transform'] CHIP — which is a
			   label painted on a row, not a button anyone presses. As a button
			   treatment it existed nowhere else in the app, and the owner's
			   verdict on it is the reversal: it is alien.

			   The inventory of what the app actually ships is in the report; the
			   one idiom for two PEER TEXT VERBS INSIDE A DIALOG SURFACE is
			   configure-collection-dialog's own button.small.verb — transparent,
			   --app-primary-color label, margin 0, a 44px floor — which is worn by
			   "Copy link", "Edit source", "Edit visually", "order and view", and
			   most exactly by the pair "Keep editing" / "Return to last valid
			   collection": two peer text verbs, side by side, in this same dialog,
			   neither of which commits. These three declarations ARE that rule.

			   Not button.text (§4.2's filled purple block is THE committing
			   action, and these are peers that commit nothing), and not
			   button.discard (the low-emphasis companion to a text button, for
			   dismissing — which is what the ✕ below is now for). */
			button.small.verb {
				color: var(--app-primary-color);
				margin: 0;
				/* §4.2's 44px minimum; .small is 18x18 with padding: 0. */
				min-height: 44px;
			}

			/* REMOVAL IS THE ✕, IN THE UPPER RIGHT (owner, F1). It is the app's
			   dismiss idiom, and the app states that idiom in exactly one place:
			   DialogElement's own #close — button.small, absolutely positioned
			   at the top right of the surface it dismisses. This is the same
			   glyph (CANCEL_ICON), the same variant, and the same placement,
			   against the configurable section instead of against a dialog.

			   It sat in the verb row before, which put a control that DELETES
			   the clause on the same line as two that rewrite it. Its own
			   species is dismissal, and dismissal in this app happens in the
			   corner.

			   Icon-only, so it carries BOTH a title and an aria-label (HS §2.5)
			   — a title alone leaves it nameless on touch, and an aria-label
			   alone leaves it silent on hover. 44px in both directions, since
			   .small carries no floor of its own, and .row reserves that column
			   so nothing can ever land under it. */
			button.remove {
				align-items: center;
				display: inline-flex;
				justify-content: center;
				min-height: 44px;
				min-width: 44px;
				position: absolute;
				right: 0;
				top: 0;
			}
		`
	];

	//--- What this row is about ----------------------------------------------

	get _condition() : FilterExpressionNode | null {
		if (this.index < 0 || this.index >= this.expression.length) return null;
		return this.expression[this.index];
	}

	//The node the verbs act on: the condition itself, or one alternative inside
	//it. Every other getter reads THIS rather than re-deriving the address.
	get _node() : FilterExpressionNode | null {
		const condition = this._condition;
		if (!condition) return null;
		if (this.memberIndex < 0) return condition;
		if (condition.kind !== 'or') return null;
		return condition.members[this.memberIndex] || null;
	}

	_labelFor(node : FilterExpressionNode) : string {
		return describeExpressionNode(node, this.labels, this.cardNames).label;
	}

	//--- Arguments -----------------------------------------------------------

	//The leaf whose arguments are editable, if there is one. A negated clause
	//edits its CHILD's arguments — "not updated after X" is still a question
	//about X — and the negation is re-applied when the edit lands.
	get _argumentLeaf() : FilterExpressionNode | null {
		const node = this._node;
		if (!node) return null;
		if (node.kind === 'filter') return node;
		if (node.kind === 'not' && node.child.kind === 'filter') return node.child;
		return null;
	}

	get _argumentPieces() : ConfigurableFilterControlPiece[] {
		const leaf = this._argumentLeaf;
		if (!leaf || leaf.kind !== 'filter') return [];
		const [family, rest] = splitCompoundFilter(leaf.filter);
		//Both guards matter: piecesForConfigurableFilter warns to the console
		//for a filter that is not configurable, and every plain filter in the
		//app would reach it.
		if (!rest || !CONFIGURABLE_FILTER_INFO[family]) return [];
		const pieces = piecesForConfigurableFilter(leaf.filter);
		//THE QUERY FAMILIES' ARGUMENT IS PROSE, AND THE URL SPELLS IT ENCODED.
		//
		//piecesForConfigurableFilter hands back the raw path segment, which for
		//every other family IS the value a person would type. For a query it is
		//not: `query/systems+thinking` would put `systems+thinking` in a box
		//labeled "Query text", and a search that ever contained a slash or a
		//percent would read back as escapes. So this one family is decoded on
		//the way in and re-spelled on the way out (see _applyArgumentValue) —
		//the box holds the words, the URL holds the encoding, and neither can
		//leak into the other.
		if (!queryFamily(family)) return pieces;
		return pieces.map(piece => ({...piece, value: queryTextFromQueryFilter(leaf.filter)}));
	}

	_argumentControls() : TemplateResult {
		const pieces = this._argumentPieces;
		if (!pieces.length) return html``;
		return html`${pieces.map((piece, subIndex) => this._argumentControl(piece, subIndex))}`;
	}

	//REPARENTED, NOT REWRITTEN. Each of these controls already knows its own
	//vocabulary — configure-collection-date the rolling-date words,
	//configure-collection-key-card the find-dialog picker, the two selects the
	//app's own contributor and reference-type names — and each already speaks
	//the event the handler below listens for. They are dropped in unchanged; a
	//control type this row refuses renders nothing rather than a broken
	//affordance, which is the same rule that kills dead Edit buttons.
	//
	//The label is the argument's own `description`, which is the only text that
	//says what the field is FOR — a bare date box beside a pill reads as a date
	//with no question attached.
	_argumentControl(piece : ConfigurableFilterControlPiece, subIndex : number) : TemplateResult {
		if (REFUSED_CONTROL_TYPES.has(piece.controlType)) return html``;
		return html`<label class='argument'><span class='argument-label'>${argumentLabel(piece.description)}</span>${this._argumentControlPart(piece, subIndex)}</label>`;
	}

	_argumentControlPart(piece : ConfigurableFilterControlPiece, subIndex : number) : TemplateResult {
		switch (piece.controlType) {
		case 'date':
			return html`<configure-collection-date
				.value=${piece.value}
				data-sub-index=${subIndex}
				@filter-modified-complex=${this._handleArgumentChanged}
			></configure-collection-date>`;
		case 'multiple-cards':
			return html`<configure-collection-multiple-cards
				.value=${piece.value}
				.cardTagInfos=${this.cardTagInfos}
				data-sub-index=${subIndex}
				@filter-modified-complex=${this._handleArgumentChanged}
			></configure-collection-multiple-cards>`;
		case 'key-card':
			return html`<configure-collection-key-card
				.value=${piece.value}
				.cardTagInfos=${this.cardTagInfos}
				data-sub-index=${subIndex}
				@filter-modified-complex=${this._handleArgumentChanged}
			></configure-collection-key-card>`;
		//The options select THEMSELVES, for the reason the filter editor's own
		//comment gives: a `.value` binding on the <select> commits before the
		//child part that renders the <option>s, so it lands on an empty select
		//and is dropped, leaving the control showing its first option while the
		//clause says something else.
		case 'user-id':
			return html`<select aria-label=${piece.description} data-sub-index=${subIndex} @change=${this._handleArgumentInput}>${[ME_AUTHOR_ID, ...this.userIDs].map(item => html`<option value=${item.toLowerCase()} .selected=${live(item.toLowerCase() === piece.value)}>${item === ME_AUTHOR_ID ? 'Me' : (this.userInfos?.[item]?.title || item)}</option>`)}</select>`;
		case 'reference-type':
			return html`<select aria-label=${piece.description} data-sub-index=${subIndex} @change=${this._handleArgumentInput}>${Object.entries(REFERENCE_TYPES).map(entry => html`<option value=${entry[0]} .title=${entry[1].description} .selected=${live(entry[0] === piece.value)}>${entry[1].name}</option>`)}</select>`;
		default:
			return html`<input
				aria-label=${piece.description}
				type=${piece.controlType === 'int' || piece.controlType === 'float' ? 'number' : 'text'}
				min='0'
				step=${piece.controlType === 'float' ? 0.0001 : 1}
				data-sub-index=${subIndex}
				@change=${this._handleArgumentInput}
				.value=${piece.value}
			>`;
		}
	}

	//The two shapes an argument edit arrives in, funnelled to one rule. A
	//complex control carries its new value in the event; a plain select or input
	//carries it on the element.
	_handleArgumentChanged(e : FilterModifiedEvent) {
		this._applyArgumentValue(e.composedPath()[0], e.detail.value);
	}

	_handleArgumentInput(e : Event) {
		const element = e.composedPath()[0];
		if (!(element instanceof HTMLSelectElement) && !(element instanceof HTMLInputElement)) return;
		this._applyArgumentValue(element, element.value);
	}

	_applyArgumentValue(target : EventTarget | undefined, value : string) {
		const leaf = this._argumentLeaf;
		if (!leaf || leaf.kind !== 'filter') return;
		if (!(target instanceof HTMLElement)) return;
		const subIndex = parseInt(target.dataset.subIndex || '0');
		const [family] = splitCompoundFilter(leaf.filter);
		const pieces = piecesForConfigurableFilter(leaf.filter);
		if (!pieces[subIndex]) return;
		pieces[subIndex].value = value;
		//A QUERY IS SPELLED BY THE APP'S ONE SPELLER, not concatenated. Joining
		//the raw box contents wrote user prose straight into a URL path: a query
		//for `view/grid` produced `query/view/grid`, three segments where the
		//family's parser takes one, so the collection read it as a search for
		//'view' and two filters it had never heard of; a `%` made the query
		//filter's own reader throw on a path this composer had just written.
		//The query families take exactly one argument, so the speller's output
		//is the whole clause.
		const spelling = queryFamily(family) ?
			queryFilter(value, family === QUERY_STRICT_FILTER_NAME) :
			family + '/' + pieces.map(piece => piece.value).join('/');
		const node = this._node;
		//A negated clause keeps its negation across an argument edit. It has to
		//go back through negatedExpressionNode rather than being re-wrapped by
		//hand, or a family that grew a named inverse would be spelled two ways.
		const replacement : FilterExpressionNode = node && node.kind === 'not' ?
			negatedExpressionNode({kind: 'filter', filter: spelling}) :
			{kind: 'filter', filter: spelling};
		this._emit(withNodeReplaced(this.expression, this.index, this.memberIndex, replacement));
	}

	//Whether focus actually landed, so the palette can fall back rather than
	//leaving the caret behind the row it just opened. The contract is the one
	//the deleted configure-collection-filter published and the nested argument
	//controls still implement.
	focusPrimaryControl() : boolean {
		const nested = this.shadowRoot?.querySelector<HTMLElement & {focusPrimaryControl? : () => boolean}>(
			'.argument configure-collection-date, .argument configure-collection-key-card, .argument configure-collection-multiple-cards'
		);
		if (nested?.focusPrimaryControl) return nested.focusPrimaryControl();
		const plain = this.shadowRoot?.querySelector<HTMLElement>('.argument select, .argument input');
		if (!plain) return false;
		plain.focus();
		return true;
	}

	//--- The verbs -----------------------------------------------------------

	//INVERT PROMISES WHAT THE PILL WILL READ. The app's own inverse names come
	//first, so inverting `published` yields a pill that simply says
	//"unpublished" — plain language, no operator — and the title says so BEFORE
	//the user commits to it.
	//
	//The verb is INVERT, not Flip (owner, F2 of the previous wave). "Flip" is a
	//gesture word — it says something turns over without saying what turns into
	//what — and the title beneath it was already promising a WORD. Invert is the
	//word for the result. The expression layer's own function names
	//(withNegationToggled) are untouched: they name the operation on a tree, not
	//the button.
	//
	//NO RENDERING VOCABULARY IN THE PROMISE (owner, F3). The inverse-less branch
	//used to end ", shown as an outlined pill" — which describes the PAINT this
	//app happens to apply to a negated clause, in words ('outlined', 'pill')
	//that name nothing the user has a concept for and that would be a lie the
	//day the treatment changed. What the user needs to know is not how the
	//clause will look but what collection it will name, so the tail says THAT:
	//the promised word, then the meaning of the promised word. The
	//resulting-word promise itself — the quoted label — is the good half and is
	//untouched; only the paint is replaced by the meaning.
	//Whether this clause is one the two verbs can honestly be offered for — see
	//the comment beside them in render(). Asked of the member rather than of the
	//group when a member is selected, because that is the clause being edited.
	//
	//ASKED OF THE LEAF, NOT OF THE SERIALIZATION. A negated ordinary clause
	//serializes as `exclude/tag-3`, and `exclude` is a structural FAMILY — so
	//testing the spelling would have refused Invert to every already-inverted
	//clause and made the app's own involution one-way. The question is what the
	//clause is ABOUT, and negation does not change that.
	get _verbsAllowed() : boolean {
		const node = this._node;
		if (!node) return false;
		let leaf : FilterExpressionNode = node;
		while (leaf.kind === 'not') leaf = leaf.child;
		//An OR is a union of predicates by construction, and a manual node is
		//already refused its controls elsewhere.
		if (leaf.kind !== 'filter') return true;
		return !collectionFilterIsStructural(leaf.filter);
	}

	get _invertTitle() : string {
		const node = this._node;
		if (!node) return '';
		const inverted = this._labelFor(negatedExpressionNode(node));
		return conditionCanUseNamedInverse(node) ?
			`This becomes “${inverted}”` :
			`This becomes “${inverted}” — everything except those cards`;
	}

	_handleInvert() {
		if (!this._node) return;
		this._emit(this.memberIndex < 0 ?
			withNegationToggled(this.expression, this.index) :
			withMemberNegationToggled(this.expression, this.index, this.memberIndex));
	}

	//Removing an alternative DISSOLVES a group that no longer needs to be one,
	//which is the draft layer's rule and not this row's: withMemberRemoved
	//already returns the survivor rather than a one-member OR.
	_handleRemove() {
		if (!this._node) return;
		this._emit(this.memberIndex < 0 ?
			withConditionRemoved(this.expression, this.index) :
			withMemberRemoved(this.expression, this.index, this.memberIndex));
	}

	_handleOr() {
		this.dispatchEvent(makePillOrRequestedEvent(this.index, this.memberIndex));
	}

	_emit(expression : CollectionExpression) {
		if (expression === this.expression) return;
		this.dispatchEvent(makeExpressionModifiedEvent(expression));
	}

	//--- Render --------------------------------------------------------------

	get _scopeNote() : string {
		const condition = this._condition;
		if (this.memberIndex < 0 || !condition) return '';
		//A member's row says which group it is one of, so segment-scope and
		//edge-scope are told apart by words rather than by where you tapped.
		return `one alternative in ${this._labelFor(condition)}`;
	}

	//THE REMOVAL CONSEQUENCE, IN THE LIST'S OWN GRAMMAR. Empty when either side
	//is unknown — see the properties above for why half of it is worse than none
	//of it. 'Removing this' rather than 'without this pill': the row is already
	//labelled with the clause it is about, so the phrase only has to name the
	//EDIT, and 'pill' was a word about paint (owner, F3) in a line whose whole
	//job is to be about cards.
	get _removalConsequence() : string {
		if (this.draftCount === undefined || this.withoutCount === undefined) return '';
		return `removing this: ${formatCollectionCardCount(this.draftCount)} → ${formatCollectionCardCount(this.withoutCount)}`;
	}

	override render() {
		const node = this._node;
		if (!node) return html``;
		const label = this._labelFor(node);
		const note = this._scopeNote;
		//The ✕ is icon-only, so this string is both its hover name and its
		//accessible name (HS §2.5), and it still says WHICH thing goes: on a
		//group's member, removing the alternative is not removing the filter.
		const removeTitle = this.memberIndex < 0 ? 'Remove this filter' : 'Remove this alternative';
		return html`
			<div class='row' role='group' aria-label=${`Editing ${label}`}>
				<span class='scope'>${label}</span>
				${note ? html`<span class='scope-note'>${note}</span>` : ''}
				${this._argumentControls()}
				<!-- THE VERBS ARE FOR CLAUSES THAT MAKE CLAIMS ABOUT CARDS. A
				     structural clause does not — a limit matches everything and is
				     applied after the sort — so widening it against another clause
				     and inverting it are a no-op and a silent emptying
				     respectively. See collectionFilterIsStructural. Its argument
				     control and its ✕ stay: changing the limit and removing it are
				     both real. -->
				${this._verbsAllowed ? html`<span class='verbs'>
					<button class='small verb' title='Widen this to also match something else' @click=${this._handleOr}>${OR_VERB_LABEL}</button>
					<button class='small verb' title=${this._invertTitle} @click=${this._handleInvert}>${INVERT_VERB_LABEL}</button>
				</span>` : ''}
				${this._removalConsequence ? html`<span class='count'>· ${this._removalConsequence}</span>` : ''}
				<!-- LAST IN THE SOURCE, TOP-RIGHT ON SCREEN (owner, F1). It stays
				     inside the group so it keeps the "Editing <clause>" context
				     its own name does not repeat, and it comes last so a keyboard
				     walks the clause's own controls before reaching the one that
				     deletes the clause. -->
				<button class='small remove' title=${removeTitle} aria-label=${removeTitle} @click=${this._handleRemove}>${CANCEL_ICON}</button>
			</div>
		`;
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'collection-pill-row': CollectionPillRow;
	}
}

export { CollectionPillRow };

//Exported for the palette, which will want to name the clause a row is about in
//its own copy without re-deriving the address.
export const pillRowSpellingFor = (expression : CollectionExpression, index : number, memberIndex : number) : string => {
	const condition = expression[index];
	if (!condition) return '';
	if (memberIndex < 0) return serializeFilterNode(condition);
	if (condition.kind !== 'or') return '';
	const member = condition.members[memberIndex];
	return member ? serializeFilterNode(member) : '';
};
