import { LitElement, html } from '@polymer/lit-element';

import './author-chip.js';

// This element is *not* connected to the Redux store.
class CommentMessage extends LitElement {
  render() {
    return html`
      <div>
        <author-chip .author=${this.message.author}></author-chip>
        ${this.message.message}
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
