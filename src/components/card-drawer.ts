import { LitElement, html, css } from 'lit';

import './loading-placeholder.js';
import { LoadingSharedStyles } from './loading-placeholder.js';
import { customElement, property } from 'lit/decorators.js';

import {
	URLDiagnostic
} from '../../shared/url-diagnostics.js';

import './card-renderer.js';
import './card-thumbnail-list.js';
import { PARTIAL_MATCH_COUNT_NOTE } from './card-thumbnail-list.js';
import './web-renderer.js';

import {
	PLUS_ICON,
	INSERT_DRIVE_FILE_ICON,
	ARROW_DOWN_ICON,
	ARROW_RIGHT_ICON,
} from '../../shared/icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { SharedStyles } from './shared-styles.js';
import { ScrollingSharedStyles } from './scrolling-shared-styles.js';

import {
	CARD_TYPE_CONFIGURATION,
	DEFAULT_CARD_TYPE
} from '../../shared/card_fields.js';

import * as icons from '../../shared/icons.js';

import {
	shortcutKeys
} from '../shortcuts-data.js';

import {
	CardID,
	CardType,
} from '../types.js';

import {
	Collection
} from '../collection_description.js';

import {
	makeAddCardEvent,
	makeAddWorkingNotesCardEvent,
	makeInfoZippyClickedEvent
} from '../events.js';

@customElement('card-drawer')
class CardDrawer extends LitElement {

	@property({ type : Boolean })
		grid: boolean;

	@property({ type : Boolean })
		reorderable: boolean;

	@property({ type : Boolean })
		selectable: boolean;

	//If set, this is what type of card type will be added when add is
	//pressed. This is used entirely for display within this component;
	//the actual card adding is done by the parent component based on
	//the add-card event.
	@property({ type : String})
		cardTypeToAdd: CardType;

	@property({ type : Boolean })
		showCreateCard: boolean;

	//If true, will show the button to add working notes card no matter what
	@property({ type : Boolean })
		showCreateWorkingNotes: boolean;

	//False while card sync is not live: creation would be refused by the action
	//creator, so the buttons gray out and explain themselves instead of firing
	//an alert per click.
	@property({ type : Boolean })
		createEligible: boolean;

	//Why creation is unavailable, derived from the actual sync status by the
	//parent. Empty when it is available.
	@property({ type : String })
		createBlockedReason: string;

	@property({ type : Object })
		collection: Collection | null;

	//True while the shown collection is the previous (stale) one because the
	//worker hasn't pushed the current description's result yet — dims the
	//list and labels it, so stale content is never mistaken for current.
	@property({ type : Boolean })
		updating: boolean;

	//Set while the active collection has not been served yet. `updating` only
	//covers the case where a PREVIOUS ready collection is being held as stale,
	//which a first boot does not have — so without this the cold visit showed a
	//bare "0 cards".
	@property({ type : Boolean })
		pending: boolean;

	//Non-empty when the worker reported this collection's run THREW (#739).
	//A failed collection must not read as a confident empty one — "0 cards"
	//was exactly how a one-line filter bug hid for weeks.
	@property({ type : String })
		failureMessage: string;

	//URL parts of this collection the parser could not understand (#757):
	//the URL says one thing, the app is showing another, and silence here is
	//what let a typo'd filter widen an Edit All Cards selection.
	@property({ type : Array })
		urlDiagnostics: URLDiagnostic[];

	@property({ type : Number })
		renderOffset: number;

	@property({ type : Boolean })
		ghostCardsThatWillBeRemoved: boolean;

	@property({ type : String })
		highlightedCardId: CardID;

	@property({ type : Boolean })
		fullCards: boolean;

	@property({ type : Boolean })
		reorderPending: boolean;

	//_showing is more complicated than whether we're open or yet.
	@property({ type : Boolean })
		showing: boolean;

	@property({ type : Boolean })
		infoExpanded: boolean;

	@property({ type : Boolean })
		infoCanBeExpanded: boolean;

