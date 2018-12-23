import { LitElement, html } from '@polymer/lit-element';


class CardEditor extends LitElement {
  render() {
    return html`
      <h3>Editor</h3>
      Title:<input type='text' value='${this.card.title}'></input>
      Body:
      <textarea>
        ${this.card.body}
      </textarea>
    `;
  }

  static get properties() { return {
    card: { type: Object },
    active: {type: Boolean }
  }}

  shouldUpdate() {
    return this.active;
  }

}

window.customElements.define('card-editor', CardEditor);
