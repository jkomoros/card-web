//THE SENTENCE, RENDERED ONCE, FOR EVERY SURFACE THAT SHOWS A COLLECTION.
//
//A collection is a sentence: a set name, a run of conditions joined by quiet
//interpuncts, and a sort tail. The drawer header shows it, the composer palette
//shows it, and a recents row shows it in miniature. Before this file each of
//those surfaces built the sentence out of its own template, which is why the
//drawer said "AND" in capitals over a draft whose operators were already quiet,
//and why a clause could look like a chip in one place and a table cell in
//another. One renderer means the surfaces cannot disagree about what a
//collection is called.
//
//WHAT IT KNOWS AND WHAT IT REFUSES TO KNOW. It takes an expression (the boolean
//draft layer's tree), the set/sort/view words, and the naming inputs the display
//path needs. It has NO store connection and dispatches NO actions: every gesture
//leaves as an event, and each host decides what it means — the drawer navigates
//and shows a receipt, the palette edits a draft. That is what makes it one
//component with two hosts rather than two components with one name.
//
//THE ARIA PATTERN IS `toolbar`, AND THE ALTERNATIVE WAS `listbox`.
//
//Listbox is the tempting one: `selectedPath` maps straight onto aria-selected,
//and arrow-key traversal is listbox's own keyboard contract. It is rejected for
//two reasons, one fatal.
//
//  - The fatal one: `role=option` requires presentational children. The pill's
//    remove control — the ✕ the whole design calls the most guessable gesture in
//    software — would be silently stripped from the accessibility tree, so the
//    one affordance a mouse user gets for free would be invisible to everyone
//    else. A pattern that hides a control is not an accessible pattern.
//  - The honest one: a listbox promises that selecting an option CHOOSES a
//    value. Nothing here does. Selecting a token means "this is the token I am
//    about to act on" — focus, not choice. `toolbar`'s documented contract is
//    exactly that: a set of controls, one tab stop, arrows move among them.
//
//`role=group` nests legally inside a toolbar, which is how an OR-group announces
//itself as one token containing alternatives, and it gives the group an
//aria-label naming the whole condition — the thing a member-by-member reading
//would never say out loud.
//
//NON-INTERACTIVE MODE DROPS THE ROLE ENTIRELY. A sentence nobody can edit is
//prose, and announcing prose as a toolbar with zero controls is worse than
//saying nothing. The role, the roving tabindex, and the ✕ all arrive together
//with `interactive`.

import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import './tag-chip.js';
import './tag-chip-group.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CollectionExpression,
	FilterExpressionNode,
	describeExpressionNode,
	serializeFilterNode,
} from '../collection-expression.js';

import {
	ConditionVerdict,
} from '../collection-membership.js';

import {
	collectionFilterDescription,
	collectionOptionDisplayName,
} from '../collection-composer-suggestions.js';

import {
	makeConditionActivatedEvent,
	makeConditionRemovedEvent,
	makeConditionSelectedEvent,
	makeGroupEdgeSelectedEvent,
	makeMemberSelectedEvent,
	makeSetClickedEvent,
	makeSortClickedEvent,
	TagEvent,
} from '../events.js';

import {
	TagInfos,
} from '../types.js';

import {
	SetName,
	SortName,
	ViewMode,
} from '../../shared/types.js';

//WHAT A CLAUSE THE APP COULD NOT RESOLVE MEANS, in one sentence, for a mouse.
//Ported from card-view, which had the only copy: the strike is the sentence's
//business now, so the sentence owns the words that explain it. The drawer's own
//"Didn't understand" notice still carries the full account of what the app did
//instead — this marks the clause, it does not replace the notice.
export const UNRESOLVED_CLAUSE_NOTE = 'This app didn’t understand this clause, so it isn’t part of the collection or its count';

//A clause this layer cannot model is preserved verbatim and offered only
//edit-in-source and remove. Saying so on hover is the difference between a pill
//that looks broken and one that looks deliberately untouched.
export const MANUAL_CLAUSE_NOTE = 'This app can’t edit this clause here — open Source to change it';

