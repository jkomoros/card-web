import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { ADD_COMMENT_ICON } from './my-icons.js';

import './comment-thread.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';
import { ScrollingSharedStyles } from './scrolling-shared-styles.js';

import {
	deleteMessage,
	resolveThread
} from '../actions/comments.js';

import {
	selectActiveCard,
	selectUserMayComment,
	selectActiveCardComposedThreads,
	selectActiveCollection,
	selectCommentsAndInfoPanelOpen,
} from '../selectors.js';

import {
	showNeedSignin
} from '../actions/user.js';

import {
	configureCommitAction,
	composeShow,
	COMMIT_ACTIONS
} from '../actions/prompt.js';

import {
	PageViewElement
} from './page-view-element.js';

import {
	Card,
	ComposedCommentThread,
	State
} from '../types.js';

import {
	CommmentMessageEvent,
	CommmentThreadEvent
} from '../events.js';

@customElement('comments-panel')
class CommentsPanel extends connect(store)(PageViewElement) {
	
	@state()
		_open: boolean;

	@state()
		_card: Card;

	//If the card showing is a fallback card shown for an empty thing,
	//disallow comments.
	@state()
		_collectionIsFallback: boolean;

	@state()
		_composedThreads: ComposedCommentThread[];

	@state()
		_userMayComment: boolean;

	static override styles = [
		ButtonSharedStyles,
		ScrollingSharedStyles,
		SharedStyles,
		css`
			:host {
				overflow: hidden;
				flex-shrink: 0.5;
			}
			.container {
				min-width: 13em;
				height:100%;
				padding:0.5em;
				border-left: 1px solid var(--app-divider-color);
				position:relative;
			}
			.spacer {
				/* Ensure that it's possible to scroll the last comment's reply button above the FAB */
				height: 6em;
				width:100%;
			}
			.no-comments .spacer {
				height: 3em;
			}
			.comments {
				max-height:100%;
				width:100%;
			}
			.comments > p {
				color: var(--app-dark-text-color-light);
				margin:0;
			}
			h3 {
				margin:0;
				font-weight:normal;
				color: var(--app-dark-text-color-light);
			}
			button {
				position:absolute;
				bottom:1em;
				right:1em;
			}
		`
	];
	
	override render() {
		return html`

	  <div ?hidden=${!this._open} class='container ${this._composedThreads.length ? '' : 'no-comments'}'>
			<h3>Comments</h3>
			<div class='comments scroller'>
				${this._composedThreads.length
		? html`${this._composedThreads.map( (item) => html`
						<comment-thread .thread=${item} @add-message='${this._handleAddMessage}' @message-edit='${this._handleEditMessage}' @message-delete=${this._handleDeleteMessage} @thread-resolve=${this._handleResolveThread} @show-need-signin=${this._handleShowNeedSignin} .userMayComment=${this._userMayComment}></comment-thread>`)}`
		: html`<p><em>No comments yet.</em></p><p><em>You should leave one!</em></p>`
}
				<div class='spacer'></div>
				<button ?disabled=${this._collectionIsFallback} class='round ${this._userMayComment ? '' : 'need-signin'}' title='${this._userMayComment ? 'Start new comment thread' : 'Sign in to start new comment thread'}' @click='${this._handleCreateThreadClicked}'>${ADD_COMMENT_ICON}</button>
			</div>
		</div>
	`;
	}

	_handleShowNeedSignin() {
		store.dispatch(showNeedSignin());
	}

	_handleCreateThreadClicked() {
		if (!this._userMayComment) {
			store.dispatch(showNeedSignin());
			return;
		}
		store.dispatch(configureCommitAction(COMMIT_ACTIONS.CREATE_THREAD));
		this._showCompose('');
	}

	_handleAddMessage(e : CommmentThreadEvent) {
		if (!e.detail.thread || !e.detail.thread.id) return;
		store.dispatch(configureCommitAction(COMMIT_ACTIONS.ADD_MESSAGE, e.detail.thread.id));
		this._showCompose('');
	}

	_handleEditMessage(e : CommmentMessageEvent) {
		if (!e.detail.message || !e.detail.message.id) return;
		store.dispatch(configureCommitAction(COMMIT_ACTIONS.EDIT_MESSAGE, e.detail.message.id));
		this._showCompose(e.detail.message.message);
	}

	_showCompose(content : string) {
		store.dispatch(composeShow('What is your message? (Markdown syntax is supported)', content));
	}

	_handleDeleteMessage(e : CommmentMessageEvent) {
		store.dispatch(deleteMessage(e.detail.message));
	}

	_handleResolveThread(e : CommmentThreadEvent) {
		store.dispatch(resolveThread(e.detail.thread));
	}

	override stateChanged(state : State) {
		this._open = selectCommentsAndInfoPanelOpen(state);
		this._card = selectActiveCard(state);
		const activeCollection = selectActiveCollection(state);
		this._collectionIsFallback = activeCollection && activeCollection.isFallback;
		this._composedThreads = selectActiveCardComposedThreads(state);
		this._userMayComment = selectUserMayComment(state);
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'comments-panel': CommentsPanel;
	}
}
