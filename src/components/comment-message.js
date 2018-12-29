import { LitElement, html } from '@polymer/lit-element';


// This element is *not* connected to the Redux store.
class CommentMessage extends LitElement {
  render() {
    return html`
      <div>
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
