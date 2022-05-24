import { LitElement, html, css } from 'lit';

import './card-renderer.js';
import './word-cloud.js';
import './card-thumbnail-list.js';
import './web-renderer.js';

import {
	PLUS_ICON,
	INSERT_DRIVE_FILE_ICON,
	ARROW_DOWN_ICON,
	ARROW_RIGHT_ICON,
} from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { SharedStyles } from './shared-styles.js';
import { ScrollingSharedStyles } from './scrolling-shared-styles.js';

import {
	CARD_TYPE_CONFIGURATION,
	DEFAULT_CARD_TYPE
} from '../card_fields.js';

import {
	VIEW_MODE_WEB
} from '../filters.js';

import * as icons from './my-icons.js';

class CardDrawer extends LitElement {
	static get styles() {
		return [
			css`
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
			`
		];
	}
	render() {
		return html`
			${SharedStyles}
			${ButtonSharedStyles}
			${ScrollingSharedStyles}
			<div ?hidden='${!this.showing}' class='container ${this.reorderPending ? 'reordering':''} ${this.grid ? 'grid' : ''}'>
				<div class='scrolling scroller'>
					<div class='label' id='count'>
						<span>${this.infoCanBeExpanded ? html`<button class='small' @click=${this._handleZippyClicked}>${this.infoExpanded ? ARROW_DOWN_ICON : ARROW_RIGHT_ICON}</button>` : '' }<strong>${this.collection ? this.collection.numCards : 0}</strong> cards</span>
						<div class='info-panel' ?hidden=${!this.infoExpanded}>
							<word-cloud .wordCloud=${this.wordCloud}></word-cloud>
							<slot name='info'></slot>
						</div>
					</div>
					${this.collection && this.collection.description.viewMode == VIEW_MODE_WEB ?
		html`<web-renderer .webInfo=${this.collection.webInfo} .highlightedCardId=${this.highlightedCardId}></web-renderer>` :
		html`<card-thumbnail-list .collection=${this.collection} .grid=${this.grid} .reorderable=${this.reorderable} .fullCards=${this.fullCards} .highlightedCardId=${this.highlightedCardId} .ghostCardsThatWillBeRemoved=${this.ghostCardsThatWillBeRemoved} .renderOffset=${this.renderOffset}></card-thumbnail-list>`
}
					
				</div>
				<div class='buttons'>
					<button class='round' @click='${this._handleCreateWorkingNotes}' ?hidden='${!this.showCreateWorkingNotes}' title="Create a new working notes card (Cmd-Shift-M)">${INSERT_DRIVE_FILE_ICON}</button>
					<button class='round' @click='${this._handleAddSlide}' ?hidden='${!this.showCreateCard}' title=${'Add a new card of type ' + this.cardTypeToAdd + ' in this section (Cmd-M)'}>${!this.cardTypeToAdd || this.cardTypeToAdd == DEFAULT_CARD_TYPE || !CARD_TYPE_CONFIGURATION[this.cardTypeToAdd].iconName ? PLUS_ICON : icons[CARD_TYPE_CONFIGURATION[this.cardTypeToAdd].iconName] }</button>
				</div>
			</div>
		`;
	}

	_handleZippyClicked() {
		this.dispatchEvent(new CustomEvent('info-zippy-clicked', {composed: true}));
	}

	_handleAddSlide() {
		if (!this.showCreateCard) return;
		this.dispatchEvent(new CustomEvent('add-card', {composed:true}));
	}

	_handleCreateWorkingNotes() {
		this.dispatchEvent(new CustomEvent('add-working-notes-card', {composed:true}));
	}

	constructor() {
		super();
		this.renderOffset = 0;
	}

	static get properties() {
		return {
			grid: {type: Boolean},
			reorderable: { type: Boolean },
			//If set, this is what type of card type will be added when add is
			//pressed. This is used entirely for display within this component;
			//the actual card adding is done by the parent component based on
			//the add-card event.
			cardTypeToAdd: { type:String },
			showCreateCard: { type:Boolean },
			//If true, will show the button to add working notes card no matter what
			showCreateWorkingNotes: { type: Boolean},
			collection: {type:Object},
			renderOffset: {type:Number},
			ghostCardsThatWillBeRemoved: {type:Boolean},
			highlightedCardId: { type:String },
			fullCards: {type:Boolean},
			reorderPending: {type:Boolean},
			//_showing is more complicated than whether we're open or yet.
			showing: {type:Boolean},
			wordCloud: {type:Object},
			infoExpanded: {type:Boolean},
			infoCanBeExpanded: {type:Boolean},
		};
	}
}

window.customElements.define('card-drawer', CardDrawer);
