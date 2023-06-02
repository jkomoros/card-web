import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	closeAIDialog,
} from '../actions/ai.js';

import {
	help,
	HelpStyles,
} from './help-badges.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

import {
	selectAIDialogOpen,
	selectAIActive,
	selectAIResult,
	selectAIAllCards,
	selectAIFilteredCards,
	selectTagInfosForCards
} from '../selectors.js';

import {
	CardID,
	State,
	TagInfos
} from '../types.js';

import './tag-list.js';

@customElement('ai-dialog')
class AIDialog extends connect(store)(DialogElement) {

	@state()
		_active: boolean;

	@state()
		_result: string;

	@state()
		_allCards : CardID[];
	
	@state()
		_filteredCards: CardID[];

	@state()
		_cardTagInfos: TagInfos;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		HelpStyles,
		css`
			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}

			textarea {
				flex-grow:1;
				width:100%;
				height:250px;
			}
		`
	];

	override innerRender() {
		if (!this.open) return html``;
		return html`
		<div class='${this._active ? 'active' : ''}'>
			<div>
				<label>Cards ${this._allCards.length == this._filteredCards.length ? '' : help('Cards that are crossed out are not included in the summary, either because they have no content or do not fit in the context window.', true)}</label><tag-list .tagInfos=${this._cardTagInfos} .previousTags=${this._allCards} .tags=${this._filteredCards}></tag-list>
			</div>
			<div>
				<label>Result</label>
				${this._active ? html`<div><em>Loading... (This may take up to a minute...)</em></div>` : html`<textarea readonly id='result' .value=${this._result}></textarea>`}
			</div>
			<div class='buttons'>
				<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
			</div>
		</div>`;
	}

	constructor() {
		super();
		this.title = 'Summarize Cards';
	}

	_handleDoneClicked() {
		this._shouldClose();
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(closeAIDialog());
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectAIDialogOpen(state);
		this._active = selectAIActive(state);
		this._result = selectAIResult(state);
		this._allCards = selectAIAllCards(state);
		this._filteredCards = selectAIFilteredCards(state);
		this._cardTagInfos = selectTagInfosForCards(state);
	}

	override updated(changedProps : Map<string, AIDialog[keyof AIDialog]>) {
		if (changedProps.has('_result') && this._result) {
			//Select the text of the textarea for easy copying when it loads.
			
			const ele = this.shadowRoot.getElementById('result') as HTMLTextAreaElement;
			ele.select();
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'ai-dialog': AIDialog;
	}
}
