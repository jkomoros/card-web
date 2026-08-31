//THE PILL ROW: ONE LINE, UNDER THE SENTENCE, FOR THE PILL YOU JUST SELECTED.
//
//This replaces the anchored editor panels. Proposal C's argument is that a
//clause exists in exactly one place — the sentence — and that everything you can
//do to it should appear at the place you see it, in one row rather than in a
//panel that hosts a whole filter-family editor. The shape it specifies is
//literally the line below:
//
//    updated after [2026-01-01] [–– no end ––]   · draft now matches 184
//    [Also match…] [Invert] ✕                    · without this pill: 1,842
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
	CONFIGURABLE_FILTER_INFO,
	ME_AUTHOR_ID,
	piecesForConfigurableFilter,
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

	//WHAT THE DRAFT WOULD MATCH, and what it would match WITHOUT this pill.
	//Properties, not questions this row asks: the preview machinery that knows
	//lives with the palette. Undefined means "not known yet", and an unknown
	//count is omitted rather than rendered as a zero or a dash — a number in
	//this row is a promise about a collection, and there is nothing honest to
	//say before the answer arrives.
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
			   wrap does and what a fixed layout would have to be told twice. */
			.row {
				align-items: center;
				display: flex;
				flex-wrap: wrap;
				gap: 0.5em;
				padding: 0.35em 0;
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
			   as more of the sentence. 0.4em between them so adjacent boxes do
			   not read as one segmented control. Centred, so the ✕ sits on the
			   same line as the two boxes beside it. */
			.verbs {
				align-items: center;
				border-left: 1px solid var(--app-divider-color);
				display: flex;
				gap: 0.4em;
				padding-left: 0.6em;
			}

			/* THESE HAVE TO READ AS PRESSABLE (owner: "the Or… Flip Remove don't
			   read as buttons and are kind of confusing" — the labels in that
			   quote are the ones they wore at the time).

			   button.small is the sanctioned transparent variant (§4.2) and it
			   carries a verb here rather than a glyph, which is the composer's
			   own .verb extension — but transparent purple text with a hover
			   underline is the app's LINK treatment, and a row of them reads as
			   prose. What they get is the outlined chip the composer already
			   uses for exactly this class of thing: the palette's
			   .suggestion-action[data-consequence='transform'] — 1px
			   --app-primary-color border, transparent fill, purple label — which
			   marks a control that REWRITES THE DRAFT rather than one that
			   leaves.

			   TWO of them now wear it, not three. Widening and inverting rewrite
			   the clause and leave it on screen; removal deletes it, which is a
			   different species and takes the app's ✕ instead (see button.remove
			   below). Dropping it out of this treatment is the point: an
			   outlined Remove sat in the same box as the two rewrites and
			   claimed to be one of them.

			   NOT button.text: §4.2's named text variant is the FILLED purple
			   block for banners and gates, and it is the treatment of THE one
			   committing action. These are peers — neither commits, and neither
			   outranks the other — so filling one would be a claim about the
			   pill that is not true.

			   Square (§4.4), and 44px tall (§4.2's floor, which .small does not
			   carry on its own). */
			button.verb {
				border: 1px solid var(--app-primary-color);
				color: var(--app-primary-color);
				min-height: 44px;
				padding: 0 0.7em;
			}

			/* The fill the palette's own rows take on hover, so a pointer over a
			   verb gets the same answer it gets over a row. The border is
			   already there, so nothing moves. */
			button.verb:hover {
				background: var(--app-primary-color-light-very-transparent);
			}

			/* REMOVAL IS THE ✕, NOT A WORD (owner, F1). Every other removal in
			   this app is the same glyph in the same place: the sentence pill's
			   own control is tag-chip's trailing ✕, and the composer's design
			   note calls it "the most guessable gesture in the UI". A third
			   bordered word beside two bordered words made removal look like a
			   third way to REWRITE the clause, which the other two are and this
			   one is not.

			   So it does NOT take button.verb: it is the plain transparent
			   button.small icon treatment (§4.2), which is what the app's other
			   ✕ controls wear. It keeps the trailing position tag-chip and the
			   sentence pill put theirs in. Icon-only, so it carries BOTH a title
			   and an aria-label (HS §2.5) — a title alone leaves it nameless on
			   touch, and an aria-label alone leaves it silent on hover. 44px in
			   both directions, since .small carries no floor of its own. */
			button.remove {
				align-items: center;
				display: inline-flex;
				justify-content: center;
				min-height: 44px;
				min-width: 44px;
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
		return piecesForConfigurableFilter(leaf.filter);
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
		const spelling = family + '/' + pieces.map(piece => piece.value).join('/');
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
	//leaving the caret behind the row it just opened. Same contract
	//configure-collection-filter's own focusPrimaryControl states.
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
	//the user commits to it. Only an inverse-less filter becomes an outlined
	//not-pill, and the title says that instead.
	//
	//The verb is INVERT, not Flip (owner, F2). "Flip" is a gesture word — it
	//says something turns over without saying what turns into what — and the
	//title beneath it was already promising a WORD. Invert is the word for the
	//result. The expression layer's own function names (withNegationToggled)
	//are untouched: they name the operation on a tree, not the button.
	get _invertTitle() : string {
		const node = this._node;
		if (!node) return '';
		const inverted = this._labelFor(negatedExpressionNode(node));
		return conditionCanUseNamedInverse(node) ?
			`This becomes “${inverted}”` :
			`This becomes “${inverted}”, shown as an outlined pill`;
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
				${this.draftCount === undefined ? '' : html`<span class='count'>· draft now matches ${formatCollectionCardCount(this.draftCount)}</span>`}
				<span class='verbs'>
					<button class='small verb' title='Widen this to also match something else' @click=${this._handleOr}>${OR_VERB_LABEL}</button>
					<button class='small verb' title=${this._invertTitle} @click=${this._handleInvert}>${INVERT_VERB_LABEL}</button>
					<button class='small remove' title=${removeTitle} aria-label=${removeTitle} @click=${this._handleRemove}>${CANCEL_ICON}</button>
				</span>
				${this.withoutCount === undefined ? '' : html`<span class='count'>· without this pill: ${formatCollectionCardCount(this.withoutCount)}</span>`}
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
