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

import {
  saveIcon,
  cancelIcon
} from './my-icons.js';

class CardEditor extends connect(store)(LitElement) {
  render() {
    return html`
      ${ButtonSharedStyles}
      <style>

        .container {
          width: 100%;
          height:100%;
          display:flex;
          flex-direction: column;
          padding:1em;
          box-sizing:border-box;
        }

        .inputs {
          display:flex;
          flex-direction:column;
          width:100%;
          flex-grow:1;
        }

        input, textarea {
          border: 0 solid black;
          font-size:0.8em;
          border-bottom:1px solid var(--app-dark-text-color);
          width: 100%;
        }

        textarea {
          flex-grow:1;
        }

        .flex {
          flex-grow:1;
        }

        .body {
          display:flex;
          flex-direction:column;
        }

        .buttons {
          display:flex;
          flex-direction:row;
          width:100%;
        }

        .buttons h3 {
          font-size:1em;
          opacity:0.5;
          font-weight:normal;
          flex-grow:1;
        }
      </style>
      <div class='container'>
        <div class='inputs'>
          <div>
            <label>Title</label>
            <input type='text' @input='${this._handleTitleUpdated}' .value=${this._card.title}></input>
          </div>
          <div class='flex body'>
            <label>Body</label>
            <textarea @input='${this._handleBodyUpdated}' .value=${this._card.body}></textarea>
          </div>
        </div>
        <div class='buttons'>
          <h3>Editing</h3>
          <button class='round' @click='${this._handleCancel}'>${cancelIcon}</button>
          <button class='round primary' @click='${this._handleCommit}'>${saveIcon}</button>
        </div>
      </div>
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
