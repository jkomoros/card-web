import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	AI_DIALOG_TYPE_CONFIGURATION,
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
	selectTagInfosForCards,
	selectAIError,
	selectAIDialogKind
} from '../selectors.js';

import {
	AIDialogType,
	AIDialogTypeConfiguration,
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
		_result: string[];

	@state()
		_error: string;

	@state()
		_allCards : CardID[];
	
	@state()
		_filteredCards: CardID[];

	@state()
		_cardTagInfos: TagInfos;

	@state()
		_kind : AIDialogType;

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

			.error {
				color: var(--app-warning-color);
			}

			.error svg {
				/* get equal specificifity to override help badges color */
				fill: var(--app-warning-color);
			}

			label.large {
				font-size: 1.0em;
				color: var(--app-dark-text-color);
			}
		`
	];

	_renderLoading() {
		return html`<div><em>Loading... (This may take up to a minute...)</em></div>`;
	}

	_renderError() {
		return html`<div class='error'>${help('An error occurred', true)} <strong>Error</strong> <em>${this._error}</em></div>`;
	}

	_renderResult() {
		let result = this._result;
		if (!result || result.length == 0) result = [''];
		if (this._kindConfig.multiResult) {
			return result.map((item, index) => html`<div><input type='radio' name='result' .value=${index} id=${'result-' + index}></input><label class='large' for=${'result-' + index}>${item}</label></div>`);
		}
		return html`<textarea readonly id='result' .value=${result[0]}></textarea>`;
	}

	override innerRender() {
		if (!this.open) return html``;
		return html`
		<div class='${this._active ? 'active' : ''}'>
			<div>
				<label>Cards ${this._allCards.length == this._filteredCards.length ? '' : help('Cards that are crossed out are not included in the summary, either because they have no content or do not fit in the context window.', true)}</label><tag-list .tagInfos=${this._cardTagInfos} .previousTags=${this._allCards} .tags=${this._filteredCards}></tag-list>
			</div>
			<div>
				<label>Result</label>
				${this._active ? this._renderLoading() : (this._error ? this._renderError() : this._renderResult())}
			</div>
			<div class='buttons'>
				<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
			</div>
		</div>`;
	}

	_handleDoneClicked() {
		this._shouldClose();
	}

	get _kindConfig() : AIDialogTypeConfiguration {
		return AI_DIALOG_TYPE_CONFIGURATION[this._kind];
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
		this._error = selectAIError(state);
		this._allCards = selectAIAllCards(state);
		this._filteredCards = selectAIFilteredCards(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._kind = selectAIDialogKind(state);

		this.title = this._kindConfig.title;
	}

	override updated(changedProps : Map<string, AIDialog[keyof AIDialog]>) {
		if (changedProps.has('_result') && this._result) {
			//Select the text of the textarea for easy copying when it loads.
			
			const ele = this.shadowRoot.getElementById('result') as HTMLTextAreaElement;
			if (ele) ele.select();
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'ai-dialog': AIDialog;
	}
}
