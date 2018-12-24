import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
  addSlug,
} from '../actions/data.js';

import {
  editingFinish,
  editingCommit,
  titleUpdated,
  bodyUpdated,
  sectionUpdated,
  nameUpdated,
  substantiveUpdated,
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

        .inputs > div {
          display:flex;
          flex-direction:column;
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

        .inputs .row {
          display:flex;
          flex-direction:row;
          align-items:center;
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
          <div class='row'>
            <div>
              <label>Section</label>
              <select @change='${this._handleSectionUpdated}' .value=${this._card.section}>
                ${repeat(Object.values(this._sections), (item) => item, (item, index) => html`
                <option value="${item.id}" ?selected=${item.id == this._activeSectionId}>${item.title}</option>`)}
              </select>
            </div>
            <div>
              <Label>Slugs</label>
              <select .value=${this._card.name} @change='${this._handleNameUpdated}'>
                ${repeat([this._card.id, ...this._card.slugs], (item) => item, (item, index) => html`
                <option value="${item}" ?selected=${item == this._card.name}>${item}</option>`)}
              </select>
              <button @click='${this._handleAddSlug}'>+</button>
            </div>
          </div>
        </div>
        <div class='buttons'>
          <h3>Editing</h3>
          <div>
            <label>Substantive</label>
            <input type='checkbox' .checked=${this._substantive} @change='${this._handleSubstantiveChanged}'></input>
          </div>
          <button class='round' @click='${this._handleCancel}'>${cancelIcon}</button>
          <button class='round primary' @click='${this._handleCommit}'>${saveIcon}</button>
        </div>
      </div>
    `;
  }

  static get properties() { return {
    _card: { type: Object },
    _active: {type: Boolean },
    _sections: {type: Object },
    _substantive: {type: Object}
  }}

  stateChanged(state) {
    this._card= state.editor.card;
    this._active = state.editor.editing;
    this._sections = state.data.sections;
    this._substantive = state.editor.substantive;
  }

  shouldUpdate() {
    return this._active;
  }

  _handleTitleUpdated(e) {
    if (!this._active) return;
    let ele = e.path[0];
    store.dispatch(titleUpdated(ele.value));
  }

  _handleBodyUpdated(e) {
    if (!this._active) return;
    let ele = e.path[0];
    store.dispatch(bodyUpdated(ele.value));
  }

  _handleSectionUpdated(e) {
    if (!this._active) return;
    let ele = e.path[0];
    store.dispatch(sectionUpdated(ele.value));
  }

  _handleNameUpdated(e) {
    if (!this._active) return;
    let ele = e.path[0];
    store.dispatch(nameUpdated(ele.value));
  }

  _handleAddSlug(e) {
    if (!this._active) return;
    if (!this._card) return;
    let id = this._card.id;
    let ele = e.path[0];
    let value = prompt("Slug to add:");
    if (!value) return;
    store.dispatch(addSlug(id, value));
  }

  _handleSubstantiveChanged(e) {
    if (!this._active) return;
    let ele = e.path[0];
    store.dispatch(substantiveUpdated(ele.checked));
  }

  _handleCommit(e) {
    store.dispatch(editingCommit());
  }

  _handleCancel(e) {
    store.dispatch(editingFinish());
  }

}

window.customElements.define('card-editor', CardEditor);
