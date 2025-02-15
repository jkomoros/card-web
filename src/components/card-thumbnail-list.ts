
import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { cardHasContent } from '../util.js';

import {
	getExpandedPrimaryReferenceBlocksForCard
} from '../reference_blocks.js';

import {
	cardBadges,
	cardBadgesStyles
} from './card-badges.js';

import {
	CARD_TYPE_CONFIGURATION,
} from '../card_fields.js';

import * as icons from './my-icons.js';

import { cancelHoverTimeout } from '../actions/app.js';

import {
	selectBadgeMap,
	selectCardIDsUserMayEdit,
	selectCardsSelected
} from '../selectors';

import {
	ARROW_UPWARD_ICON,
	ARROW_DOWNWARD_ICON
} from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	BadgeMap,
	Card,
	CardBooleanMap,
	CardID,
	State,
	ProcessedCard
} from '../types.js';

import {
	Collection
} from '../collection_description.js';

import {
	makeCardHoveredEvent,
	makeThumbnailTappedEvent,
	makeUpdateRenderOffsetEvent,
	makeReorderCardEvent,
	makeCardSelectedEvent
} from '../events.js';

//How many cards to cap the rendering limit at (unless overriden by the parent
//of this element). This should be set to a number of elements that can be
//rendered without bad performance on typical hardware.
const DEFAULT_RENDER_LIMIT = 250;

const OFFSET_CHUNKS = [250, 100, 50, 25, 10, 5, 1];

@customElement('card-thumbnail-list')
class CardThumbnailList  extends connect(store)(LitElement) {

	@property({ type : Boolean })
		grid: boolean;

	@property({ type : Object })
		collection: Collection | null;

	@property({ type : Boolean })
		reorderable: boolean;

	@property({ type : Boolean })
		selectable: boolean;

	@property({ type : Boolean })
		ghostCardsThatWillBeRemoved: boolean;

	@property({ type : String })
		highlightedCardId: CardID;

	@property({ type : Boolean })
		fullCards: boolean;

	//renderOffset and renderLimit behave like the filters offset and
	//limit, but they operate only at the level of rendering and not the
	//underlying data model. Together they help ensure that very very
	//long lists of cards aren't rendered (which is a large source of
	//slowdowns for product card webs), while still allowing pagination.

	@property({ type : Number })
		renderOffset: number;

	@property({ type : Number })
		renderLimit: number;

	@state()
		_memoizedGhostItems: CardBooleanMap | null;

	@state()
		_dragging: HTMLElement | null;

	@state()
		_highlightedViaClick: boolean;

	//Keeps track of if we've scrolled to the highlighted card yet;
	//sometimes the highlightedCardId won't have been loaded yet
	@state()
		_highlightedScrolled: boolean;

	@state()
		_badgeMap: BadgeMap;

	@state()
		_cardIDsUserMayEdit: CardBooleanMap;

	@state()
		_cardsSelected: boolean;

