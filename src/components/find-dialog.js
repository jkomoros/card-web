import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import find from '../reducers/find.js';
store.addReducers({
	find
});

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

import {
	selectExpandedRankedCollectionForQuery
} from '../selectors.js';

import { plusIcon } from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './card-drawer.js';
import { newID, toTitleCase } from '../util.js';
import { createCard } from '../actions/data.js';

class FindDialog extends connect(store)(DialogElement) {
	innerRender() {
		return html`
		${ButtonSharedStyles}
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

			.add {
				text-align:right;
			}
		</style>
		<input placeholder='Text to search for' id='query' type='search' @input=${this._handleQueryChanged} .value=${this._query}></input>
		<card-drawer showing grid @thumbnail-tapped=${this._handleThumbnailTapped} .collection=${this._collection}></card-drawer>
		<div ?hidden=${!this._linking} class='add'>
			<button class='round' @click='${this._handleAddSlide}'>${plusIcon}</button>
		</div>
	`;
	}

	constructor() {
		super();
		this.title = 'Search';
	}

	_shouldClose() {
		//Override base class.
		store.dispatch(closeFindDialog());
	}

	_handleQueryChanged(e) {
		let ele = e.composedPath()[0];
		store.dispatch(updateQuery(ele.value));
	}

	_handleAddSlide() {
		const title = prompt('What should the title be?', toTitleCase(this._query));
		if (!title || !title.trim()) {
			console.warn('No title provided');
			return;
		}
		const id = newID();
		const opts = {
			id,
			title,
			noNavigate: true,
		};
		store.dispatch(createCard(opts));
		store.dispatch(linkCard(id));
		this._shouldClose();
	}

	_handleThumbnailTapped(e) {
		this._shouldClose();
		if (this._linking) {
			store.dispatch(linkCard(e.detail.card.id));
			return;
		}
		store.dispatch(navigateToCard(e.detail.card));
	}

	static get properties() {
		return {
			_query: {type: String},
			_collection: {type:Array},
			_linking: {type:Boolean},
		};
	}

	updated(changedProps) {
		if (changedProps.has('open') && this.open) {
			//When first opened, select the text in query, so if the starter
			//query is wrong as you long keep typing it will be no cost
			this.shadowRoot.getElementById('query').select();
		}
	}

	stateChanged(state) {
		//tODO: it's weird that we manually set our superclasses' public property
		this.open = state.find.open;
		this._query = state.find.query;
		this._collection = selectExpandedRankedCollectionForQuery(state);
		this._linking = state.find.linking;
	}

}

window.customElements.define('find-dialog', FindDialog);