//TWO FILLS, AND THIS IS THE SECOND ONE.
//
//The spec warns against turning every word into a colourful pill, so colour
//appears only where it ALREADY means something: a value pill wears the real
//colour its tag, section or person already has everywhere else in the app.
//Everything else — every property clause, every configurable filter, every
//manual clause — is this one neutral. The boundary is therefore not a taste
//call the renderer makes per filter family; it is a lookup: a clause whose
//spelling is a key in tagInfos has a colour of its own, and a clause that is not
//does not.
//
//--app-dark-text-color-darker rather than the lighter greys because tag-chip
//sets white text on its fill: #AAA would be 2.32:1 and #7f7f7f 4.00:1 under
//0.7em bold text, and §4.1 does not have an exception for pills.
const NEUTRAL_PILL_COLOR = 'var(--app-dark-text-color-darker)';

//The path to the selected token: [] for nothing, [index] for a condition (or a
//group's own edge), [index, memberIndex] for one alternative inside a group.
export type CollectionSentencePath = readonly number[];

const EMPTY_PATH : CollectionSentencePath = [];

@customElement('collection-sentence')
class CollectionSentence extends LitElement {

	@property({ type : Array })
		expression : CollectionExpression = [];

	@property({ type : String })
		set : SetName = 'main';

	@property({ type : String })
		sort : SortName = 'default';

	@property({ type : Boolean })
		sortReversed = false;

	@property({ type : String })
		viewMode : ViewMode = 'list';

	@property({ type : String })
		viewModeExtra = '';

	//The REAL colours: whatever map of tags, sections or people the host has.
	//A clause whose spelling is a key here is a value pill and takes that
	//colour; everything else is neutral. See NEUTRAL_PILL_COLOR.
	@property({ type : Object })
		tagInfos : TagInfos = {};

	//The live corpus's own names for its filters, and the titles of cards a
	//clause is anchored to. Both go straight through to the one function that
	//decides a filter's display name, so a pill, a suggestion row and a receipt
	//cannot disagree about what a clause is called.
	@property({ type : Object })
		labels : Record<string, string> = {};

	@property({ type : Object })
		cardNames : Record<string, string> = {};

	@property({ type : Object })
		filterDescriptions : Record<string, string> = {};

	//The raw URL segments the parser could not resolve, exactly as the arrival's
	//own diagnostics named them.
	@property({ type : Array })
		unresolvedFilters : readonly string[] = [];

	@property({ type : Boolean })
		interactive = false;

	//Drawer mode: the same sentence at the drawer's subordinate scale. It is
	//deliberately NOT tag-chip's own `subtle`, which paints
	//grayscale(80%) opacity(40%) — that state already means "this pill does not
	//pass" in the why-here reading of the same pills, and a control at 40%
	//opacity fails §4.1 besides. Scale is the drawer's difference; meaning is
	//not.
	@property({ type : Boolean })
		subtle = false;

	//THE VERDICTS, WHEN A HOST HAS A CARD TO JUDGE THE SENTENCE AGAINST.
	//
	//Null — the default, and what the drawer and the palette pass — means this
	//sentence makes no claim about any card, and every pill renders at full
	//treatment. The why-here panel passes one verdict per condition and the
	//pills dim to say which clauses this card fails.
	//
	//DIMMING IS tag-chip's OWN `subtle`, not a new state: grayscale(80%)
	//opacity(40%) already means "this is here for reference, not for you" every
	//other place the app uses it, and step 2's report identified it as the
	//does-not-pass rendering. That is also why the sentence's own `subtle`
	//property deliberately does NOT set it (see that property's note): scale is
	//the drawer's difference, and this is meaning.
	//
	//Clutter conservation, stated as a rule the meta-proposal already made:
	//pass-marks only with an active card. A sentence with no verdicts must not
	//grow a single pixel of verdict machinery.
	@property({ type : Array })
		verdicts : readonly ConditionVerdict[] | null = null;