	static override styles = [
		ButtonSharedStyles,
		ScrollingSharedStyles,
		SharedStyles,
		LoadingSharedStyles,
		css`
			:host {
				max-height:100%;
			}

			.container {
				height:100%;
				display:flex;
				flex-direction:column;
				position: relative;
			}

			.container.grid {
				width:100%;
			}

			.scrolling {
				max-height:100%;
				flex-grow:1;
			}

			.buttons {
				position: absolute;
				display:flex;
				left: 1em;
				bottom: 1em;
			}

			.reordering {
				opacity:0.7;
			}

			.label {
				color: var(--app-dark-text-color);
				font-weight:normal;
				margin:0.5em;
			}

			/* DIRECT children only. Without the child combinator this also
			   matched the nested .failure span and applied 0.7em a SECOND
			   time, rendering the "this collection couldn't be computed"
			   message at ~7.8px — the smallest text in the label, for the most
			   important thing it ever says.
			   (No backticks in here either: same tagged-template hazard the
			   note below describes for backslash escapes.) */
			.label > span {
				/* can't be on .label itself because then it affects margin */
				font-size:0.7em;
			}

			/* The dim itself comes from LoadingSharedStyles now — this rule
			   hand-rolled the same 0.55 and the same 0.15s ease-in that the
			   primitive exports, which is exactly the duplication it exists to
			   end. Only the pointer-events override is local. */
			.container.updating .scroller {
				pointer-events: auto;
			}

			/* NOTE: no backslash escapes in this template literal. It is a
			   tagged template, so an invalid JS escape (e.g. '\\2026') makes
			   the cooked string undefined and silently drops this ENTIRE
			   stylesheet. Use the literal character instead. */
			/* While the list is empty the label itself says "loading…", so the
			   pin would be a second word for the same fact, and dimming an
			   empty scroller communicates nothing. */
			.container.updating.initial-load .loading-pin {
				display: none;
			}

			.container.updating.initial-load .scroller {
				opacity: 1;
			}

			/* SUPERSEDED by loading-placeholder[partial], which was extracted
			   from this rule. It stays only as the anchor for the pin's
			   position; the pin itself renders in the element now, in a grey
			   that passes rather than this one's 2.30:1. */
			.container.updating .loading-pin {
				position: absolute;
				top: 0;
				right: 0;
			}

			.grid #count {
				width: 100%;
			}

			#count {
				text-align: center;
				margin-top: 0;
				margin-bottom: 0;
				/* tag-list can get wide, but keep it thin */
				width: 12em;
			}

/* THE GROUPED-COUNT RULES ARE DELETED WITH THE THING THEY GROUPED
			   THE COUNT WITH (owner, F3). They existed to line the card count up
			   with the always-visible collection summary in the visible-info
			   slot, and to hand the slotted action panels back the centring that
			   alignment had taken from them. The summary is gone, so the count is
			   the centred 12em line it has always been and the panels never lose
			   their centring in the first place. */

						/* A qualifier on the count, not a state of its own. Subordinate
			   tone (§4.5) for the same reason .diagnostic takes it: nothing
			   went wrong, the app is telling the user something true about
			   the results it did produce. */
			#count .partial-note {
				color: var(--app-dark-text-color-light);
			}

			#count .failure {
				/* A computation THREW: that is a problem, so it takes the
				   problem colour. It used to be amber to signal "nothing was
				   lost", but amber means "not yet on the server" everywhere
				   else in the app, and a colour cannot say nothing was lost —
				   the sentence does that now. */
				color: var(--app-warning-color);
				font-weight: bold;
			}

			#count .diagnostic {
				/* NOT the same state as .failure, despite once sharing its
				   colour: nothing went wrong here. The app understood the URL
				   differently than it was written and proceeded. That is an
				   informational note, so it steps down from amber — but only to
				   body-text grey, NOT to --app-dark-text-color-light (#AAA),
				   which is ~2.3:1 on white and fails WCAG AA outright.
				   corpus-status-indicator.ts:111 already rejected that exact
				   token for that exact reason. This notice exists because
				   silence here once let a typo'd filter widen an Edit All Cards
				   selection, so it has to stay readable. The full explanation of
				   what the app did instead is in the tooltip.

				   Honest about what this buys: 2.32:1 to 4.00:1 clears AA-large
				   but is still short of AA's 4.5:1 for normal text. It is the
				   darkest neutral the palette has — #767676 would be the
				   smallest change that passes, and adding a token is a design
				   decision rather than a drive-by. */
				color: var(--app-dark-text-color);
			}

		`
	];

