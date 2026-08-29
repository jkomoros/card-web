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
//NO STORE, LIKE THE SENTENCE. Flip and remove produce a whole new expression and
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
	FilterModifiedEvent,
	makeExpressionModifiedEvent,
	makePillOrRequestedEvent,
} from '../events.js';

import {
	ConfigurableFilterControlPiece,
	TagInfos,
	Uid,
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

			/* AN ARGUMENT IS A LABELLED CONTROL, INLINE. The label rides above
			   its field at the app's subordinate size rather than beside it, so
			   a two-boundary date range still reads as two questions when the
			   row wraps. */
			.argument {
				display: inline-flex;
				flex-direction: column;
				gap: 0.15em;
				min-width: 0;
			}

			.argument-label {
				color: var(--app-dark-text-color-light);
				font-size: 0.75em;
			}

			/* §4.2's 44px floor: the reparented controls brought their own
			   sizing from a panel that had room, and this is a one-line row. */
			.argument select,
			.argument input {
				max-width: 100%;
				min-height: 44px;
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
		return html`<label class='argument'><span class='argument-label'>${piece.description}</span>${this._argumentControlPart(piece, subIndex)}</label>`;
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
