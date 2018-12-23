import { LitElement, html } from '@polymer/lit-element';


class CardEditor extends LitElement {
  render() {
    return html`
     <button @click='${this._handleCancel}'>Cancel</button>
     <button @click='${this._handleCommit}'>Save</button>
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

  _handleCommit(e) {
    this.dispatchEvent(new CustomEvent('commit-editor', {composed:true}))
  }

  _handleCancel(e) {
    this.dispatchEvent(new CustomEvent('close-editor', {composed:true}))
  }

}

window.customElements.define('card-editor', CardEditor);
