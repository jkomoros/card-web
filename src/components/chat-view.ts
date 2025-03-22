import { html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';
import './tag-list.js';

import {
	State,
	TagInfos,
} from '../types.js';

import {
	selectCurrentChatID,
	selectCurrentComposedChat,
	selectPageExtra,
	selectTagInfosForCards
} from '../selectors.js';

import {
	ChatID,
	ChatMessage,
	ComposedChat
} from '../../shared/types.js';

import {
	connectLiveChat,
	updateCurrentChat
} from '../actions/chat.js';

import chat from '../reducers/chat.js';
import { prettyTime } from '../util.js';
store.addReducers({
	chat
});

@customElement('chat-view')
class ChatView extends connect(store)(PageViewElement) {

	@state()
		_pageExtra : string;

	@state()
		_chatID: ChatID;

	@state()
		_composedChat : ComposedChat | null;

	@state()
		_cardTagInfos: TagInfos;

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

	renderMessage(message : ChatMessage) {
		//TODO: render the content as santized markdown.
		return html`<div class='message'>
			<p><strong>${message.role}</strong>: ${message.content}</p>
			<p><small>${prettyTime(message.timestamp)}</small></p>
		</div>`;
	}

	override render() {
		return html`
			<section>
				<h2>Chat</h2>
				${this._composedChat ? html`
					<h3>${this._composedChat.title}</h3>
					<p><label>${this._composedChat.model}</label></p>
					<tag-list
						.tags=${this._composedChat.cards}
						.tagInfos=${this._cardTagInfos}
					></tag-list>
					<div class='messages'>
						${this._composedChat.messages.map(message => this.renderMessage(message))}
					</div>
				` : html`<p>No chat data available.</p>`}
			</section>
		`;
	}

	override stateChanged(state: State) {
		// pageExtra will contain the chat ID from the URL
		this._pageExtra = selectPageExtra(state);
		this._chatID = selectCurrentChatID(state);
		this._composedChat = selectCurrentComposedChat(state);
		this._cardTagInfos = selectTagInfosForCards(state);
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_pageExtra')) {
			store.dispatch(updateCurrentChat(this._pageExtra));
		}
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