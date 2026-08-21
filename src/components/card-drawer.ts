import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	URLDiagnostic
} from '../../shared/url-diagnostics.js';

import './card-renderer.js';
import './card-thumbnail-list.js';
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

			.label span {
				/* can't be on .label itself because then it affects margin */
				font-size:0.7em;
			}

			.container.updating .scroller {
				opacity: 0.55;
				transition: opacity 0.15s ease-in;
				pointer-events: auto;
			}

			/* NOTE: no backslash escapes in this template literal. It is a
			   tagged template, so an invalid JS escape (e.g. '\\2026') makes
			   the cooked string undefined and silently drops this ENTIRE
			   stylesheet. Use the literal character instead. */
			/* While the list is empty the label itself says "loading…", so the
			   pin would be a second word for the same fact, and dimming an
			   empty scroller communicates nothing. */
			.container.updating.initial-load::after {
				content: none;
			}

			.container.updating.initial-load .scroller {
				opacity: 1;
			}

			.container.updating::after {
				content: 'updating…';
				position: absolute;
				top: 0.5em;
				right: 0.5em;
				font-size: 0.7em;
				font-style: italic;
				color: var(--app-dark-text-color-light);
				/* The count label scrolls with the list but this pin does not,
				   so it can end up over a thumbnail. Keep it legible. */
				background: rgb(255 255 255 / 88%);
				padding: 0 0.3em;
				border-radius: 3px;
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

			#count .failure {
				/* Amber, not destructive red: the corpus is fine and nothing
				   was lost — this one collection's computation failed. */
				color: var(--app-pending-color);
				font-weight: bold;
			}

			#count .diagnostic {
				/* Same amber family as .failure: advisory, not destructive.
				   The full explanation of what the app did instead is in the
				   tooltip. */
				color: var(--app-pending-color);
			}

		`
	];

	override render() {

		const cardTypeToAddConfiguration = CARD_TYPE_CONFIGURATION[this.cardTypeToAdd];
		const currentCount = this.collection ? this.collection.numCards : 0;

		//HIDE, don't destroy. Returning a fresh `<div hidden>` when not showing
		//tore down card-thumbnail-list and rebuilt it on every drawer toggle —
		//and on every editor minimize/restore, which also flips `showing` —
		//losing the list's scroll position each time. master used ?hidden here.
		return html`
			<div ?hidden=${!this.showing} class='container ${this.reorderPending ? 'reordering':''} ${this.grid ? 'grid' : ''} ${this.updating && !this.failureMessage ? 'updating' : ''} ${(this.updating || this.pending) && !currentCount && !this.failureMessage ? 'initial-load' : ''}'>
				<div class='scrolling scroller'>
					<div class='label' id='count'>
						<span>
							${this.infoCanBeExpanded ? html`<button class='small' @click=${this._handleZippyClicked}>${this.infoExpanded ? ARROW_DOWN_ICON : ARROW_RIGHT_ICON}</button>` : '' }
							${this.failureMessage
		//A failed run outranks both other states: rendering "0 cards" for a
		//collection that THREW is a lie (#739 — exactly how a one-line
		//filter bug hid for weeks), and "loading…" would promise a result
		//that is not coming. The full error is in the tooltip.
		? html`<span class='failure' title=${this.failureMessage}>This collection couldn’t be computed</span>`
		: (this.updating || this.pending) && !currentCount
		//"0 cards" plus an "updating…" pin reads as "this list is empty and
		//something is wrong", which on a slow first visit is the site's first
		//impression. An empty list that is still loading has no count worth
		//reporting yet -- say that instead. Once there ARE cards, the count is
		//real and the dim + pin correctly mean "these are stale, refreshing".
		? html`<em>loading…</em>`
		: html`<strong>${currentCount}</strong> cards`}
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
					<span class='reason' ?hidden='${!this.showCreateWorkingNotes}' title="${this.createEligible ? `Create a new working notes card (${shortcutKeys('create-working-notes-card')})` : this.createBlockedReason}"><button class='round' @click='${this._handleCreateWorkingNotes}' ?disabled='${!this.createEligible}'>${INSERT_DRIVE_FILE_ICON}</button></span>
					<span class='reason' ?hidden='${!this.showCreateCard}' title=${this.createEligible ? `Add a new card of type ${this.cardTypeToAdd} in this section (${shortcutKeys('create-card')})` : this.createBlockedReason}><button class='round' @click='${this._handleAddSlide}' ?disabled='${!this.createEligible}'>${!this.cardTypeToAdd || this.cardTypeToAdd == DEFAULT_CARD_TYPE || !cardTypeToAddConfiguration?.iconName ? PLUS_ICON : icons[cardTypeToAddConfiguration.iconName] }</button></span>
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
