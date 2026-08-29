//THE PILL ROW: ONE LINE, UNDER THE SENTENCE, FOR THE PILL YOU JUST SELECTED.
//
//This replaces the anchored editor panels. Proposal C's argument is that a
//clause exists in exactly one place — the sentence — and that everything you can
//do to it should appear at the place you see it, in one row rather than in a
//panel that hosts a whole filter-family editor. The shape it specifies is
//literally the line below:
//
//    updated after [2026-01-01] [–– no end ––]   · draft now matches 184
//    [Or…] [Flip] [Remove]                       · without this pill: 1,842
//
//A one-row editor cannot squash, and every pill has real contents — polarity,
//or, remove at minimum — so a dead Edit affordance is structurally impossible.
//
//WHAT THIS STEP BUILDS AND WHAT IT DOES NOT. The shell, the scope line, and the
//flip/remove/or wiring against the draft layer's own editing helpers, plus the
//date argument control reparented from configure-collection-filter as proof
//that reparenting is all it takes. The counts are PROPERTIES: this component
//never asks what a draft would match, because the thing that knows is the
//palette's preview machinery and it arrives with the palette. Card-valued
//arguments (key-card, multiple-cards) come with it too — they need the
//find-dialog picker, which is the palette's to open.
//
//NO STORE, LIKE THE SENTENCE. Flip and remove produce a whole new expression and
//hand it over; "or…" is a REQUEST, because this row knows which token an
//alternative would join but not what the alternative is.

import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './configure-collection-date.js';

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
	piecesForConfigurableFilter,
	splitCompoundFilter,
} from '../filters.js';

import {
	FilterModifiedEvent,
	makeExpressionModifiedEvent,
	makePillOrRequestedEvent,
} from '../events.js';

import {
	ConfigurableFilterControlPiece,
} from '../types.js';

//THE KEYS THE FOOTER TEACHES, in one place, because the footer that teaches them
//and the row that performs them must not disagree. `+` and `-` are deliberately
//the URL's own spellings for union and exclusion: the shortcut a user learns
//here is the character they will one day read in source mode, so the ladder
//teaches downward. The palette renders these; this row implements them.
export const PILL_ROW_KEY_HINTS : readonly {key : string, means : string}[] = [
	{key: '+', means: 'adds an or'},
	{key: '-', means: 'flips'},
	{key: 'Enter', means: 'edits'},
	{key: 'Delete', means: 'removes'},
];

//The one control type this step reparents. The rest are named so the switch
//below is a decision rather than a fallthrough.
const REPARENTED_CONTROL_TYPES : ReadonlySet<string> = new Set(['date']);

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

			.verbs {
				display: flex;
				gap: 0.25em;
			}

			/* button.small is the sanctioned transparent variant (§4.2); here it
			   carries a verb rather than a glyph, and takes the 44px target that
			   variant does not carry on its own. */
			button.verb {
				color: var(--app-primary-color);
				min-height: 44px;
				padding: 0 0.4em;
			}

			button.verb:hover {
				text-decoration: underline;
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

	//REPARENTED, NOT REWRITTEN. configure-collection-date already knows how to
	//edit a date boundary, including the rolling-date vocabulary, and it already
	//speaks filter-modified-complex. It is dropped in here unchanged; a control
	//type this step has not reparented yet renders nothing rather than a broken
	//affordance, which is the same rule that kills dead Edit buttons.
	_argumentControl(piece : ConfigurableFilterControlPiece, subIndex : number) : TemplateResult {
		if (!REPARENTED_CONTROL_TYPES.has(piece.controlType)) return html``;
		return html`<configure-collection-date
			.value=${piece.value}
			data-sub-index=${subIndex}
			@filter-modified-complex=${this._handleArgumentChanged}
		></configure-collection-date>`;
	}

	_handleArgumentChanged(e : FilterModifiedEvent) {
		const leaf = this._argumentLeaf;
		if (!leaf || leaf.kind !== 'filter') return;
		const element = e.composedPath()[0];
		if (!(element instanceof HTMLElement)) return;
		const subIndex = parseInt(element.dataset.subIndex || '0');
		const [family] = splitCompoundFilter(leaf.filter);
		const pieces = piecesForConfigurableFilter(leaf.filter);
		if (!pieces[subIndex]) return;
		pieces[subIndex].value = e.detail.value;
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

	//--- The verbs -----------------------------------------------------------

	//FLIP PROMISES WHAT THE PILL WILL READ. The app's own inverse names come
	//first, so flipping `published` yields a pill that simply says
	//"unpublished" — plain language, no operator — and the title says so BEFORE
	//the user commits to it. Only an inverse-less filter becomes an outlined
	//not-pill, and the title says that instead.
	get _flipTitle() : string {
		const node = this._node;
		if (!node) return '';
		const flipped = this._labelFor(negatedExpressionNode(node));
		return conditionCanUseNamedInverse(node) ?
			`This becomes “${flipped}”` :
			`This becomes “${flipped}”, shown as an outlined pill`;
	}

	_handleFlip() {
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
		return html`
			<div class='row' role='group' aria-label=${`Editing ${label}`}>
				<span class='scope'>${label}</span>
				${note ? html`<span class='scope-note'>${note}</span>` : ''}
				${this._argumentControls()}
				${this.draftCount === undefined ? '' : html`<span class='count'>· draft now matches ${formatCollectionCardCount(this.draftCount)}</span>`}
				<span class='verbs'>
					<button class='small verb' title='Widen this to also match something else' @click=${this._handleOr}>Or…</button>
					<button class='small verb' title=${this._flipTitle} @click=${this._handleFlip}>Flip</button>
					<button class='small verb' title=${this.memberIndex < 0 ? 'Remove this from the collection' : 'Remove this alternative'} @click=${this._handleRemove}>Remove</button>
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