	//ONE CONDITION, WITHOUT THE SENTENCE AROUND IT.
	//
	//A completion row renders AS THE PILL IT WOULD BECOME (proposal A's token
	//discipline), and the pill it would become is a condition — not a whole
	//collection. Rendered by the ordinary path a one-condition expression comes
	//out as "Main · tagged systems", which names a set the row is not proposing
	//and an interpunct joining it to nothing.
	//
	//The alternative was a second pill renderer for the list, which is exactly
	//the fork this component exists to prevent: the row's pill and the pill it
	//turns into a keystroke later have to be the same component over the same
	//node, or they can disagree about a colour, a negation or a group.
	@property({ type : Boolean })
		conditionsOnly = false;

	//CONTROLLED, not self-managed. The host owns the selection, because the host
	//is what shows the pill row for it. Keyboard and pointer gestures report;
	//they do not decide. One source of truth, at the cost of a host that must
	//actually wire it.
	@property({ type : Array })
		selectedPath : CollectionSentencePath = EMPTY_PATH;

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display: inline;
			}

			/* The sentence is INLINE content, so a host can clamp it with its own
			   -webkit-box and get a real two-line truncation. A flex container
			   here would have taken that away from the drawer. */
			.sentence {
				display: inline;
			}

			.subtle {
				font-size: 0.82em;
				line-height: 1.25;
			}

			/* THE SET AND SORT ARE WORDS, NOT CONTROLS THAT LOOK LIKE WORDS.
			   §4.2 has no "invisible button" variant and inventing one would be a
			   fifth button system; so the button treatment is removed down to the
			   text it wraps, and the affordance is carried by the cursor, the
			   hover underline and the focus ring — the same way a link behaves.
			   The set reads at the sentence's own weight and colour: it is the
			   first clause, not decoration. */
			button.word {
				background: transparent;
				box-shadow: none;
				color: var(--app-dark-text-color-darker);
				cursor: pointer;
				font: inherit;
				margin: 0;
				padding: 0;
				text-align: left;
			}

			button.word:hover {
				background: transparent;
				box-shadow: none;
				text-decoration: underline;
			}

			button.word.tail {
				color: var(--app-dark-text-color-light);
				font-size: 0.85em;
			}

			.set {
				color: var(--app-dark-text-color-darker);
			}

			/* OPERATORS ARE STRUCTURE, NOT CONTENT. They take the subordinate
			   step down so the clause names are what the eye lands on — the same
			   step the composer's own draft has taken since the last wave. */
			.operator,
			.tail {
				color: var(--app-dark-text-color-light);
				font-size: 0.85em;
			}

			.conditions {
				display: inline;
			}

			.conditions:focus {
				outline: none;
			}

			/* A CLAUSE THE APP COULD NOT RESOLVE IS NOT PART OF THE COUNT. The
			   strike is the signal, not a colour — colour alone would fail §4.1 —
			   and it is applied to the chip's own text so a struck clause is
			   still legible as the thing the user asked for. */
			[data-unresolved] {
				text-decoration: line-through;
			}

			/* The group's own "or", and the quiet "not" in front of a negated
			   group. Lowercase and subordinate: the user is not being taught an
			   operator, they are reading a sentence. */
			.member-operator,
			.group-negation {
				color: var(--app-dark-text-color-light);
				font-size: 0.85em;
				padding: 0 0.15em;
			}
		`
	];

	override render() {
		if (this.conditionsOnly) return html`<span class='sentence ${this.subtle ? 'subtle' : ''}'>${this._conditions()}</span>`;
		return html`<span class='sentence ${this.subtle ? 'subtle' : ''}'>${this._setWord()}${this._conditions()}${this._tail()}<slot name='count'></slot></span>`;
	}

	//--- The words at either end --------------------------------------------

	_setWord() : TemplateResult {
		const label = collectionOptionDisplayName(this.set);
		if (!this.interactive) return html`<span class='set'>${label}</span>`;
		return html`<button class='word set' title='Change the starting set' @click=${this._handleSetClicked}>${label}</button>`;
	}

	//sorted-by and viewed-as are the sentence's last words, and they exist only
	//when they are not the default: a sentence that says "sorted by default" is
	//telling the user about a field rather than about their collection.
	get _tailPhrases() : string[] {
		const phrases : string[] = [];
		if (this.sort !== 'default' || this.sortReversed) {
			phrases.push(`sorted by ${this.sortReversed ? 'reverse ' : ''}${collectionOptionDisplayName(this.sort)}`);
		}
		if (this.viewMode !== 'list') {
			let view = `viewed as ${collectionOptionDisplayName(this.viewMode)}`;
			if (this.viewModeExtra) view += ` (${collectionOptionDisplayName(this.viewModeExtra)})`;
			phrases.push(view);
		}
		return phrases;
	}

	_tail() : TemplateResult {
		const phrases = this._tailPhrases;
		if (!phrases.length) return html``;
		const label = phrases.join(' · ');
		if (!this.interactive) return html`<span class='tail'> · ${label}</span>`;
		return html`<span class='tail'> · </span><button class='word tail' title='Change the order' @click=${this._handleSortClicked}>${label}</button>`;
	}

	//--- The conditions ------------------------------------------------------

	_conditions() : TemplateResult {
		//The interpunct joins a condition to what came BEFORE it, which in the
		//full sentence is always at least the set word. Standing alone, the
		//first condition has nothing to be joined to.
		const tokens = this.expression.map((node, index) => html`${index || !this.conditionsOnly ? html`<span class='operator' aria-hidden='true'> · </span>` : ''}${this._condition(node, index)}`);
		if (!this.interactive) return html`<span class='conditions'>${tokens}</span>`;
		return html`<span
			class='conditions'
			role='toolbar'
			aria-orientation='horizontal'
			aria-label='Collection conditions'
			@keydown=${this._handleKeyDown}
		>${tokens}</span>`;
	}

	_condition(node : FilterExpressionNode, index : number) : TemplateResult {
		//A negated GROUP is still a group: the "not" is a word in front of the
		//container rather than inside one member, because it applies to all of
		//them. Every other shape is one pill.
		const group = node.kind === 'or' ? node :
			(node.kind === 'not' && node.child.kind === 'or' ? node.child : null);
		if (group) return this._group(node, group.members, index);
		return this._pill(node, [index]);
	}

	_group(condition : FilterExpressionNode, members : readonly FilterExpressionNode[], index : number) : TemplateResult {
		const description = describeExpressionNode(condition, this._effectiveLabels, this.cardNames);
		const selected = this._pathIs([index]);
		const memberTokens = members.map((member, memberIndex) => html`${memberIndex ? html`<span class='member-operator' aria-hidden='true'>or</span>` : ''}${this._pill(member, [index, memberIndex])}`);
		//THE GROUP'S OWN VERDICT SITS ON THE GROUP, and the members keep theirs.
		//It carries no dim of its own, deliberately: "or" means a group fails
		//only when every member does, so a failing group is already a container
		//of dim pills, and a second filter over them would darken the one shape
		//that has to stay readable as one condition. What the flag is for is the
		//half a filter cannot say — the group's accessible name, and a host or a
		//test asking the sentence what it decided about the whole clause.
		const groupFails = this._verdictFor([index]) === false;
		return html`${description.negated ? html`<span class='group-negation' aria-hidden='true'>not </span>` : ''}<tag-chip-group
			role='group'
			data-fails=${ifDefined(groupFails ? '' : undefined)}
			aria-label=${this._verdictLabel(description.label, [index])}
			tabindex=${ifDefined(this.interactive ? String(this._tabIndexFor([index])) : undefined)}
			data-selected=${ifDefined(selected ? '' : undefined)}
			data-sentence-focus=${ifDefined(this._tabIndexFor([index]) === 0 ? '' : undefined)}
			@click=${(e : MouseEvent) => this._handleGroupEdgeClicked(e, index)}
		>${memberTokens}</tag-chip-group>`;
	}

	//ONE PILL, whatever depth it is at. A member of a group and a top-level
	//condition are the same rendering with a different path — which is what
	//makes unlimited nesting a later UI unlock rather than a rewrite.
	_pill(node : FilterExpressionNode, path : readonly number[]) : TemplateResult {
		const description = describeExpressionNode(node, this._effectiveLabels, this.cardNames);
		//A not-node paints as its CHILD's colour, outlined: negation does not
		//change which tag a clause is about.
		const colorNode = node.kind === 'not' ? node.child : node;
		const spelling = serializeFilterNode(colorNode);
		const conditionSpelling = serializeFilterNode(node);
		const unresolved = this.unresolvedFilters.includes(conditionSpelling);
		const selected = this._pathIs(path);
		const tabIndex = this._tabIndexFor(path);
		const label = node.kind === 'not' ? describeExpressionNode(node.child, this._effectiveLabels, this.cardNames).label : description.label;
		const note = unresolved ? UNRESOLVED_CLAUSE_NOTE :
			(node.kind === 'manual' ? MANUAL_CLAUSE_NOTE : this._filterNote(spelling, description.label));
		//A FAILING PILL IS A SUBTLE PILL. tag-chip already paints that state —
		//grayscale(80%) opacity(40%) — and it already means "not for you here",
		//so the does-not-pass reading costs one property rather than one CSS
		//state. `=== false` and not `!verdict`: no verdicts at all is not a
		//verdict of "fails".
		const fails = this._verdictFor(path) === false;
		return html`<tag-chip
			.tagName=${spelling}
			.tagInfos=${this._chipInfos(spelling, label, note)}
			.negated=${description.negated}
			.tokenized=${true}
			.editing=${this.interactive}
			.tapEvents=${true}
			.subtle=${fails}
			data-fails=${ifDefined(fails ? '' : undefined)}
			role=${ifDefined(this.interactive ? 'button' : undefined)}
			aria-label=${ifDefined(this.interactive || this.verdicts ? this._verdictLabel(this._ariaLabel(description.label, unresolved), path) : undefined)}
			aria-current=${ifDefined(selected ? 'true' : undefined)}
			aria-keyshortcuts=${ifDefined(this.interactive ? 'Delete Enter' : undefined)}
			tabindex=${ifDefined(this.interactive ? String(tabIndex) : undefined)}
			data-selected=${ifDefined(selected ? '' : undefined)}
			data-unresolved=${ifDefined(unresolved ? '' : undefined)}
			data-sentence-focus=${ifDefined(tabIndex === 0 ? '' : undefined)}
			@click=${() => this._handleTokenSelected(path)}
			@tag-removed=${(e : TagEvent) => this._handleTokenRemoved(e, path)}
		></tag-chip>`;
	}

	//THE SYNTHETIC TAGINFOS IS THE COLOUR PIPELINE, NOT A BYPASS OF IT.
	//
	//tag-chip decides everything about a chip — its name, its colour, its
	//tooltip, whether hovering it previews a card — from one tagInfos entry.
	//tag-list's own comment already says the map may describe things that are
	//not tags, and card-view already passes a hand-built one for todos. So a
	//clause becomes a chip by being given an entry: its display name as the
	//title, and either the real colour it already has in the app or the one
	//neutral. suppressLink because a clause is not a place — the containing
	//surface owns the gesture.
	_chipInfos(spelling : string, label : string, note : string) : TagInfos {
		const real = this.tagInfos[spelling];
		return {
			[spelling]: {
				id: spelling,
				title: label,
				description: note,
				color: real?.color || NEUTRAL_PILL_COLOR,
				previewCard: real?.previewCard,
				iconName: real?.iconName,
				suppressLink: true,
			}
		};
	}

	_filterNote(spelling : string, label : string) : string {
		return collectionFilterDescription(spelling, this.filterDescriptions, this.labels) || label;
	}

	//Assistive tech gets neither the strike nor the tooltip, so the token's own
	//name has to say that a clause was not applied.
	_ariaLabel(label : string, unresolved : boolean) : string {
		return unresolved ? `${label} — ${UNRESOLVED_CLAUSE_NOTE}` : label;
	}

	//--- Verdicts ------------------------------------------------------------

	//The verdict at one token's address, or null where this sentence is not
	//judging anything. A path this host gave no verdict for is null rather than
	//false: silence is not a failing grade.
	_verdictFor(path : readonly number[]) : boolean | null {
		if (!this.verdicts) return null;
		const condition = this.verdicts[path[0]];
		if (!condition) return null;
		if (path.length === 1) return condition.passes;
		const member = condition.members[path[1]];
		return member === undefined ? null : member;
	}

	//A DIM PILL IS INVISIBLE TO A SCREEN READER, so the verdict has to be a
	//word. Only where there IS one: a sentence with no verdicts says nothing
	//extra, which is what keeps the drawer's and the palette's pills named
	//exactly as they were.
	_verdictLabel(label : string, path : readonly number[]) : string {
		const verdict = this._verdictFor(path);
		if (verdict === null) return label;
		return `${label} — ${verdict ? 'this card matches' : 'this card does not match'}`;
	}

	//A TAG'S OWN TITLE IS ALREADY A NAME THE APP DECIDED, so a clause spelled
	//`tag-3` must read "Systems" in the sentence exactly as it does on a card —
	//otherwise the drawer's chip and the card's chip, which are the same
	//component over the same tag, would be two different words. The names go in
	//through `labels` rather than around the display-name function, so
	//collectionFilterDisplayName stays the one place a filter's name is decided;
	//an explicit label still wins, because that is the composer's own, more
	//specific answer for the live corpus.
	//
	//Memoized on the two inputs' identity: this runs on every render, and
	//tagInfos is the whole tag corpus.
	private _mergedLabels : Record<string, string> = {};
	private _mergedLabelsFrom : [TagInfos, Record<string, string>] | null = null;

	get _effectiveLabels() : Record<string, string> {
		const infos = this.tagInfos || {};
		const labels = this.labels || {};
		if (this._mergedLabelsFrom && this._mergedLabelsFrom[0] === infos && this._mergedLabelsFrom[1] === labels) return this._mergedLabels;
		const titles : Record<string, string> = {};
		for (const [name, info] of Object.entries(infos)) {
			if (info.title) titles[name] = info.title;
		}
		this._mergedLabels = {...titles, ...labels};
		this._mergedLabelsFrom = [infos, labels];
		return this._mergedLabels;
	}

	//--- Selection and the roving tabindex -----------------------------------

	get _path() : CollectionSentencePath {
		return this.selectedPath || EMPTY_PATH;
	}

	_pathIs(path : readonly number[]) : boolean {
		const current = this._path;
		return current.length === path.length && path.every((part, index) => current[index] === part);
	}

	//EXACTLY ONE TAB STOP IN THE TOOLBAR. With nothing selected it is the first
	//token, which is what makes Tab reach the sentence at all; with something
	//selected it is that token, so Tab returns to where the user left off.
	_tabIndexFor(path : readonly number[]) : number {
		if (!this.interactive) return -1;
		const current = this._path;
		if (current.length) return this._pathIs(path) ? 0 : -1;
		return path.length === 1 && path[0] === 0 ? 0 : -1;
	}

	//The one place a selection turns into an event. THREE disjoint events for
	//three disjoint scopes — a condition, a group's edge, one alternative —
	//because the pill row's first line has to name its scope, and a host that
	//had to re-derive the scope from a path would be re-deriving exactly what
	//this component already knows.
	_emitSelection(path : readonly number[]) {
		if (path.length === 2) {
			this.dispatchEvent(makeMemberSelectedEvent(path[0], path[1]));
			return;
		}
		const node = this.expression[path[0]];
		if (!node) return;
		const isGroup = node.kind === 'or' || (node.kind === 'not' && node.child.kind === 'or');
		this.dispatchEvent(isGroup ? makeGroupEdgeSelectedEvent(path[0]) : makeConditionSelectedEvent(path[0]));
	}

	_handleTokenSelected(path : readonly number[]) {
		if (!this.interactive) return;
		this._emitSelection(path);
	}

	//EDGE-TAP SCOPES TO THE GROUP, SEGMENT-TAP SCOPES TO THE SEGMENT. The
	//members' own clicks are handled on the chips themselves and reach here
	//afterwards by bubbling, so this only speaks for a click that landed on the
	//container's border or padding — which is exactly the edge.
	_handleGroupEdgeClicked(e : MouseEvent, index : number) {
		if (!this.interactive) return;
		//localName, NOT tagName: tag-chip shadows HTMLElement.tagName with its
		//own `tagName` property (the tag the chip is FOR), so asking a chip what
		//element it is gets the answer "starred".
		if (e.composedPath().some(target => target instanceof HTMLElement && target.localName === 'tag-chip')) return;
		this.dispatchEvent(makeGroupEdgeSelectedEvent(index));
	}

	//REMOVAL DOES NOT ALSO SELECT. tag-chip's ✕ fires tag-removed and the click
	//that produced it keeps bubbling; without this the drawer would remove the
	//clause AND open the composer, which is two answers to one gesture.
	_handleTokenRemoved(e : TagEvent, path : readonly number[]) {
		e.stopPropagation();
		this.dispatchEvent(makeConditionRemovedEvent(path[0], path.length === 2 ? path[1] : -1));
	}

	_handleSetClicked() {
		this.dispatchEvent(makeSetClickedEvent());
	}

	_handleSortClicked() {
		this.dispatchEvent(makeSortClickedEvent());
	}

	//--- The keyboard grammar ------------------------------------------------
	//
	//←/→ traverse the tokens at the current level, ↓ enters a group and ↑ leaves
	//it, Delete removes, Enter activates. Four arrows are the whole recursive
	//navigation, and reading order equals traversal order equals URL order.
	//
	//The ends CLAMP rather than wrap: → at the last condition does nothing
	//rather than teleporting to the first, because a sentence has a beginning
	//and an end and pretending otherwise loses the user's place. → inside a
	//group likewise stays inside it — leaving is what ↑ is for.

	_membersAt(index : number) : readonly FilterExpressionNode[] | null {
		const node = this.expression[index];
		if (!node) return null;
		if (node.kind === 'or') return node.members;
		if (node.kind === 'not' && node.child.kind === 'or') return node.child.members;
		return null;
	}

	_handleKeyDown(e : KeyboardEvent) {
		if (!this.interactive) return;
		const path = this._path.length ? this._path : (this.expression.length ? [0] : EMPTY_PATH);
		if (!path.length) return;
		switch (e.key) {
		case 'ArrowRight':
		case 'ArrowLeft': {
			const delta = e.key === 'ArrowRight' ? 1 : -1;
			if (path.length === 2) {
				const members = this._membersAt(path[0]);
				if (!members) return;
				const next = path[1] + delta;
				if (next < 0 || next >= members.length) return;
				e.preventDefault();
				this._emitSelection([path[0], next]);
				return;
			}
			const next = path[0] + delta;
			if (next < 0 || next >= this.expression.length) return;
			e.preventDefault();
			this._emitSelection([next]);
			return;
		}
		case 'ArrowDown': {
			if (path.length !== 1) return;
			const members = this._membersAt(path[0]);
			if (!members || !members.length) return;
			e.preventDefault();
			this._emitSelection([path[0], 0]);
			return;
		}
		case 'ArrowUp': {
			if (path.length !== 2) return;
			e.preventDefault();
			this._emitSelection([path[0]]);
			return;
		}
		case 'Delete':
		case 'Backspace':
			e.preventDefault();
			this.dispatchEvent(makeConditionRemovedEvent(path[0], path.length === 2 ? path[1] : -1));
			return;
		case 'Enter':
			e.preventDefault();
			this.dispatchEvent(makeConditionActivatedEvent(path[0], path.length === 2 ? path[1] : -1));
			return;
		default:
			return;
		}
	}

	//FOCUS FOLLOWS THE SELECTION, BUT ONLY WHEN FOCUS IS ALREADY HERE. Moving
	//the page's focus into a sentence the user is not in — because a host
	//selected a pill programmatically — would steal the caret out of the
	//composer's input, which is where the same host puts it.
	override updated() {
		if (!this.interactive) return;
		const root = this.shadowRoot;
		if (!root || !root.activeElement) return;
		const target = root.querySelector<HTMLElement>('[data-sentence-focus]');
		if (!target || target === root.activeElement) return;
		target.focus();
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'collection-sentence': CollectionSentence;
	}
}

export { CollectionSentence };
