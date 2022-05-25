
import { LitElement, html, css } from 'lit';
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
	selectCardIDsUserMayEdit
} from '../selectors';

import {
	ARROW_UPWARD_ICON,
	ARROW_DOWNWARD_ICON
} from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

//How many cards to cap the rendering limit at (unless overriden by the parent
//of this element). This should be set to a number of elements that can be
//rendered without bad performance on typical hardware.
const DEFAULT_RENDER_LIMIT = 250;

const OFFSET_CHUNKS = [250, 100, 50, 25, 10, 5, 1];

class CardThumbnailList  extends connect(store)(LitElement) {

	static styles = [
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
		`
	];

	render() {
		return html`
			${ButtonSharedStyles}
			${cardBadgesStyles}
			${this.renderOffset ? html`<div class='row'><button id='prev' class='small' title='Previous cards' @click=${this._handlePreviousClicked}>${ARROW_UPWARD_ICON}</button><label class='interactive' for='prev'>Previous ${this._offsetChunk} cards</label></div>` : ''}
			<div class='${this._dragging ? 'dragging' : ''} ${this.grid ? 'grid' : ''}'>
				${repeat(this._cards, (i) => i.id, (i, index) => html`
				${index >= this.collection.numStartCards ? html`<div class='spacer' .cardid=${i.id} .after=${false} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>` : ''}
				${this._labels && this._labels[index] !== undefined && this._labels[index] !== '' ? html`<div class='label'><span>${this.collection ? this.collection.sortLabelName : ''} <strong>${this._labels[index]}</strong></span></div>` : html``}
				${this._thumbnail(i, index)}
				${index == (this.collection.finalSortedCards.length - 1) ? html`<div class='spacer' .cardid=${i.id} .after=${true} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>` : ''}
				`)}
			</div>
			${this._cardsClipped ? html`<div class='row'><button id='next' class='small' title='Next cards' @click=${this._handleNextClicked}>${ARROW_DOWNWARD_ICON}</button><label class='interactive' for='next'>Next ${this._offsetChunk} cards</label></div>` : ''}
		`;
	}

	_handleNextClicked() {
		this.dispatchEvent(new CustomEvent('update-render-offset', {composed: true, detail: {value: this.renderOffset + this._offsetChunk}}));
	}

	_handlePreviousClicked() {
		this.dispatchEvent(new CustomEvent('update-render-offset', {composed: true, detail: {value: Math.max(0, this.renderOffset - this._offsetChunk)}}));
	}

	get _cards() {
		if (!this.collection) return [];
		return this.collection.finalSortedCards.slice(this.renderOffset, this.renderOffset + this.renderLimit);
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

	static get properties() {
		return {
			grid: {type: Boolean},
			collection: {type:Object},
			reorderable: { type: Boolean},
			ghostCardsThatWillBeRemoved: {type:Boolean},
			highlightedCardId: { type:String },
			fullCards: {type:Boolean},
			//renderOffset and renderLimit behave like the filters offset and
			//limit, but they operate only at the level of rendering and not the
			//underlying data model. Together they help ensure that very very
			//long lists of cards aren't rendered (which is a large source of
			//slowdowns for product card webs), while still allowing pagination.
			renderOffset: {type:Number},
			renderLimit: {type:Number},
			_memoizedGhostItems: {type:Object},
			_dragging: {type: Boolean},
			_highlightedViaClick: {type: Boolean},
			//Keeps track of if we've scrolled to the highlighted card yet;
			//sometimes the highlightedCardId won't have been loaded yet
			_highlightedScrolled: {type: Boolean},
			_badgeMap: { type: Object },
			_cardIDsUserMayEdit: { type: Object},
		};
	}

	_thumbnail(card, index) {

		const title = this._titleForCard(card);
		const hasContent = cardHasContent(card);

		const cardTypeConfig = CARD_TYPE_CONFIGURATION[card.card_type] || {};

		return html`
			<div  .card=${card} .index=${index} id=${'id-' + card.id} @dragstart='${this._handleDragStart}' @dragend='${this._handleDragEnd}' @mousemove=${this._handleThumbnailMouseMove} @click=${this._handleThumbnailClick} draggable='${this.reorderable ? 'true' : 'false'}' class="thumbnail ${card.id == this.highlightedCardId ? 'highlighted' : ''} ${cardTypeConfig.dark ? 'dark' : ''} ${card && card.published ? '' : 'unpublished'} ${this._collectionItemsToGhost[card.id] ? 'ghost' : ''} ${this.fullCards ? 'full' : 'partial'}">
					${this.fullCards ? html`<card-renderer .card=${card} .expandedReferenceBlocks=${getExpandedPrimaryReferenceBlocksForCard(this.collection.constructorArguments, card, this._cardIDsUserMayEdit)}></card-renderer>` : html`<h3 class='${hasContent ? '' : 'nocontent'}'>${icons[cardTypeConfig.iconName] || ''}${title ? title : html`<span class='empty'>[Untitled]</span>`}</h3>`}
					${cardBadges(cardTypeConfig.dark, card, this._badgeMap)}
			</div>
		`;
	}

	_titleForCard(card) {
		if (card.title) return card.title;
		//It' sonly legal to not have a title if you're full-bleed;
		if (!card.full_bleed) return '';
		if (!card.body) return '';
		let section = document.createElement('section');
		section.innerHTML = card.body;
		let ele = section.querySelector('strong');
		if (!ele) ele = section;
		return ele.innerText.split('\n')[0];
	}

	get _labels() {
		if (!this.collection) return null;
		return this.collection.finalLabels;
	}

	_handleDragEnter(e) {
		if(!this.reorderable) return;
		let ele = e.composedPath()[0];
		ele.classList.add('drag-active');
	}

	_handleDragLeave(e) {
		if(!this.reorderable) return;
		let ele = e.composedPath()[0];
		ele.classList.remove('drag-active');
	}

	_handleDragStart(e) {

		if (!this.reorderable) return;

		let thumbnail = null;
		for (let item of e.composedPath()) {
			if (item.card) {
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

	_handleDragOver(e) {
		if (!this.reorderable) return;
		//Necessary to say that this is a valid drop target
		e.preventDefault();
	}

	_handleDrop(e) {
		if (!this.reorderable) return;
		let target = e.composedPath()[0];
		target.classList.remove('drag-active');
		let thumbnail = this._dragging;
		if (thumbnail.index < this.collection.numStartCards) {
			console.log('Start card can\'t be reordered');
			return;
		}
		let otherID = target.cardid;
		let isAfter = target.after ? true : false;
		this.dispatchEvent(new CustomEvent('reorder-card', {composed: true, detail: {card: thumbnail.card, otherID: otherID, isAfter: isAfter}}));
	}

	_handleThumbnailClick(e) {
		e.stopPropagation();
		let card = null;
		for (let ele of e.composedPath()) {
			if (ele.card) {
				card = ele.card;
				break;
			}
		}
		this._highlightedViaClick = true;
		const ctrl = e.ctrlKey || e.metaKey;
		//TODO: ctrl-click on mac shouldn't show the right click menu
		this.dispatchEvent(new CustomEvent('thumbnail-tapped', {composed:true, detail: {card: card, ctrl}}));
	}

	_handleThumbnailMouseMove(e) {
		e.stopPropagation();
		let card = null;
		for (let ele of e.composedPath()) {
			if (ele.card) {
				card = ele.card;
				break;
			}
		}
		let id = card ? card.id : '';
		//card-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: id, x: e.clientX, y: e.clientY}}));
	}

	_scrollHighlightedThumbnailIntoView(force) {
		if (force) {
			//note that we should scroll eiterh this time or next time we're called.
			this._highlightedScrolled = false;
		}
		//if force is true, then will scroll, and if it can't, will take a note to try next time
		if (!this._highlightedViaClick && !this._highlightedScrolled) {
			//we prepend 'id-' to the front of the ID because ids must start
			//with a letter, and some card IDs in production start with numbers.
			const ele = this.shadowRoot.querySelector('#id-' + this.highlightedCardId);
			if (ele) {
				ele.scrollIntoView({behavior:'auto', block:'center'});
				this._highlightedScrolled = true;
			} else if (this.collection) {
				//it might be that we're loaded but our renderOffset doesn't show it, update the renderOffset to show it.
				let cardIndex = -1;
				const cards = this.collection.finalSortedCards;
				for (let [i, card] of cards.entries()) {
					if (card.id == this.highlightedCardId) {
						cardIndex = i;
						break;
					}
				}
				if (cardIndex >= 0) {
					//OK we might need to change the offset to allow it to be seen.
					let offset = 0;
					while (offset <= cards.length) {
						if (cardIndex > offset && cardIndex <= offset + this.renderLimit) {
							//Found it!
							break;
						}
						offset += this._offsetChunk;
					}
					if (offset != this.renderOffset) {
						//Ask our parent to change to this offset
						this.dispatchEvent(new CustomEvent('update-render-offset', {composed: true, detail: {value: offset}}));
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

	stateChanged(state) {
		this._badgeMap = selectBadgeMap(state);
		this._cardIDsUserMayEdit = selectCardIDsUserMayEdit(state);
	}

	updated(changedProps) {
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

window.customElements.define('card-thumbnail-list', CardThumbnailList);
