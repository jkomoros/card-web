import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import './card-thumbnail.js';

import { plusIcon } from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { SharedStyles } from './shared-styles.js';

class CardDrawer extends LitElement {
	render() {
		return html`
			${SharedStyles}
			${ButtonSharedStyles}
			<style>
				:host {
					max-height:100%;
				}

				.container {
					height:100%;
					display:flex;
					width: 13em;
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
					height:3em;
					margin-bottom:-3em;
					margin-left: 1em;
					margin-right: 1em;
				}

				.spacer.drag-active {
					/* Get some space in the layout and render a bar */
					border-top: 1px solid var(--app-dark-text-color);
					margin-top: 1.5em;
					margin-bottom:-2em;
				}
			</style>
			<div ?hidden='${!this.showing}' class='container ${this._dragging ? 'dragging' : ''}${this.reorderPending ? 'reordering':''} ${this.grid ? 'grid' : ''}'>
				<div class='scrolling'>
				${repeat(this.collection, (i) => i.id, (i, index) => html`
					<div class='spacer' .index=${index} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>
					${this.labels && this.labels[index] ? html`<div class='label'><span>${this.labels[index]}</span></div>` : html``}
					<card-thumbnail @dragstart='${this._handleDragStart}' @dragend='${this._handleDragEnd}' .card=${i} .userMayEdit=${this.editable} .id=${i.id} .name=${i.name} .title=${this._titleForCard(i)} .cardType=${i.card_type} .selected=${i.id == this.selectedCardId} .index=${index} .starred=${this.stars[i.id] || false} .read=${this.reads[i.id] || false}></card-thumbnail>`)}
				</div>
				<button class='round' @click='${this._handleAddSlide}' ?hidden='${!this.editable}'>${plusIcon}</button>
			</div>
		`;
	}

	constructor() {
		super();

		this.collection = [];
		this.stars = {};
		this.reads = {};
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

		//For some reason elements with shadow DOM did not appear to be draggable,
		//so instead of dragging just card-thumbnail and having card-drawer manage
		//all of it, draggable is set on the inner of the thumbnail; but all other
		//logic goes in here.

		let thumbnail = null;
		for (let item of Object.values(e.path)) {
			if (item.localName == 'card-thumbnail') {
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
			collection: { type: Array },
			labels: {type: Array},
			selectedCardId: { type:String },
			stars: { type: Object },
			reads: { type: Object },
			reorderPending: {type:Boolean},
			//_showing is more complicated than whether we're open or yet.
			showing: {type:Boolean},
			_dragging: {type: Boolean},
		};
	}
}

window.customElements.define('card-drawer', CardDrawer);
