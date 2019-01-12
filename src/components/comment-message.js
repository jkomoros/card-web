import { LitElement, html } from '@polymer/lit-element';

import './author-chip.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
  editIcon,
  deleteForeverIcon
} from './my-icons.js';

import {
  prettyTime
} from '../util.js';

import {
  userMayEditMessage
} from '../selectors.js';

import snarkdown from 'snarkdown';
import dompurify from 'dompurify';

// This element is *not* connected to the Redux store.
class CommentMessage extends LitElement {
  render() {
    return html`
      ${ ButtonSharedStyles }
      <style>
        :host {
          font-size: 0.85em;
          display:block;
          border-bottom:1px solid var(--app-divider-color);
          width:100%;
          padding-bottom:0.25em;
          margin-bottom:0.25em;
        }

        .container {
          width:100%;
        }
        span {
          color: var(--app-dark-text-color-light);
        }
        .row {
          display:flex;
          flex-direction:row;
          align-items:center;
          width:100%;
        }

        .row author-chip {
          flex-grow:1;
        }
      </style>
      <div class='container'>
        <div class='row'>
          <author-chip .author=${this.message.author}></author-chip>
          <div ?hidden=${!userMayEditMessage(this.user, this.message)}>
            <button class='small' ?hidden=${this.message.deleted} @click=${this._handleDeleteClicked}>${deleteForeverIcon}</button>
            <button class='small' @click=${this._handleEditClicked}>${editIcon}</button>
          </div>
        </div>
        <span>${prettyTime(this.message.updated)}</span>
        <div>
          ${this.message.deleted ? html`<em>This message has been deleted.</em>` : this._makeCommentDiv(this.message.message)}
        </div>
      </div>
    `;
  }

  _makeCommentDiv(message) {
    let div = document.createElement('div');
    let html = snarkdown(message);
    let sanitizedHTML = dompurify.sanitize(html);
    div.innerHTML = sanitizedHTML;
    return div;
  }

  _handleEditClicked(e) {
    this.dispatchEvent(new CustomEvent('edit-message', {composed:true, detail: {message: this.message}}));
  }

  _handleDeleteClicked(e) {
    if (!confirm("Delete this message forever? This action cannot be undone.")) {
      return;
    }
    this.dispatchEvent(new CustomEvent('delete-message', {composed: true, detail: {message: this.message}}));
  }

  static get properties() {
    return {
      message: { type: Object },
      user: {type: String},
    }
  }
}

window.customElements.define('comment-message', CommentMessage);
