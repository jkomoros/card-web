import { LitElement, html } from '@polymer/lit-element';


// This is a reusable element. It is not connected to the store. You can
// imagine that it could just as well be a third-party element that you
// got from someone else.
class CardThumbnail extends LitElement {
  render() {
    return html`
      <div>
        <h3>${this.title}</h3>
      </div>
    `;
  }

  static get properties() { return {
    /* The total number of clicks you've done. */
    title: { type: String },
    selected: { type: Boolean }
  }};

}

window.customElements.define('card-thumbnail', CardThumbnail);
