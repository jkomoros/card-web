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
	selectChatComposingMessage,
	selectChatSending,
	selectCurrentChatID,
	selectCurrentComposedChat,
	selectPageExtra,
	selectTagInfosForCards,
	selectUserMayChatInCurrentChat
} from '../selectors.js';

import {
	ChatID,
	ChatMessage,
	ComposedChat
} from '../../shared/types.js';

import {
	connectLiveChat,
	postMessageInCurrentChat,
	updateComposingMessage,
	updateCurrentChat
} from '../actions/chat.js';

import {
	SEND_ICON
} from '../../shared/icons.js';

import {
	markdownElement
} from '../util.js';

import chat from '../reducers/chat.js';
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

	@state()
		_userMayChatInCurrentChat : boolean;

	@state()
		_composingMessage : string;

	@state()
		_sending : boolean;

	static override styles = [
		ButtonSharedStyles,
		SharedStyles,
		css`
			:host {
				height: 100%;
				overflow: auto;
			}

			section {
				margin: 1em;
				max-width: 800px;
				margin: 0 auto;
				padding: 1em;
			}

			.messages {
				display: flex;
				flex-direction: column;
				gap: 1rem;
				margin-bottom: 1.5rem;
			}

			.message {
				padding: 1rem;
				border-radius: 0.5rem;
				max-width: 80%;
			}

			.message strong.interface {
				font-size: 0.8rem;
				text-transform: uppercase;
				letter-spacing: 0.05em;
				margin-bottom: 0.5rem;
				display: block;
				color: var(--app-dark-text-color);
			}

			.message[data-role="user"] {
				align-self: flex-end;
				background-color: var(--app-primary-color);
				color: white;
			}

			.message[data-role="user"] strong {
				color: rgba(255, 255, 255, 0.8);
			}

			.message[data-role="assistant"] {
				align-self: flex-start;
				background-color: var(--app-section-even-color, #f7f7f7);
				border: 1px solid var(--app-divider-color, #e0e0e0);
			}

			.compose {
				display: flex;
				flex-direction: row;
				align-items: flex-end;
				gap: 0.5rem;
				position: sticky;
				bottom: 0;
				background-color: var(--app-background-color, white);
				padding: 1rem 0;
				border-top: 1px solid var(--app-divider-color, #e0e0e0);
			}

			.compose textarea {
				flex-grow: 1;
				height: 5em;
				padding: 0.75rem;
				border-radius: 0.5rem;
				border: 1px solid var(--app-divider-color, #e0e0e0);
				resize: vertical;
				font-family: inherit;
			}

			.compose textarea:focus {
				outline: none;
				border-color: var(--app-primary-color);
				box-shadow: 0 0 0 2px rgba(var(--app-primary-rgb, 0, 120, 212), 0.2);
			}

			.loading {
				animation: fade 1.5s infinite alternate;
			}

			@keyframes fade {
				0% { opacity: 1.0; }
				100% { opacity: 0.5; }
			}

			.message h1, .message h2, .message h3, .message h4, .message h5, .message h6 {
				text-align: left;
				margin: 0 0 0.5rem 0;
				font-size: 1em;
				font-weight: 600;
			}

			.message p {
				margin: 0 0 0.5rem 0;
			}

			.message p:last-child {
				margin-bottom: 0;
			}

			.message ul, .message ol {
				margin: 0 0 0.5rem 0;
				padding-left: 1.5rem;
			}

			.message ul:last-child, .message ol:last-child {
				margin-bottom: 0;
			}

			.metadata {
				display: flex;
				flex-direction: column;
				gap: 0.5rem;
				margin-bottom: 1.5rem;
				padding-bottom: 1rem;
				border-bottom: 1px solid var(--app-divider-color, #e0e0e0);
			}

			.metadata h3 {
				margin: 0;
			}

			.metadata label {
				display: inline-block;
				background-color: var(--app-light-accent-color, #e6f2ff);
				padding: 0.25rem 0.5rem;
				border-radius: 0.25rem;
				font-size: 0.8rem;
			}

			details {
				margin-top: 0.5rem;
			}

			summary {
				cursor: pointer;
				font-size: 0.9rem;
				color: var(--app-secondary-color);
			}
		`
	];

	renderMessage(message : ChatMessage) {
		return html`<div class='message' data-role='${message.role}'>
			<strong class='interface'>${message.role}</strong>
			<div class='content'>
				${message.streaming ? 
		html`<em class='loading'>Thinking...</em>` : 
		markdownElement(message.content)}
			</div>
		</div>`;
	}

	override render() {
		return html`
			<section>
				${this._composedChat ? html`
					<div class="metadata">
						<h2>${this._composedChat.title}</h2>
						<div>
							<label>${this._composedChat.model}</label>
							<details>
								<summary>Based on ${this._composedChat.cards.length} out of ${this._composedChat.requested_cards.length} cards</summary>
								<tag-list
									.tags=${this._composedChat.cards}
									.previousTags=${this._composedChat.requested_cards}
									.tagInfos=${this._cardTagInfos}
								></tag-list>
							</details>
						</div>
					</div>
					<div class='messages'>
						${this._composedChat.messages.map(message => this.renderMessage(message))}
					</div>
					<div class='compose'>
						<textarea 
							placeholder="Type your message here..." 
							.value=${this._composingMessage} 
							@input=${this._handleContentUpdated} 
							@keydown=${this._handleKeyDown} 
							?disabled=${!this._userMayChatInCurrentChat || this._sending}
						></textarea>
						<div class='buttons'>
							<button class='round primary' @click='${this._handleDoneClicked}' title='Send Message' ?disabled=${this._sendingButtonDisabled}>${SEND_ICON}</button>
						</div>
					</div>
				` : html`<p>No chat data available.</p>`}
			</section>
		`;
	}

	_handleDoneClicked() {
		store.dispatch(postMessageInCurrentChat(this._composingMessage));
	}

	_handleContentUpdated(event: Event) {
		const target = event.target;
		if (!(target instanceof HTMLTextAreaElement)) return;
		const value = target.value;
		store.dispatch(updateComposingMessage(value));
	}

	get _sendingButtonDisabled() : boolean {
		return !this._userMayChatInCurrentChat || !this._composingMessage || this._sending;
	}

	_handleKeyDown(event: KeyboardEvent) {
		// If Enter but not Shift+Enter is pressed, send the message
		if (event.key === 'Enter' && !event.shiftKey) {
			// Only trigger if the send button is enabled
			if (this._sendingButtonDisabled) return;
			event.preventDefault();
			this._handleDoneClicked();
		}
	}

	override stateChanged(state: State) {
		// pageExtra will contain the chat ID from the URL
		this._pageExtra = selectPageExtra(state);
		this._chatID = selectCurrentChatID(state);
		this._composedChat = selectCurrentComposedChat(state);
		this._cardTagInfos = selectTagInfosForCards(state);
		this._userMayChatInCurrentChat = selectUserMayChatInCurrentChat(state);
		this._composingMessage = selectChatComposingMessage(state);
		this._sending = selectChatSending(state);
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_pageExtra')) {
			store.dispatch(updateCurrentChat(this._pageExtra));
		}
		if (changedProps.has('_chatID')) {
			//Start fetching the data necessary to render this chat.
			connectLiveChat(this._chatID);
		}
		if (changedProps.has('_composedChat') && this._composedChat) {
			// Focus the textarea when chat first shows up
			setTimeout(() => {
				const textarea = this.shadowRoot?.querySelector('textarea');
				if (textarea && this._userMayChatInCurrentChat && !this._sending) {
					textarea.focus();
				}
			}, 100);
		}
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'chat-view': ChatView;
	}
}