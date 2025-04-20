import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectAIModel,
	selectComposeOpen,
	selectPromptAction,
	selectPromptContent,
	selectPromptMessage,
} from '../selectors.js';

import {
	composeCancel,
	composeUpdateContent,
	composeCommit,
} from '../actions/prompt.js';

import {
	CHECK_CIRCLE_OUTLINE_ICON
} from '../../shared/icons.js';

import {
	MODEL_INFO
} from '../../shared/ai.js';

import {
	AIModelName,
	CommitActionType,
	State
} from '../types.js';

import {
	updateAIModel
} from '../actions/ai.js';

@customElement('compose-dialog')
class ComposeDialog extends connect(store)(DialogElement) {

	@state()
		_content: string;

	@state()
		_message: string;

	@state()
		_action: CommitActionType;

	@state()
		_model: AIModelName;

	static override styles = [
		...DialogElement.styles,
		css`
			textarea {
				flex-grow:1;
				width:100%;
			}
			.buttons {
				display:flex;
				flex-direction: row;
				justify-content:flex-end;
			}
			h3 {
				font-weight:normal;
			}
		`
	];

	override innerRender() {
		return html`
			<h3>${this._message}</h3>
			<textarea .value=${this._content} @input=${this._handleContentUpdated}></textarea>
			<div class='buttons'>
				${this._action === 'CREATE_CHAT' ? html`
					<label for='model'>Model</label>
					<select id='model' @change=${this._handleModelChanged} .value=${this._model}>
						${Object.keys(MODEL_INFO).map((model) => html`<option value=${model} ?selected=${this._model === model}>${model}</option>`)}
					</select>
						` : html``}
				<button class='round' @click='${this._handleDoneClicked}'>${CHECK_CIRCLE_OUTLINE_ICON}</button>
			</div>
		`;
	}

	constructor() {
		super();
		this.title = 'Compose';
	}

	_handleContentUpdated(e : InputEvent) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLTextAreaElement)) throw new Error('not textarea element');
		store.dispatch(composeUpdateContent(ele.value));
	}

	_handleDoneClicked() {
		store.dispatch(composeCommit());
	}

	_handleModelChanged(e : InputEvent) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const model = ele.value as AIModelName;
		if (!MODEL_INFO[model]) throw new Error('unknown model: ' + model);
		store.dispatch(updateAIModel(model));
	}

	override _shouldClose() {
		//Override base class.
		store.dispatch(composeCancel());
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectComposeOpen(state);
		this._content = selectPromptContent(state);
		this._message = selectPromptMessage(state);
		this._action = selectPromptAction(state);
		this._model = selectAIModel(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'compose-dialog': ComposeDialog;
	}
}
