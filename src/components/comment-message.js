import { LitElement, html } from '@polymer/lit-element';

import './author-chip.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
  editIcon
} from './my-icons.js';

import {
  prettyTime
} from '../actions/util.js';

import {
  uidMayEditMessage
} from '../reducers/user.js';

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
          <button class='small' @click=${this._handleEditClicked} ?hidden=${!uidMayEditMessage(this.userId, this.message)}>${editIcon}</button>
        </div>
        <span>${prettyTime(this.message.updated)}</span>
        <div>
          ${this.message.message}
        </div>
      </div>
    `;
  }

  _handleEditClicked(e) {
    let message = prompt("What is your new response?", this.message.message);
    if (!message || message == this.message.message) return;
    this.dispatchEvent(new CustomEvent('edit-message', {composed:true, detail: {message: this.message, newMessage:message}}));
  }

  static get properties() {
    return {
      message: { type: Object },
      userId: {type: String},
    }
  }
}

window.customElements.define('comment-message', CommentMessage);
