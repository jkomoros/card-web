import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	cardBadges,
	cardBadgesStyles
} from './card-badges.js';

import './card-renderer.js';

import { PLUS_ICON } from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { SharedStyles } from './shared-styles.js';
import { selectBadgeMap } from '../selectors';
import { cardHasContent } from '../util.js';
import { CARD_TYPE_CONTENT } from '../card_fields.js';

class CardDrawer extends connect(store)(LitElement) {
	render() {
		return html`
			${SharedStyles}
			${ButtonSharedStyles}
			${cardBadgesStyles}
			<style>
				:host {
					max-height:100%;
				}

				.container {
					height:100%;
					display:flex;
					flex-direction:column;
				}

				.container.grid {
					width:100%;
				}

				.scrolling {
					overflow:scroll;
					max-height:100%;
					flex-grow:1;
				}

				.grid .scrolling {
					width:100%;
					display:flex;
					flex-direction:row;
					flex-wrap: wrap;
				}

				button {
					position: absolute;
					left: 1em;
					bottom: 1em;
				}

				.dragging .spacer {
					/* When dragging, move these on top to give htem a bigger drop target (even if it isn't that visible) */
					position:relative;
					z-index:10000;
				}

				.reordering {
					opacity:0.7;
				}

				.grid .spacer {
					display:none;
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

				.thumbnail.unpublished {
					background-color: var(--unpublished-card-color);
				}

				.thumbnail.selected {
					border:2px solid var(--app-primary-color);
				}

				.thumbnail.selected h3 {
					color: var(--app-primary-color);
				}

				.thumbnail.section-head.partial {
					background-color: var(--app-primary-color);
				}

				.thumbnail.section-head.partial.selected {
					border: 2px solid var(--app-light-text-color);
				}

				.thumbnail.section-head h3 {
					color: var(--app-light-text-color);
				}

				.thumbnail.section-head.selected h3 {
					color: var(--app-primary-color-light);
				}

				.thumbnail.empty {
					opacity:0.5;
				}

				.thumbnail.ghost {
					opacity:0.5;
				}

				div.thumbnail:hover h3 {
					color: var(--app-secondary-color);
				}

				.thumbnail:hover {
					border:2px solid var(--app-secondary-color);
				}

				.thumbnail.section-head:hover h3 {
					color: var(--app-primary-color-subtle);
				}

				.thumbnail.section-head:hover {
					border:2px solid var(--app-primary-color-subtle);
				}

			</style>
			<div ?hidden='${!this.showing}' class='container ${this._dragging ? 'dragging' : ''}${this.reorderPending ? 'reordering':''} ${this.grid ? 'grid' : ''}'>
				<div class='scrolling'>
				${repeat(this.collection, (i) => i.id, (i, index) => html`
					<div class='spacer' .index=${index} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>
					${this.labels && this.labels[index] ? html`<div class='label'><span>${this.labelName} <strong>${this.labels[index]}</strong></span></div>` : html``}
					${this._thumbnail(i, index)}`)}
				</div>
				<button class='round' @click='${this._handleAddSlide}' ?hidden='${!this.editable || this.suppressAdd}'>${PLUS_ICON}</button>
			</div>
		`;
	}

	constructor() {
		super();

		this.collection = [];
		this.collectionItemsToGhost = {};
	}

