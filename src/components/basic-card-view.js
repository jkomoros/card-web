import { html } from '@polymer/lit-element';
import { PageViewElement } from './page-view-element.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

import { 
	selectFetchedCard,
	selectPageExtra,
	selectCardBeingFetched
} from '../selectors.js';

import { 
	fetchCard
} from '../actions/app.js';

import './card-stage.js';

class BasicCardView extends connect(store)(PageViewElement) {
	render() {
		return html`
	  ${SharedStyles}
	  <style>
		:host {
			height: 100%;
			width: 100%;
			position:absolute;
		}
		card-stage {
			height: 100%;
			width: 100%;
		}
	  </style>
	  <card-stage .card=${this._card} .presenting=${true} .loading=${this._cardBeingFetched}></card-stage>
    `;
	}

	static get properties() {
		return {
			_card: { type: Object},
			_pageExtra: { type:String },
			_cardBeingFetched: { type: Boolean},
		};
	}

	stateChanged(state) {
		this._card = selectFetchedCard(state);
		this._pageExtra = selectPageExtra(state);
		this._cardBeingFetched = selectCardBeingFetched(state);
	}

	updated(changedProps) {
		if (changedProps.has('_pageExtra')) {
			store.dispatch(fetchCard(this._pageExtra));
		}
	}

}

window.customElements.define('basic-card-view', BasicCardView);
