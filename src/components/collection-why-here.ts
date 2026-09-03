//WHY THIS CARD IS HERE — THE SENTENCE, TURNED ON ITS SIDE.
//
//Proposal C's flow ⑤ and the meta-proposal's last piece: the card info panel
//gains "In this collection", the collection's own conditions laid out one per
//row with a verdict for the card on screen. Passing pills at full treatment,
//failing pills in tag-chip's subtle state, and inside an OR group the passing
//alternative lit while its siblings dim.
//
//THE PILLS ARE THE EXPLANATION. That is the whole design claim, and it is why
//this file is small: it does not describe a clause in words a second time, it
//renders the clause. A panel that said "Tagged Systems: yes" beside a pill
//saying the same thing would be the duplication the whole redesign exists to
//delete — the same clause in two representations, free to disagree.
//
//ONE ROW IS ONE `collection-sentence` OVER ONE NODE, in conditionsOnly mode.
//The alternative was a vertical mode on the sentence itself, which would have
//put a layout the drawer and the palette never use inside the component they
//both render from. Handing the sentence a one-condition expression is the mode
//it already has for exactly this reason (a completion row renders AS the pill it
//would become), so a pill here and a pill in the drawer are the same component
//over the same node and cannot disagree about a colour, a negation or a group.
//
//THE ROW IS THE CONTROL, NOT THE PILL. Tapping anywhere on a row opens the
//composer with that clause selected. The pills inside are rendered
//NON-interactively, which is what makes that legal and what keeps the ✕ out of
//an info panel: removal is an edit, and this section explains rather than edits.
//It also buys the 44px target §4.2 asks for on a surface where a pill is 1.4em
//tall, and it means a group's row scopes to the group — which is the scope the
//pill row in the palette will name when it opens.
//
//NO STORE, LIKE THE SENTENCE AND THE PILL ROW. The verdicts arrive as a
//property and a tap leaves as `condition-activated` — the event card-view
//already uses to mean "open the composer on this clause" — so the host decides
//what tapping means and this file cannot start deciding what collection is
//active.

import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './collection-sentence.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	describeExpressionNode,
} from '../collection-expression.js';

import {
	CollectionMembership,
	ConditionVerdict,
	collectionMembershipNote,
} from '../collection-membership.js';

import {
	collectionOptionDisplayName,
} from '../collection-composer-suggestions.js';

import {
	makeConditionActivatedEvent,
} from '../events.js';

import {
	TagInfos,
} from '../types.js';

import {
	SetName,
} from '../../shared/types.js';

//The panel's own idiom for a section heading (see card-info-panel's h4s), in the
//panel's own voice: it names the place the card is, not the machinery that put
//it there.
export const WHY_HERE_HEADING = 'In this collection';

@customElement('collection-why-here')
class CollectionWhyHere extends LitElement {

	@property({ type : Array })
		expression : CollectionExpression = [];

	@property({ type : String })
		set : SetName = 'main';

	//Null while there is no card to judge against, which renders nothing at all:
	//this section is a claim about one card, and a section that appeared without
	//one would be a heading over an assertion nobody made.
	@property({ type : Object })
		membership : CollectionMembership | null = null;

	@property({ type : Object })
		tagInfos : TagInfos = {};

	@property({ type : Object })
		labels : Record<string, string> = {};

	@property({ type : Object })
		cardNames : Record<string, string> = {};

	@property({ type : Object })
		filterDescriptions : Record<string, string> = {};

	@property({ type : Array })
		unresolvedFilters : readonly string[] = [];

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display: block;
			}

			/* THE SET IS QUIET TEXT, NOT A PILL. It is not a condition anyone
			   composed — it is where the sentence starts — and giving it a pill
			   would put a fourth thing in the two-fill vocabulary. */
			.set {
				color: var(--app-dark-text-color-light);
				font-size: 0.8em;
			}

			.set[data-fails] {
				opacity: 0.6;
			}

			/* ONE CONDITION PER ROW, and the row is the target. Transparent and
			   borderless: §4.2 has no invisible-button variant, so the button
			   treatment is removed down to the content it wraps and the
			   affordance is carried by the cursor and the focus ring — the same
			   way the sentence's own set and sort words behave. */
			button.row {
				background: transparent;
				box-shadow: none;
				display: block;
				font: inherit;
				margin: 0;
				min-height: 44px;
				padding: 0.1em 0;
				text-align: left;
				width: 100%;
			}

			/* The row highlight is the app's own divider tint, the same quiet
			   wash a list row takes: loud enough to say "this whole line is the
			   target", quiet enough that the pills stay the brightest thing on
			   it. */
			button.row:hover {
				background: var(--app-divider-color);
				box-shadow: none;
			}

			/* THE HONEST LINE, AND IT ONLY EXISTS WHEN THERE IS SOMETHING TO
			   ADMIT. Not an error colour: a card can be legitimately outside the
			   collection it is being read in (a fallback, a direct link), and
			   painting that red would call a normal situation a fault. */
			.note {
				color: var(--app-dark-text-color-light);
				font-size: 0.8em;
				margin-top: 0.3em;
			}
		`
	];

	override render() {
		//NOTHING TO SAY IS SAID BY SAYING NOTHING. No verdicts, or a collection
		//with no conditions ("Everything", unfiltered), and there is no question
		//for this section to answer — the clutter-conservation rule the
		//meta-proposal wrote down as a risk on record.
		if (!this.membership || !this.expression.length) return html``;
		const note = collectionMembershipNote(this.membership, this._setLabel);
		return html`
			<h4>${WHY_HERE_HEADING}</h4>
			<div class='set' ?data-fails=${!this.membership.setPasses}>${this.membership.setPasses ? 'In' : 'Not in'} ${this._setLabel}</div>
			${this.expression.map((node, index) => this._row(node, index))}
			${note ? html`<div class='note' role='note'>${note}</div>` : ''}
		`;
	}

	get _setLabel() : string {
		return collectionOptionDisplayName(this.set);
	}

	//The verdict for one condition, in the shape the sentence takes: a one-node
	//expression gets a one-verdict array, because the node's own address in that
	//sentence is 0.
	_verdictsFor(index : number) : readonly ConditionVerdict[] {
		const verdict = this.membership?.conditions[index];
		return verdict ? [verdict] : [];
	}

	_row(node : FilterExpressionNode, index : number) : TemplateResult {
		const label = describeExpressionNode(node, this.labels, this.cardNames).label;
		return html`<button
			class='row'
			title='Open this condition in the composer'
			aria-label=${`${label} — open this condition in the composer`}
			@click=${() => this._handleRowClicked(index)}
		><collection-sentence
			.expression=${[node]}
			.conditionsOnly=${true}
			.verdicts=${this._verdictsFor(index)}
			.tagInfos=${this.tagInfos}
			.labels=${this.labels}
			.cardNames=${this.cardNames}
			.filterDescriptions=${this.filterDescriptions}
			.unresolvedFilters=${this.unresolvedFilters}
		></collection-sentence></button>`;
	}

	//THE SCOPE IS THE CONDITION, memberIndex -1. A group's row opens the
	//composer on the whole group rather than on whichever alternative the finger
	//landed nearest, because the alternatives are not separately tappable here —
	//and a scope the user did not choose is worse than a wider one they did.
	_handleRowClicked(index : number) {
		this.dispatchEvent(makeConditionActivatedEvent(index, -1));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'collection-why-here': CollectionWhyHere;
	}
}

export { CollectionWhyHere };
