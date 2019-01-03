import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { repeat } from 'lit-html/directives/repeat';

// This element is connected to the Redux store.
import { store } from '../store.js';

import './card-thumbnail.js';

import { plusIcon } from './my-icons.js';

import {
  navigateToCard,
} from '../actions/app.js';

import {
  userMayEdit
} from '../reducers/user.js';

import {
  cardsDrawerPanelShowing
} from '../reducers/app.js';

import {
  showSection,
  createCard,
  reorderCard,
} from '../actions/data.js';

import { collectionSelector } from '../reducers/data.js'

import { ButtonSharedStyles } from './button-shared-styles.js';
import { SharedStyles } from './shared-styles.js';


class CardDrawer extends connect(store)(LitElement) {
  render() {
    return html`
      ${SharedStyles}
      ${ButtonSharedStyles}
      <style>
        :host {
          max-height:100%;
        }

        .scrolling {
          overflow:scroll;
          max-height:100%;
          flex-grow:1;
        }

        .container {
          height:100%;
          display:flex;
          width: 13em;
          flex-direction:column;
          border-right: 1px solid var(--app-divider-color);
        }

        button {
          position: absolute;
          left: 1em;
          bottom: 1em;
        }

        .dragging .spacer {
          /* When dragging, move these on top to give htem a bigger drop target (even if it isn't that visible) */
          position:relative;
          z-index:10000;
        }

        .reordering {
          opacity:0.7;
        }

        .spacer {
          /* Big drop target, but no change in layout */
          height:3em;
          margin-bottom:-3em;
          margin-left: 1em;
          margin-right: 1em;
        }

        .spacer.drag-active {
          /* Get some space in the layout and render a bar */
          border-top: 1px solid var(--app-dark-text-color);
          margin-top: 1.5em;
          margin-bottom:-2em;
        }
      </style>
      <div ?hidden='${!this._showing}' class='container ${this._dragging ? 'dragging' : ''}${this._reorderPending ? 'reordering':''}'>
        <div class='scrolling'>
        ${repeat(this._collection, (i) => i.id, (i, index) => html`
          <div class='spacer' .index=${index} @dragover='${this._handleDragOver}' @dragenter='${this._handleDragEnter}' @dragleave='${this._handleDragLeave}' @drop='${this._handleDrop}'></div>
          <card-thumbnail @dragstart='${this._handleDragStart}' @dragend='${this._handleDragEnd}' .card=${i} .userMayEdit=${this._userMayEdit} @thumbnail-tapped=${this._thumbnailActivatedHandler} .id=${i.id} .name=${i.name} .title=${this._titleForCard(i)} .cardType=${i.card_type} .selected=${i.id == this._activeCardId} .index=${index} .starred=${this._stars[i.id] || false} .read=${this._reads[i.id] || false}></card-thumbnail>`)}
        </div>
        <button class='round' @click='${this._handleAddSlide}' ?hidden='${!this._userMayEdit}'>${plusIcon}</button>
      </div>
    `;
  }

  _titleForCard(card) {
    if (card.title) return card.title;
    //It' sonly legal to not have a title if you're full-bleed;
    if (!card.full_bleed) return "";
    if (!card.body) return "";
    let section = document.createElement('section');
    section.innerHTML = card.body;
    let ele = section.querySelector('strong');
    if (!ele) ele = section;
    return ele.innerText.split("\n")[0];
  }

  _thumbnailActivatedHandler(e) {
    let ele = e.target;
    store.dispatch(navigateToCard(ele.name || ele.id));
  }

  _handleAddSlide(e) {
    store.dispatch(createCard(this._activeSectionId));
  }

  _handleDragEnter(e) {
    let ele = e.composedPath()[0];
    ele.classList.add('drag-active')
  }

  _handleDragLeave(e) {
    let ele = e.composedPath()[0];
    ele.classList.remove('drag-active');
  }

  _handleDragStart(e) {
    //For some reason elements with shadow DOM did not appear to be draggable,
    //so instead of dragging just card-thumbnail and having card-drawer manage
    //all of it, draggable is set on the inner of the thumbnail; but all other
    //logic goes in here.

    let thumbnail = null;
    for (let item of Object.values(e.path)) {
      if (item.localName == 'card-thumbnail') {
        thumbnail = item;
      }
    }

    this._dragging = thumbnail;
  }

  _handleDragEnd(e) {
    this._dragging = null;
  }

  _handleDragOver(e) {
    //Necessary to say that this is a valid drop target
    e.preventDefault();
  }

  _handleDrop(e) {
    let target = e.composedPath()[0];
    target.classList.remove('drag-active');
    let thumbnail = this._dragging;
    let index = target.index;
    //reorderCard expects the index to insert to be after popping the item out
    //first--which means that if you drag it down to below where it was
    //before, it's off by one.
    if (thumbnail.index <= target.index) index--;
    store.dispatch(reorderCard(thumbnail.card, index));
  }

  _handleChange(e) {
    let ele = e.composedPath()[0];
    store.dispatch(showSection(ele.value));
  }

  static get properties() { return {
    _collection: { type: Array },
    _stars: { type: Object },
    _reads: { type: Object },
    _activeCardId: { type: String },
    _activeSectionId: { type: String },
    _userMayEdit: { type: Boolean},
    _dragging: {type: Boolean},
    _reorderPending: {type:Boolean},
    //_showing is more complicated than whether we're open or yet.
    _showing: {type:Boolean},
  }}

  // This is called every time something is updated in the store.
  stateChanged(state) {
    this._collection = collectionSelector(state);
    this._stars = state.user.stars;
    this._reads = state.user.reads;
    this._activeCardId = state.data.activeCardId;
    this._activeSectionId = state.data.activeSectionId;
    this._userMayEdit = userMayEdit(state);
    this._reorderPending = state.data.reorderPending;
    this._showing = cardsDrawerPanelShowing(state);
  }
}

window.customElements.define('card-drawer', CardDrawer);
