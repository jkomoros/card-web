import { LitElement, html } from '@polymer/lit-element';

import './author-chip.js';

import {
  prettyTime
} from '../actions/util.js';

// This element is *not* connected to the Redux store.
class CommentMessage extends LitElement {
  render() {
    return html`
      <style>
        span {
          color: var(--app-dark-text-color-light);
        }
      </style>
      <div>
        <author-chip .author=${this.message.author}></author-chip>
        <span>${prettyTime(this.message.updated)}</span>
        <div>
          ${this.message.message}
        </div>
      </div>
    `;
  }

  static get properties() {
    return {
      message: { type: Object },
    }
  }
}

window.customElements.define('comment-message', CommentMessage);
