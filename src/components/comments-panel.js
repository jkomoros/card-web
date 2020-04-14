import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { addCommentIcon } from './my-icons.js';

import './comment-thread.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	deleteMessage,
	resolveThread
} from '../actions/comments.js';

import {
	selectActiveCard,
	selectUser,
	selectUserMayComment,
	selectActiveCardComposedThreads,
	selectCollectionIsFallback,
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

class CommentsPanel extends connect(store)(PageViewElement) {
	render() {
		return html`
      ${SharedStyles}
      ${ButtonSharedStyles}
      <style>
        :host {
		  flex-grow: 1;
		  overflow: hidden;
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
        .comments {
          overflow:scroll;
          height:100%;
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
      </style>
      <div ?hidden=${!this._open} class='container'>
        <h3>Comments</h3>
        <div class='comments'>
        ${this._composedThreads.length
		? html`${this._composedThreads.map( (item) => html`
                <comment-thread .user=${this._user} .thread=${item} @add-message='${this._handleAddMessage}' @edit-message='${this._handleEditMessage}' @delete-message=${this._handleDeleteMessage} @resolve-thread=${this._handleResolveThread} @show-need-signin=${this._handleShowNeedSignin} .userMayComment=${this._userMayComment}></comment-thread>`)}`
		: html`<p><em>No comments yet.</em></p><p><em>You should leave one!</em></p>`
}
        <div class='spacer'></div>
        <button ?disabled=${this._collectionIsFallback} class='round ${this._userMayComment ? '' : 'need-signin'}' title='${this._userMayComment ? 'Start new comment thread' : 'Sign in to start new comment thread'}' @click='${this._handleCreateThreadClicked}'>${addCommentIcon}</button>
      </div>
    `;
	}

	static get properties() {
		return {
			_open: {type: Boolean},
			_card: {type: Object},
			//If the card showing is a fallback card shown for an empty thing,
			//disallow comments.
			_collectionIsFallback: {type:Boolean},
			_composedThreads: {type: Array},
			_userMayComment: { type: Boolean},
			_user: {type: Object},
		};
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

	_handleAddMessage(e) {
		if (!e.detail.thread || !e.detail.thread.id) return;
		store.dispatch(configureCommitAction(COMMIT_ACTIONS.ADD_MESSAGE, e.detail.thread.id));
		this._showCompose('');
	}

	_handleEditMessage(e) {
		if (!e.detail.message || !e.detail.message.id) return;
		store.dispatch(configureCommitAction(COMMIT_ACTIONS.EDIT_MESSAGE, e.detail.message.id));
		this._showCompose(e.detail.message.message);
	}

	_showCompose(content) {
		store.dispatch(composeShow('What is your message? (Markdown syntax is supported)', content));
	}

	_handleDeleteMessage(e) {
		store.dispatch(deleteMessage(e.detail.message));
	}

	_handleResolveThread(e) {
		store.dispatch(resolveThread(e.detail.thread));
	}

	stateChanged(state) {
		this._open = selectCommentsAndInfoPanelOpen(state);
		this._card = selectActiveCard(state);
		this._collectionIsFallback = selectCollectionIsFallback(state);
		this._composedThreads = selectActiveCardComposedThreads(state);
		this._userMayComment = selectUserMayComment(state);
		this._user = selectUser(state);
	}
}

window.customElements.define('comments-panel', CommentsPanel);