	static override styles = [
		ButtonSharedStyles,
		cardBadgesStyles,
		css`
			:host {
				width: 100%;
			}

			.grid {
				width:100%;
				display:flex;
				flex-direction:row;
				flex-wrap: wrap;
			}

			.dragging .spacer {
				/* When dragging, move these on top to give htem a bigger drop target (even if it isn't that visible) */
				position:relative;
				z-index:10000;
			}

			.row {
				display: flex;
				flex-direction: row;
				justify-content: center;
				align-items: center;
			}

			.grid .spacer {
				display:none;
			}

			.grid .label {
				display: none;
			}

			.label {
				color: var(--app-dark-text-color);
				font-weight:normal;
				margin:0.5em;
			}

			label.interactive {
				cursor: pointer;
				margin-top: 0;
				color: var(--app-dark-text-color);
			}

			label.interactive:hover {
				color: var(--app-dark-text-color-light);
			}

			.label span {
				/* can't be on .label itself because then it affects margin */
				font-size:0.7em;
			}

			.spacer {
				/* Big drop target, but no change in layout */
				height:4em;
				margin-bottom:-4em;
				margin-left: 1em;
				margin-right: 1em;
			}

			.spacer.drag-active {
				/* Get some space in the layout and render a bar */
				/* TODO: render a bar in the middle of the opened space */
				margin-top: -1.5em;
				height: 8em;
				margin-bottom:-5em;
			}

			.thumbnail h3 {
				color: var(--app-dark-text-color);
				fill: var(--app-dark-text-color);
				text-align:center;
				font-size: 0.8em;
				font-family: var(--app-header-font-family);
			}

			.thumbnail h3.nocontent {
				font-style: italic;
			}

			.thumbnail {
				cursor:pointer;
				margin:0.5em;
				box-sizing:border-box;
				position:relative;
				border: 2px solid transparent;
			}

			.thumbnail.partial {
				height: 6em;
				width: 12em;
				padding: 0.5em;
				display:flex;
				align-items:center;
				justify-content:center;
				background-color: var(--card-color);
				box-shadow: var(--card-shadow);
				overflow:hidden;
			}

			.thumbnail card-renderer {
				font-size: 0.5em;
			}

			.thumbnail svg {
				height: 1.0em;
				width: 1.0em;
				margin-right: 0.25em;
			}

			.thumbnail.unpublished {
				background-color: var(--unpublished-card-color);
			}

			.thumbnail.highlighted {
				border:2px solid var(--app-primary-color);
			}

			.thumbnail.highlighted h3 {
				color: var(--app-primary-color);
				fill: var(--app-primary-color);
			}

			.thumbnail.dark.partial {
				background-color: var(--app-primary-color);
			}

			.thumbnail.dark.partial.highlighted {
				border: 2px solid var(--app-light-text-color);
			}

			.thumbnail.dark h3 {
				color: var(--app-light-text-color);
				fill: var(--app-light-text-color);
			}

			.thumbnail.dark.highlighted h3 {
				color: var(--app-primary-color-light);
				fill: var(--app-primary-color-light);
			}

			.thumbnail.empty {
				opacity:0.5;
			}

			.thumbnail.ghost {
				opacity:0.5;
			}

			div.thumbnail:hover h3 {
				color: var(--app-secondary-color);
				fill: var(--app-secondary-color);
			}

			.thumbnail:hover {
				border:2px solid var(--app-secondary-color);
			}

			.thumbnail.dark:hover h3 {
				color: var(--app-primary-color-subtle);
				fill: var(--app-primary-color-subtle);
			}

			.thumbnail.dark:hover {
				border:2px solid var(--app-primary-color-subtle);
			}

			.thumbnail input {
				opacity: 0;
			}

			.thumbnail:hover input {
				opacity: 1;
			}

			.cards-selected .thumbnail input {
				opacity: 1;
			}
		`
	];

	override render() {
		const collection = this.collection;
		if (!collection) return html``;
		return html`
			${this.renderOffset ? html`<div class='row'><button id='prev' class='small' title='Previous cards' @click=${this._handlePreviousClicked}>${ARROW_UPWARD_ICON}</button><label class='interactive' for='prev'>Previous ${this._offsetChunk} cards</label></div>` : ''}
			<div class='${this._dragging ? 'dragging' : ''} ${this.grid ? 'grid' : ''} ${this._cardsSelected ? 'cards-selected' : ''}'>
				${repeat(this._cards, (i) => i.id, (i, index) => html`
				${index >= collection.numStartCards ? html`<div class='spacer' data-cardid=${i.id} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>` : ''}
				${this._labels && this._labels[index] !== undefined && this._labels[index] !== '' ? html`<div class='label'><span>${this.collection ? this.collection.sortLabelName : ''} <strong>${this._labels[index]}</strong></span></div>` : html``}
				${this._thumbnail(i, index)}
				${index == (collection.finalSortedCards.length - 1) ? html`<div class='spacer' data-cardid=${i.id} data-after=${true} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>` : ''}
				`)}
			</div>
			${this._cardsClipped ? html`<div class='row'><button id='next' class='small' title='Next cards' @click=${this._handleNextClicked}>${ARROW_DOWNWARD_ICON}</button><label class='interactive' for='next'>Next ${this._offsetChunk} cards</label></div>` : ''}
		`;
	}

	_handleNextClicked() {
		this.dispatchEvent(makeUpdateRenderOffsetEvent(this.renderOffset + this._offsetChunk));
	}

	_handlePreviousClicked() {
		this.dispatchEvent(makeUpdateRenderOffsetEvent(Math.max(0, this.renderOffset - this._offsetChunk)));
	}

	_handleSelectedClicked(e : MouseEvent) {

		e.stopPropagation();

		const target = e.composedPath()[0];

		if (!(target instanceof HTMLInputElement)) {
			throw new Error('not an input element');
		}

		const card = target.dataset.cardId;
		const selected = target.checked;

		if (!card) throw new Error('no card');

		this.dispatchEvent(makeCardSelectedEvent(card, selected));
	}

	get _cards() {
		if (!this.collection) return [];
		return this.collection.finalSortedCards.slice(this.renderOffset, this.renderOffset + this.renderLimit);
	}

	get _labels() {
		if (!this.collection) return null;
		const result = this.collection.finalLabels.slice(this.renderOffset, this.renderOffset + this.renderLimit);
		//finalLabels has duplicates removed, but it's possible the first one is empty since the offset could happen in the middle of a run.
		//If that's the case, scan backward to find the last non-empty label and copy it in.
		if (result.length > 0 && result[0] == '') {
			for (let i = this.renderOffset - 1; i >= 0; i--) {
				if (this.collection.finalLabels[i] != '') {
					result[0] = this.collection.finalLabels[i];
					break;
				}
			}
		}
		return result;
	}

