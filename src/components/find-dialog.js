import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import find from '../reducers/find.js';
store.addReducers({
  find
});

import {
	collectionForQuery
} from '../reducers/find.js';

import {
	closeFindDialog,
	updateQuery
} from '../actions/find.js';

import {
	navigateToCard
} from '../actions/app.js';

import {
	linkCard
} from '../actions/editor.js';

import './card-drawer.js';

class FindDialog extends connect(store)(DialogElement) {
  innerRender() {
    return html`
    	<style>
    		card-drawer {
    			font-size:14px;
    		}

    		input, textarea {
	          border: 0 solid black;
	          font-size:0.8em;
	          border-bottom:1px solid var(--app-dark-text-color);
	          width: 100%;
	        }
    	</style>
    	<input placeholder='Text to search for' id='query' type='search' @input=${this._handleQueryChanged} .value=${this._query}></input>
    	<card-drawer showing grid @thumbnail-tapped=${this._handleThumbnailTapped} .collection=${this._collection}></card-drawer>
    `;
  }

  constructor() {
  	super();
  	this.title = 'Search';
  }

  firstUpdated() {
  	window.addEventListener('keydown', e => this._handleKeyDown(e));
  }

  _handleKeyDown(e) {
  	if (!this.open) return;
  	if (e.key == 'Escape') {
  		this._shouldClose();
  		return true;
  	}
  }

  _shouldClose() {
  	//Override base class.
  	store.dispatch(closeFindDialog());
  }

  _handleQueryChanged(e) {
    let ele = e.composedPath()[0];
    store.dispatch(updateQuery(ele.value));
  }

  _handleThumbnailTapped(e) {
  	this._shouldClose();
  	if (this._linking) {
  		store.dispatch(linkCard(e.detail.card));
  		return;
  	}
  	store.dispatch(navigateToCard(e.detail.card));
  }

  static get properties() {
  	return {
  		_query: {type: String},
  		_collection: {type:Array},
  		_linking: {type:Boolean},
  	}
  }

  stateChanged(state) {
  	//tODO: it's weird that we manually set our superclasses' public property
  	this.open = state.find.open;
  	this._query = state.find.query;
  	this._collection = collectionForQuery(state);
  	this._linking = state.find.linking;
  }

}

window.customElements.define('find-dialog', FindDialog);