	_thumbnail(card, index) {

		const title = this._titleForCard(card);
		const hasContent = cardHasContent(card);

		return html`
			<div  .card=${card} .index=${index} id=${'id-' + card.id} @dragstart='${this._handleDragStart}' @dragend='${this._handleDragEnd}' @mousemove=${this._handleThumbnailMouseMove} @click=${this._handleThumbnailClick} draggable='${this.editable ? 'true' : 'false'}' class="thumbnail ${card.id == this.selectedCardId ? 'selected' : ''} ${card.card_type} ${card && card.published ? '' : 'unpublished'} ${this.collectionItemsToGhost[card.id] ? 'ghost' : ''} ${this.fullCards ? 'full' : 'partial'}">
					${this.fullCards ? html`<card-renderer .card=${card}></card-renderer>` : html`<h3 class=${hasContent ? '' : 'nocontent'}>${title ? title : html`<span class='empty'>[Untitled]</span>`}</h3>`}
					${cardBadges(card.card_type != CARD_TYPE_CONTENT, card, this._badgeMap)}
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

	_scrollSelectedThumbnailIntoView(force) {
		if (force) {
			//note that we should scroll eiterh this time or next time we're called.
			this._selectedScrolled = false;
		}
		//if force is true, then will scroll, and if it can't, will take a note to try next time
		if (!this._selectedViaClick && !this._selectedScrolled) {
			//we prepend 'id-' to the front of the ID because ids must start
			//with a letter, and some card IDs in production start with numbers.
			const ele = this.shadowRoot.querySelector('#id-' + this.selectedCardId);
			if (ele) {
				ele.scrollIntoView({behavior:'auto', block:'center'});
				this._selectedScrolled = true;
			}
		}
		this._selectedViaClick = false;
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
		this._selectedViaClick = true;
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

	_handleAddSlide() {
		if (!this.editable) return;
		this.dispatchEvent(new CustomEvent('add-card', {composed:true}));
	}

	_handleDragEnter(e) {
		if(!this.editable) return;
		let ele = e.composedPath()[0];
		ele.classList.add('drag-active');
	}

	_handleDragLeave(e) {
		if(!this.editable) return;
		let ele = e.composedPath()[0];
		ele.classList.remove('drag-active');
	}

	_handleDragStart(e) {

		if (!this.editable) return;

		let thumbnail = null;
		for (let item of e.composedPath()) {
			if (item.card) {
				thumbnail = item;
			}
		}

		this._dragging = thumbnail;
	}

	_handleDragEnd() {
		if (!this.editable) return;
		this._dragging = null;
	}

	_handleDragOver(e) {
		if (!this.editable) return;
		//Necessary to say that this is a valid drop target
		e.preventDefault();
	}

	_handleDrop(e) {
		if (!this.editable) return;
		let target = e.composedPath()[0];
		target.classList.remove('drag-active');
		let thumbnail = this._dragging;
		let index = target.index;
		//reorderCard expects the index to insert to be after popping the item out
		//first--which means that if you drag it down to below where it was
		//before, it's off by one.
		if (thumbnail.index <= target.index) index--;
		this.dispatchEvent(new CustomEvent('reorder-card', {composed: true, detail: {card: thumbnail.card, index: index}}));
	}

	static get properties() {
		return {
			//editable doesn't mean it IS editable; just that if the userMayEdit this
			//instantiaion of hte drawer should allow edits.
			grid: {type: Boolean},
			editable: { type: Boolean},
			//If true, then even if editing is true, the add card button won't show
			suppressAdd: { type: Boolean },
			collection: { type: Array },
			labels: {type: Array},
			labelName: {type:String},
			selectedCardId: { type:String },
			collectionItemsToGhost: { type: Object },
			fullCards: {type:Boolean},
			reorderPending: {type:Boolean},
			//_showing is more complicated than whether we're open or yet.
			showing: {type:Boolean},
			_dragging: {type: Boolean},
			_selectedViaClick: {type: Boolean},
			//Keeps track of if we've scrolled to the selected card yet;
			//sometimes the selectedCardId won't have been loaded yet
			_selectedScrolled: {type: Boolean},
			_badgeMap: { type: Object },
		};
	}

	stateChanged(state) {
		this._badgeMap = selectBadgeMap(state);
	}

	updated(changedProps) {
		if(changedProps.has('selectedCardId') && this.selectedCardId) {
			this._scrollSelectedThumbnailIntoView(true);
		}
		//collection might change for example on first load when unpublished
		//cards are loaded,but we're OK with it not happening if the scroll already happened.
		if (changedProps.has('collection')) {
			this._scrollSelectedThumbnailIntoView(false);
		}
	}
}

window.customElements.define('card-drawer', CardDrawer);
