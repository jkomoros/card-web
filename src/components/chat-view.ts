import { html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	State,
} from '../types.js';

import {
	selectPageExtra
} from '../selectors.js';

import {
	ChatID
} from '../../shared/types.js';

import {
	connectLiveChat
} from '../actions/chat.js';

import chat from '../reducers/chat.js';
store.addReducers({
	chat
});

@customElement('chat-view')
class ChatView extends connect(store)(PageViewElement) {

	@state()
		_chatID: ChatID;

	static override styles = [
		ButtonSharedStyles,
		SharedStyles,
		css`
			:host {
				height: 100%;
				overflow: scroll;
			}

			section {
				margin: 1em;
			}
		`
	];

	override render() {
		return html`
			<section>
				<h2>Chat</h2>
				<p>This page is for viewing chat ID: ${this._chatID}</p>
			</section>
		`;
	}

	override stateChanged(state: State) {
		// pageExtra will contain the chat ID from the URL
		this._chatID = selectPageExtra(state);
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_chatID')) {
			//Start fetching the data necessary to render this chat.
			connectLiveChat(this._chatID);
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'chat-view': ChatView;
	}
}