import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import './comment-message.js';

// This element is *not* connected to the Redux store.
class CommentThread extends LitElement {
  render() {
    return html`
        ${repeat(this.thread.messages, (message) => message.id, (item, index) => html`
                <comment-message .message=${item}></comment-message>`)}
    `;
  }

  static get properties() {
    return {
      thread: { type: Object },
    }
  }
}

window.customElements.define('comment-thread', CommentThread);