	get _cardsClipped() {
		//Returns true if there are cards at the end that are clipped.
		if (!this.collection) return false;
		const offsetCards = this.collection.finalSortedCards.slice(this.renderOffset);
		return offsetCards.length > this.renderLimit;
	}

	get _offsetChunk() {
		//How many cards to show afforadances to move up or down.
		//See which of the built in chunks cleanly divides the renderLimit.
		for (const num of OFFSET_CHUNKS) {
			if (this.renderLimit % num == 0) return num;
		}
		return this.renderLimit;
	}

	constructor() {
		super();
		this.renderOffset = 0;
		this.renderLimit = DEFAULT_RENDER_LIMIT;
	}

	_thumbnail(card : ProcessedCard, index : number) : TemplateResult {

		const collection = this.collection;
		if (!collection) throw new Error('no collection');

		const title = this._titleForCard(card);
		const hasContent = cardHasContent(card);

		const cardTypeConfig = CARD_TYPE_CONFIGURATION[card.card_type];

		if (!cardTypeConfig) throw new Error('No such cardType');

		const icon = cardTypeConfig.iconName ? icons[cardTypeConfig.iconName] : '';

		return html`
			<div  data-card=${card.id} data-index=${index} id=${'id-' + card.id} @dragstart='${this._handleDragStart}' @dragend='${this._handleDragEnd}' @mousemove=${this._handleThumbnailMouseMove} @click=${this._handleThumbnailClick} draggable='${this.reorderable ? 'true' : 'false'}' class="thumbnail ${card.id == this.highlightedCardId ? 'highlighted' : ''} ${cardTypeConfig.dark ? 'dark' : ''} ${card && card.published ? '' : 'unpublished'} ${this._collectionItemsToGhost[card.id] ? 'ghost' : ''} ${this.fullCards ? 'full' : 'partial'}">
					${this.fullCards ? html`<card-renderer .card=${card} .expandedReferenceBlocks=${getExpandedPrimaryReferenceBlocksForCard(collection.constructorArguments, card, this._cardIDsUserMayEdit)}></card-renderer>` : html`<h3 class='${hasContent ? '' : 'nocontent'}'>${icon}${title ? title : html`<span class='empty'>[Untitled]</span>`}</h3>`}
					${cardBadges(cardTypeConfig.dark || false, card, this._badgeMap, this.selectable ? this._handleSelectedClicked : undefined)}
			</div>
		`;
	}

	_titleForCard(card : Card) : string {
		if (card.title) return card.title;
		//It' sonly legal to not have a title if you're full-bleed;
		if (!card.full_bleed) return '';
		if (!card.body) return '';
		const section = document.createElement('section');
		section.innerHTML = card.body;
		let ele = section.querySelector('strong');
		if (!ele) ele = section;
		return ele.innerText.split('\n')[0];
	}

