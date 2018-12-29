import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import './comment-message.js';

// This element is *not* connected to the Redux store.
class CommentThread extends LitElement {
  render() {
    return html`
      <style>
        .container {
          cursor:pointer;
          padding: 0.5em;
          width: 12em;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:center;
          background-color: var(--card-color);
          box-shadow: var(--card-shadow);
          margin:0.5em;
          box-sizing:border-box;
        }
        comment-message {
          border-bottom:1px solid (--app-divider-color);
        }
      </style>
      <div class='container'>
        ${repeat(this.thread.messages, (message) => message.id, (item, index) => html`
                <comment-message .message=${item}></comment-message>`)}
      </div>
    `;
  }

  static get properties() {
    return {
      thread: { type: Object },
    }
  }
}

window.customElements.define('comment-thread', CommentThread);
