import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	selectComposeOpen,
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
} from './my-icons.js';

import {
	State
} from '../types.js';

@customElement('compose-dialog')
class ComposeDialog extends connect(store)(DialogElement) {

	@state()
		_content: string;

	@state()
		_message: string;

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

	override _shouldClose() {
		//Override base class.
		store.dispatch(composeCancel());
	}

	override stateChanged(state : State) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = selectComposeOpen(state);
		this._content = selectPromptContent(state);
		this._message = selectPromptMessage(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'compose-dialog': ComposeDialog;
	}
}
