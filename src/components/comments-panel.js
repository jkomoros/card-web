import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { commentIcon } from './my-icons.js';

import './comment-thread.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
  createThread,
  addMessage
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
        ${repeat(this._composedThreads, (thread) => thread.id, (item, index) => html`
                <comment-thread .thread=${item} @add-message='${this._handleAddMessage}'></comment-thread>`)}
        <button class='round' @click='${this._handleCreateThreadClicked}'>${commentIcon}</button>
      </div>
    `;
  }

  static get properties() {
    return {
      _open: {type: Boolean},
      _card: {type: Object},
      _composedThreads: {type: Array},
    }
  }

  _handleCreateThreadClicked(e) {
    store.dispatch(createThread(prompt('Message for new thread:')));
  }

  _handleAddMessage(e) {
    store.dispatch(addMessage(e.detail.thread, e.detail.message));
  }

  stateChanged(state) {
    this._open = state.comments.panelOpen;
    this._card = cardSelector(state);
    this._composedThreads = composedThreadsSelector(state);
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
