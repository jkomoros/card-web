import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
class BaseCard extends LitElement {
  render() {
    return html`
      <div>
        <h1>${this.title}</h1>
        <div class="body">
          ${this.body}
        </div>
      </div>
    `;
  }

  static get properties() {
    return {
      title: { type: String },
      body: { type: String }
    }
  }
}

window.customElements.define('base-card', BaseCard);
