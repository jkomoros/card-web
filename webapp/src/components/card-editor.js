import { LitElement, html } from '@polymer/lit-element';


class CardEditor extends LitElement {
  render() {
    return html`
      Hello, this is a card editor!
    `;
  }

}

window.customElements.define('card-editor', CardEditor);