	//PER COLLECTION, NOT PER RENDER.
	//
	//Counted over exactly the cards `currentCount` counts — sortedCards is the
	//windowed list, and numCards excludes start cards and honours offset/limit.
	//Counting the whole partialMatches map instead would let a windowed
	//collection claim more partial matches than it has rows, which is the sort
	//of arithmetic the '-761 cards' bug above came from.
	//
	//But `sortedCards` is a GETTER that re-slices the sorted list on every
	//access, so asking it inside render() copied the collection and walked it
	//again on every render of this component — for a count that cannot change
	//while the collection is the same object. A Collection is rebuilt whenever
	//its description or its inputs change, so its identity is the exact key, and
	//holding one number plus one reference retains nothing (the collection is
	//already this component's own property).
	_partialCountCollection : Collection | null = null;
	_partialCountValue = 0;

	_partialCount() : number {
		const collection = this.collection;
		if (!collection) return 0;
		if (this._partialCountCollection === collection) return this._partialCountValue;
		this._partialCountCollection = collection;
		this._partialCountValue = collection.sortedCards.filter(card => collection.partialMatches[card.id]).length;
		return this._partialCountValue;
	}

	override render() {

		const cardTypeToAddConfiguration = CARD_TYPE_CONFIGURATION[this.cardTypeToAdd];
		const currentCount = this.collection ? this.collection.numCards : 0;
		const partialCount = this._partialCount();

		//HIDE, don't destroy. Returning a fresh `<div hidden>` when not showing
		//tore down card-thumbnail-list and rebuilt it on every drawer toggle —
		//and on every editor minimize/restore, which also flips `showing` —
		//losing the list's scroll position each time. master used ?hidden here.
		return html`
			<div ?hidden=${!this.showing} class='container ${this.reorderPending ? 'reordering':''} ${this.grid ? 'grid' : ''} ${this.updating && !this.failureMessage ? 'updating' : ''} ${(this.updating || this.pending) && !currentCount && !this.failureMessage ? 'initial-load' : ''}'>
				${this.updating && !this.failureMessage ? html`<loading-placeholder class='loading-pin' partial noun='cards'></loading-placeholder>` : ''}
				<!-- BACK INSIDE THE SCROLLER, where it was before #498 (owner,
				     F3). It was lifted out to keep the always-visible collection
				     summary from scrolling away — "nothing that says persistent
				     can be the first item of a scrolling region" — and that
				     summary is deleted. What is left in this header is the count,
				     the URL diagnostics and the two slotted info panels, and the
				     expanded panel is a word cloud plus a dozen actions: pinned
				     outside the scroller it would push the card list off the
				     bottom of the drawer the moment the zippy is opened, which is
				     the entry point the owner asked to go back to. -->
				<div class='scrolling scroller ${this.updating && !this.failureMessage ? 'loading-dim' : ''}'>
					<div class='label' id='count'>
						<span>
							${this.infoCanBeExpanded ? html`<button class='small' title=${this.infoExpanded ? 'Hide the details' : 'Show the details'} aria-label=${this.infoExpanded ? 'Hide the details' : 'Show the details'} aria-expanded=${this.infoExpanded ? 'true' : 'false'} @click=${this._handleZippyClicked}>${this.infoExpanded ? ARROW_DOWN_ICON : ARROW_RIGHT_ICON}</button>` : '' }
							${this.failureMessage
		//A failed run outranks both other states: rendering "0 cards" for a
		//collection that THREW is a lie (#739 — exactly how a one-line
		//filter bug hid for weeks), and "loading…" would promise a result
		//that is not coming. The full error is in the tooltip.
		? html`<span class='failure' title=${this.failureMessage}>This collection couldn’t be computed — your cards are fine</span>`
		: (this.updating || this.pending) && !currentCount
		//"0 cards" plus an "updating…" pin reads as "this list is empty and
		//something is wrong", which on a slow first visit is the site's first
		//impression. An empty list that is still loading has no count worth
		//reporting yet -- say that instead. Once there ARE cards, the count is
		//real and the dim + pin correctly mean "these are stale, refreshing".
			? html`<loading-placeholder noun='cards'></loading-placeholder>`
			//THE COUNT INCLUDES THE PARTIAL MATCHES, so it says so. A
			//partial match is a full member of the collection — it is
			//counted, it is listed, it is navigable — that simply
			//matched some of the query's words rather than all of them
			//together. It was rendered at 50% opacity with no legend
			//anywhere, so a user looking at '117 cards' over a list
			//half of which was faded had no way to learn what the
			//fading meant or whether those cards were in the 117. They
			//are. The qualifier is a subordinate note (§4.5), not a
			//warning: nothing failed.
			//The separator is inside ONE interpolated string rather than
			//written as markup, because a leading space at the start of
			//an element's text is collapsed away and the count read
			//'590 cards· 389 …'.
			: html`<strong>${currentCount}</strong> cards${partialCount ? html`<span class='partial-note'>${` · ${partialCount === currentCount ? 'all' : partialCount} ${PARTIAL_MATCH_COUNT_NOTE}`}</span>` : ''}`}
						</span>
						${this.urlDiagnostics && this.urlDiagnostics.length ? this.urlDiagnostics.map(diagnostic => html`
							<div class='diagnostic' title=${diagnostic.fallback}>Didn’t understand “${diagnostic.part}” in this URL</div>`) : ''}
						<div class='info-panel' ?hidden=${!this.infoExpanded}>
							<slot name='info'></slot>
						</div>
						<div class='info-panel'>
							<slot name='visible-info'></slot>
						</div>
					</div>
					${this.collection && this.collection.description.viewMode == 'web' ?
		html`<web-renderer .webInfo=${this.collection.webInfo} .highlightedCardId=${this.highlightedCardId}></web-renderer>` :
		html`<card-thumbnail-list
				.collection=${this.collection}
				.grid=${this.grid}
				.reorderable=${this.reorderable}
				.selectable=${this.selectable}
				.fullCards=${this.fullCards}
				.highlightedCardId=${this.highlightedCardId}
				.ghostCardsThatWillBeRemoved=${this.ghostCardsThatWillBeRemoved}
				.renderOffset=${this.renderOffset}>
			</card-thumbnail-list>`
}
				</div>
				<div class='buttons'>
					<span class='reason' ?hidden='${!this.showCreateWorkingNotes}' title="${this.createEligible ? `Create a new working notes card (${shortcutKeys('create-working-notes-card')})` : this.createBlockedReason}"><button title='Create a working-notes card' aria-label='Create a working-notes card' class='round' @click='${this._handleCreateWorkingNotes}' ?disabled='${!this.createEligible}'>${INSERT_DRIVE_FILE_ICON}</button></span>
					<span class='reason' ?hidden='${!this.showCreateCard}' title=${this.createEligible ? `Add a new card of type ${this.cardTypeToAdd} in this section (${shortcutKeys('create-card')})` : this.createBlockedReason}><button title='Create a card' aria-label='Create a card' class='round' @click='${this._handleAddSlide}' ?disabled='${!this.createEligible}'>${!this.cardTypeToAdd || this.cardTypeToAdd == DEFAULT_CARD_TYPE || !cardTypeToAddConfiguration?.iconName ? PLUS_ICON : icons[cardTypeToAddConfiguration.iconName] }</button></span>
				</div>
			</div>
		`;
	}

	_handleZippyClicked() {
		this.dispatchEvent(makeInfoZippyClickedEvent());
	}

	_handleAddSlide() {
		if (!this.showCreateCard || !this.createEligible) return;
		this.dispatchEvent(makeAddCardEvent());
	}

	_handleCreateWorkingNotes() {
		if (!this.createEligible) return;
		this.dispatchEvent(makeAddWorkingNotesCardEvent());
	}

	constructor() {
		super();
		this.renderOffset = 0;
		this.createEligible = true;
		this.createBlockedReason = '';
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'card-drawer': CardDrawer;
	}
}
