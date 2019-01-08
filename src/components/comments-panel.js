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
  deleteMessage,
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
  selectActiveCard,
  selectUid,
  selectUserSignedIn,
  selectUserMayComment,
} from '../selectors.js';

import {
  showNeedSignin
} from '../actions/user.js';

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
          overflow:hidden;
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
                <comment-thread .uid=${this._uid} .thread=${item} @add-message='${this._handleAddMessage}' @edit-message='${this._handleEditMessage}' @delete-message=${this._handleDeleteMessage} @resolve-thread=${this._handleResolveThread} @show-need-signin=${this._handleShowNeedSignin} .userMayComment=${this._userMayComment} .signedIn=${this._signedIn}></comment-thread>`)}`
          : html`<p><em>No comments yet.</em></p><p><em>You should leave one!</em></p>`
        }
        <div class='spacer'></spacer>
        </div>
        <button class='round ${this._signedIn ? '' : 'need-signin'}' title='${this._userMayComment ? 'Start new comment thread' : 'Sign in to start new comment thread'}' @click='${this._handleCreateThreadClicked}'>${addCommentIcon}</button>
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean},
      _card: {type: Object},
      _composedThreads: {type: Array},
      _userMayComment: { type: Boolean},
      _uid : { type:String },
      _signedIn: {type:Boolean}
    }
  }

  _handleShowNeedSignin(e) {
    store.dispatch(showNeedSignin());
  }

  _handleCreateThreadClicked(e) {
    if (!this._signedIn) {
      store.dispatch(showNeedSignin());
      return;
    }
    if (!this._userMayComment) return;
    store.dispatch(createThread(prompt('Message for new thread: (markdown formatting is supported)')));
  }

  _handleAddMessage(e) {
    store.dispatch(addMessage(e.detail.thread, e.detail.message));
  }

  _handleEditMessage(e) {
    store.dispatch(editMessage(e.detail.message, e.detail.newMessage));
  }

  _handleDeleteMessage(e) {
    store.dispatch(deleteMessage(e.detail.message));
  }

  _handleResolveThread(e) {
    store.dispatch(resolveThread(e.detail.thread));
  }

  stateChanged(state) {
    this._open = state.app.commentsPanelOpen;
    this._card = selectActiveCard(state);
    this._composedThreads = composedThreadsSelector(state);
    this._userMayComment = selectUserMayComment(state);
    this._uid = selectUid(state);
    this._signedIn = selectUserSignedIn(state);
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
