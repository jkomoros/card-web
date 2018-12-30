import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { addCommentIcon } from './my-icons.js';

import './comment-thread.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
  createThread,
  addMessage,
  editMessage,
  resolveThread
} from '../actions/comments.js';

import {
  composedThreadsSelector
} from '../reducers/comments.js';

import {
  connectLiveMessages,
  connectLiveThreads
} from '../actions/database.js';

import {
  cardSelector
} from '../reducers/data.js';

import {
  userMayComment,
  userId
} from '../reducers/user.js';

import {
  PageViewElement
} from './page-view-element.js';

class CommentsPanel extends connect(store)(PageViewElement) {
  render() {
    return html`
      ${SharedStyles}
      ${ButtonSharedStyles}
      <style>
        .container {
          min-width: 6em;
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
        ${repeat(this._composedThreads, (thread) => thread.id, (item, index) => html`
                <comment-thread .userId=${this._userId} .thread=${item} @add-message='${this._handleAddMessage}' @edit-message='${this._handleEditMessage}' @resolve-thread=${this._handleResolveThread} .userMayComment=${this._userMayComment}></comment-thread>`)}
        <div class='spacer'></spacer>
        </div>
        <button class='round' ?disabled='${!this._userMayComment}' title='${this._userMayComment ? 'Start new comment thread' : 'Sign in to start new comment thread'}' @click='${this._handleCreateThreadClicked}'>${addCommentIcon}</button>
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean},
      _card: {type: Object},
      _composedThreads: {type: Array},
      _userMayComment: { type: Boolean},
      _userId : { type:String }
    }
  }

  _handleCreateThreadClicked(e) {
    store.dispatch(createThread(prompt('Message for new thread:')));
  }

  _handleAddMessage(e) {
    store.dispatch(addMessage(e.detail.thread, e.detail.message));
  }

  _handleEditMessage(e) {
    store.dispatch(editMessage(e.detail.message, e.detail.newMessage));
  }

  _handleResolveThread(e) {
    store.dispatch(resolveThread(e.detail.thread));
  }

  stateChanged(state) {
    this._open = state.comments.panelOpen;
    this._card = cardSelector(state);
    this._composedThreads = composedThreadsSelector(state);
    this._userMayComment = userMayComment(state);
    this._userId = userId(state);
  }

  updated(changedProps) {
    if (changedProps.has('_card')) {
      if (this._card && this._card.id) {
        connectLiveMessages(store, this._card.id);
        connectLiveThreads(store, this._card.id);
      }
    }
  }
}

window.customElements.define('comments-panel', CommentsPanel);
