import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
  editingFinish,
  editingCommit,
  titleUpdated,
  bodyUpdated,
} from '../actions/editor.js';

class CardEditor extends connect(store)(LitElement) {
  render() {
    return html`
      ${ButtonSharedStyles}
     <button @click='${this._handleCancel}'>Cancel</button>
     <button @click='${this._handleCommit}'>Save</button>
      <h3>Editor</h3>
      Title:<input type='text' @input='${this._handleTitleUpdated}' .value=${this._card.title}></input>
      Body:
      <textarea @input='${this._handleBodyUpdated}' .value=${this._card.body}></textarea>
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

  _handleTitleUpdated(e) {
    if (!this._active) return;
    let ele = e.path[0];
    let title = ele.value;
    store.dispatch(titleUpdated(ele.value));
  }

  _handleBodyUpdated(e) {
    if (!this._active) return;
    let ele = e.path[0];
    let body = ele.value;
    store.dispatch(bodyUpdated(ele.value));
  }

  _handleCommit(e) {
    store.dispatch(editingCommit());
  }

  _handleCancel(e) {
    store.dispatch(editingFinish());
  }

}

window.customElements.define('card-editor', CardEditor);
