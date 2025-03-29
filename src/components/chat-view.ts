import { html, css, PropertyValues, TemplateResult } from 'lit';
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
	selectChatMessagesLoading,
	selectChatSending,
	selectChatsInOrder,
	selectChatsLoading,
	selectCurrentChatID,
	selectCurrentComposedChat,
	selectPageExtra,
	selectTagInfosForCards,
	selectUid,
	selectUserMayChatInCurrentChat
} from '../selectors.js';

import {
	Chat,
	ChatID,
	ChatMessage,
	ComposedChat,
	Uid
} from '../../shared/types.js';

import {
	connectLiveChat,
	connectLiveOwnedChats,
	postMessageInCurrentChat,
	togglePublishedForCurrentChat,
	updateComposingMessage,
	updateCurrentChat
} from '../actions/chat.js';

import {
	SEND_ICON,
	VISIBILITY_ICON,
	VISIBILITY_OFF_ICON,
	OPEN_IN_BROWSER_ICON
} from '../../shared/icons.js';

import {
	markdownElement
} from '../util.js';

import {
	HelpStyles
} from './help-badges.js';

import {
	CollectionDescription,
	collectionDescriptionWithFilterAppended
} from '../collection_description.js';

import {
	urlForCollection
} from '../actions/app.js';

import {
	cardsFilter,
	unionFilter
} from '../filters.js';

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
		_chats : Chat[] = [];

	@state()
		_uid : Uid;

	@state()
		_composingMessage : string;

	@state()
		_sending : boolean;

	@state()
		_chatsLoading : boolean;

	@state()
		_chatMessagesLoading : boolean;

	static override styles = [
		ButtonSharedStyles,
		SharedStyles,
		HelpStyles,
		css`
			:host {
				height: 100%;
				overflow: auto;
			}

			section {
				height: 100%;
				display: flex;
				flex-direction: row;
				position: relative;
			}

			.chats-sidebar {
				width: 240px;
				height: 100%;
				background-color: var(--app-section-even-color, #f7f7f7);
				border-right: 1px solid var(--app-divider-color, #e0e0e0);
				padding: 1.5rem 0;
				overflow-y: auto;
			}

			.chats-sidebar.closed {
				width: 0;
				padding: 0;
				border-right: none;
			}
			
			.chats-sidebar h3 {
				padding: 0 1.5rem;
				margin-top: 0;
				margin-bottom: 1.5rem;
				color: var(--app-dark-text-color);
				font-size: 1.2rem;
			}
			
			.chats-sidebar ul {
				list-style: none;
				padding: 0;
				margin: 0;
			}
			
			.chats-sidebar li {
				margin: 0;
			}
			
			.chats-sidebar a {
				display: block;
				padding: 0.75rem 1.5rem;
				color: var(--app-dark-text-color);
				text-decoration: none;
				transition: background-color 0.2s, color 0.2s;
				border-left: 3px solid transparent;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			
			.chats-sidebar a:hover {
				background-color: rgba(0, 0, 0, 0.05);
			}
			
			.chats-sidebar a.active {
				background-color: rgba(var(--app-primary-rgb, 0, 120, 212), 0.1);
				color: var(--app-primary-color);
				border-left-color: var(--app-primary-color);
				font-weight: 500;
			}

			.chat {
				flex-grow: 1;
				display: flex;
				flex-direction: column;
				gap: 1rem;
				padding: 1.5rem;
				max-width: 800px;
				margin: 0 auto;
				width: 100%;
				height: 100%;
				overflow-y: auto;
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

			.message[data-status="failed"] {
				color: white;
				background-color: var(--app-warning-color);
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

		let ele : TemplateResult | HTMLElement = html`<em class='loading'>Thinking...</em>`;
		if (message.status === 'failed') {
			ele = html`<em class='error' title=${message.error || ''}>Message failed</em>`;
			//We can render streaming content if there is some.
		} else if (message.status === 'complete' || message.content) {
			ele = markdownElement(message.content) || html`<span></span>`;
		}

		return html`<div class='message' data-role='${message.role}' data-status='${message.status}'>
			<strong class='interface'>${message.role}</strong>
			<div class='content'>
				${ele}
			</div>
		</div>`;
	}

	override render() {

		//Show the sidebar if the user has access to more than one downloaded
		//chat or any of the downloaded chat are theirs.
		const showSidebar = this._chats.length > 1 || this._chats.map(chat => chat.owner).includes(this._uid);

		//Calculate the precise collectionURL that shows the cards actually selected to show.
		//This allows a workflow of exporting those cards (selected by embeddings) into a Google Doc or something.
		let collectionURL : string = '';
		if (this._composedChat) {
			const collection = CollectionDescription.deserialize(this._composedChat.collection.description);
			const cardFilter = cardsFilter(unionFilter(...this._composedChat.cards));
			const extended = collectionDescriptionWithFilterAppended(collection, cardFilter);
			//This URL could get extremely long!
			collectionURL = urlForCollection(extended);
		}

		return html`
			<section>
				<div class='chats-sidebar ${showSidebar ? 'open' : 'closed'}'>
					<h3>Chats</h3>
					<ul>
						${this._chats.map(chat => html`
							<li>
								<a href='/chat/${chat.id}' class='${this._chatID === chat.id ? 'active' : ''}' title=${chat.title || chat.id}>
									${chat.title || chat.id}
								</a>
							</li>
						`)}
					</ul>
				</div>
				<div class='chat'>
				${this._composedChat ? html`
					<div class="metadata">
						<h2>${this._composedChat.title}</h2>
						<div>
							<label>${this._composedChat.model}</label>
							<button
								class='small'
								@click=${this._handlePublishClicked}
								id='publish'
								title='${this._composedChat.published ? 'Unpublish' : 'Publish'} this chat'
								?disabled=${!this._userMayChatInCurrentChat}
							>
								${this._composedChat.published ? VISIBILITY_ICON : VISIBILITY_OFF_ICON}
							</button>
							<label for='publish'>${this._composedChat.published ? 'Published' : 'Unpublished'}</label>
							<details>
								<summary>Based on ${this._composedChat.cards.length} out of ${this._composedChat.requested_cards.length} cards</summary>
								<a title='Navigate to this collection' href=${collectionURL} class='help'>${OPEN_IN_BROWSER_ICON}</a>
								<tag-list
									.tags=${this._composedChat.cards}
									.previousTags=${this._composedChat.requested_cards}
									.tagInfos=${this._cardTagInfos}
								></tag-list>
							</details>
						</div>
					</div>
					<div class='messages'>
						${this._composedChat.messages.length === 0 ? (this._chatMessagesLoading ? html`<div class='loading'>Loading...</div>` : html`<p>No messages loaded.</p>`) :
		this._composedChat.messages.map(message => this.renderMessage(message))}
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
				` : (this._chatsLoading ? html`
					<div class='loading'>
						Loading chat...
					</div>` : html`<p>No chats to view.</p>`)}
				</div>
			</section>
		`;
	}

	_handlePublishClicked() {
		store.dispatch(togglePublishedForCurrentChat());
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
		this._uid = selectUid(state);
		this._chats = selectChatsInOrder(state);
		this._chatsLoading = selectChatsLoading(state);
		this._chatMessagesLoading = selectChatMessagesLoading(state);
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_pageExtra')) {
			store.dispatch(updateCurrentChat(this._pageExtra));
		}
		if (changedProps.has('_chatID') || changedProps.has('_uid')) {
			//Start fetching the data necessary to render this chat.
			connectLiveChat(this._chatID);
		}
		if (changedProps.has('_uid') && this._uid) {
			// Ensure we are connected to the chat data for the current user
			connectLiveOwnedChats();
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