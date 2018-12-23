import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
  editingFinish,
  editingCommit
} from '../actions/editor.js';

class CardEditor extends connect(store)(LitElement) {
  render() {
    return html`
     <button @click='${this._handleCancel}'>Cancel</button>
     <button @click='${this._handleCommit}'>Save</button>
      <h3>Editor</h3>
      Title:<input type='text' value='${this._card.title}'></input>
      Body:
      <textarea>
        ${this._card.body}
      </textarea>
    `;
  }

  static get properties() { return {
    _card: { type: Object },
    _active: {type: Boolean }
  }}

  stateChanged(state) {
    this._card= state.editor.card;
    this._active = state.editor.editing;     
  }

  shouldUpdate() {
    return this._active;
  }

  _handleCommit(e) {
    store.dispatch(editingCommit());
  }

  _handleCancel(e) {
    store.dispatch(editingFinish());
  }

}

window.customElements.define('card-editor', CardEditor);