	_handleDragEnter(e : DragEvent) {
		if(!this.reorderable) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) throw new Error('not an element');
		ele.classList.add('drag-active');
	}

	_handleDragLeave(e : DragEvent) {
		if(!this.reorderable) return;
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLElement)) throw new Error('not an element');
		ele.classList.remove('drag-active');
	}

	_handleDragStart(e : DragEvent) {

		if (!this.reorderable) return;

		let thumbnail : HTMLElement | null = null;
		for (const item of e.composedPath()) {
			//e.g. documentFragment
			if (!(item instanceof HTMLElement)) continue;
			if (item.dataset.card) {
				thumbnail = item;
			}
		}

		//If this was set immediately, then thigns would be rerendered with the
		//spacer beneath the card being on top of the card. If the mouse cursor
		//was over top of the spacer to start, this would lead to an immediate
		//dragend, basically forbiding starting a drag from the top half of a
		//card (that overlaps with the spacer). This might be a bug in Chrome?
		//In any case, wait a tick before updating the property that will lead
		//to the spacers popping to the front. See #335 for more.
		setTimeout(() => this._dragging = thumbnail, 0);

		//when dragging is happening, hovers and other events won't be
		//happening... but if a card hover was pending, make sure it's cleared
		//out.
		cancelHoverTimeout();
	}

	_handleDragEnd() {
		if (!this.reorderable) return;
		this._dragging = null;
	}

	_handleDragOver(e : DragEvent) {
		if (!this.reorderable) return;
		//Necessary to say that this is a valid drop target
		e.preventDefault();
	}

	_handleDrop(e : DragEvent) {
		if (!this.reorderable) return;
		const target = e.composedPath()[0];
		if (!(target instanceof HTMLElement)) throw new Error('not HTML element');
		target.classList.remove('drag-active');
		const thumbnail = this._dragging;
		if (!thumbnail) return;
		const index = parseInt(thumbnail.dataset.index || '0');
		const collection = this.collection;
		if (!collection) throw new Error('no collection');
		if (index < collection.numStartCards) {
			console.log('Start card can\'t be reordered');
			return;
		}
		const cardID = thumbnail.dataset.card || '';
		const otherID = target.dataset.cardid || '';
		const isAfter = target.dataset.after ? true : false;
		this.dispatchEvent(makeReorderCardEvent(cardID,otherID, isAfter));
	}

	_handleThumbnailClick(e : MouseEvent) {
		e.stopPropagation();
		let cardID = '';
		for (const ele of e.composedPath()) {
			//e.g. documentFragment
			if ((!(ele instanceof HTMLElement))) continue;
			if (ele.dataset.card) {
				cardID = ele.dataset.card;
				break;
			}
		}
		this._highlightedViaClick = true;
		const ctrl = e.ctrlKey || e.metaKey;
		//TODO: ctrl-click on mac shouldn't show the right click menu
		this.dispatchEvent(makeThumbnailTappedEvent(cardID, ctrl));
	}

	_handleThumbnailMouseMove(e : MouseEvent) {
		e.stopPropagation();
		let cardID = '';
		for (const ele of e.composedPath()) {
			//e.g. documentFragment
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.dataset.card) {
				cardID = ele.dataset.card;
				break;
			}
		}
		//card-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(makeCardHoveredEvent(cardID, e.clientX, e.clientY));
	}

	_scrollHighlightedThumbnailIntoView(force  = false) {
		if (force) {
			//note that we should scroll eiterh this time or next time we're called.
			this._highlightedScrolled = false;
		}
		//if force is true, then will scroll, and if it can't, will take a note to try next time
		if (!this._highlightedViaClick && !this._highlightedScrolled) {
			//we prepend 'id-' to the front of the ID because ids must start
			//with a letter, and some card IDs in production start with numbers.
			const shadowRoot = this.shadowRoot;
			if (!shadowRoot) throw new Error('no shadowRoot');
			const ele = shadowRoot.querySelector('#id-' + this.highlightedCardId);
			if (ele) {
				ele.scrollIntoView({behavior:'auto', block:'center'});
				this._highlightedScrolled = true;
			} else if (this.collection) {
				//it might be that we're loaded but our renderOffset doesn't show it, update the renderOffset to show it.
				let cardIndex = -1;
				const cards = this.collection.finalSortedCards;
				for (const [i, card] of cards.entries()) {
					if (card.id == this.highlightedCardId) {
						cardIndex = i;
						break;
					}
				}
				if (cardIndex >= 0) {
					//OK we might need to change the offset to allow it to be seen.
					let offset = 0;
					while (offset <= cards.length) {
						if (cardIndex >= offset && cardIndex < offset + this.renderLimit) {
							//Found it!
							break;
						}
						offset += this._offsetChunk;
					}
					if (offset != this.renderOffset) {
						//Ask our parent to change to this offset
						this.dispatchEvent(makeUpdateRenderOffsetEvent(offset));
					}
				}
			}
		}
		this._highlightedViaClick = false;
	}

	get _collectionItemsToGhost() {
		if (!this.collection) return {};
		if (!this._memoizedGhostItems) {
			const itemsThatWillBeRemovedOnPendingFilterCommit = this.ghostCardsThatWillBeRemoved ? this.collection.cardsThatWillBeRemoved() : {};
			this._memoizedGhostItems = {...this.collection.partialMatches, ...itemsThatWillBeRemovedOnPendingFilterCommit};
		}
		return this._memoizedGhostItems;
	}

	override stateChanged(state : State) {
		this._badgeMap = selectBadgeMap(state);
		this._cardIDsUserMayEdit = selectCardIDsUserMayEdit(state);
		this._cardsSelected = selectCardsSelected(state);
	}

	override updated(changedProps : Map<string, CardThumbnailList[keyof CardThumbnailList]>) {
		if(changedProps.has('highlightedCardId') && this.highlightedCardId) {
			this._scrollHighlightedThumbnailIntoView(true);
		}
		//collection might change for example on first load when unpublished
		//cards are loaded,but we're OK with it not happening if the scroll already happened.
		//Also do it if renderOFfset or renderLimit has changed, (we might have asked our parent to change it)
		if (changedProps.has('collection') || changedProps.has('renderOffset') || changedProps.has('renderLimit')) {
			this._scrollHighlightedThumbnailIntoView(false);
		}
		if (changedProps.has('collection') || changedProps.has('ghostCardsThatWillBeRemoved')) {
			this._memoizedGhostItems = null;
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'card-thumbnail-list': CardThumbnailList;
	}
}
