import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

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
	CardID,
	CardType
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

	@property({ type : Object })
		collection: Collection | null;

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

	override render() {

		const cardTypeToAddConfiguration = CARD_TYPE_CONFIGURATION[this.cardTypeToAdd];

		return html`
			<div ?hidden='${!this.showing}' class='container ${this.reorderPending ? 'reordering':''} ${this.grid ? 'grid' : ''}'>
				<div class='scrolling scroller'>
					<div class='label' id='count'>
						<span>${this.infoCanBeExpanded ? html`<button class='small' @click=${this._handleZippyClicked}>${this.infoExpanded ? ARROW_DOWN_ICON : ARROW_RIGHT_ICON}</button>` : '' }<strong>${this.collection ? this.collection.numCards : 0}</strong> cards</span>
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
					<button class='round' @click='${this._handleCreateWorkingNotes}' ?hidden='${!this.showCreateWorkingNotes}' title="Create a new working notes card (Cmd-Shift-M)">${INSERT_DRIVE_FILE_ICON}</button>
					<button class='round' @click='${this._handleAddSlide}' ?hidden='${!this.showCreateCard}' title=${'Add a new card of type ' + this.cardTypeToAdd + ' in this section (Cmd-M)'}>${!this.cardTypeToAdd || this.cardTypeToAdd == DEFAULT_CARD_TYPE || !cardTypeToAddConfiguration?.iconName ? PLUS_ICON : icons[cardTypeToAddConfiguration.iconName] }</button>
				</div>
			</div>
		`;
	}

	_handleZippyClicked() {
		this.dispatchEvent(makeInfoZippyClickedEvent());
	}

	_handleAddSlide() {
		if (!this.showCreateCard) return;
		this.dispatchEvent(makeAddCardEvent());
	}

	_handleCreateWorkingNotes() {
		this.dispatchEvent(makeAddWorkingNotesCardEvent());
	}

	constructor() {
		super();
		this.renderOffset = 0;
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'card-drawer': CardDrawer;
	}
}
