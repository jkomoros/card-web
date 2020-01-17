import { LitElement, html } from '@polymer/lit-element';

import './star-count.js';
import './read-decorator.js';
import './thread-count.js';
import './reading-list-decorator.js';
import './todo-decorator.js';

import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
	selectUserStars, selectUserReads, selectCardTodosMapForCurrentUser, selectUserReadingListMap
} from '../selectors.js';

//CardBadges is designed to be included in a card-like object and
//automatically put the applicable badges into the various corners.
class CardBadges extends connect(store)(LitElement) {
	render() {
		return html`
      <style>

		:host {
			position:absolute;
			top: 0;
			left: 0;
			height: 100%;
			width: 100%;
		}

        .top-right {
          position:absolute;
          top: 0.25em;
          right: 0.25em;
		  display: flex;
        }

        read-decorator {
          position:absolute;
          left: 0.25em;
          top: 0.25em;
        }

        thread-count {
          position:absolute;
          bottom:0.25em;
          right: 0.25em;
        }

        reading-list-decorator {
          position: absolute;
          bottom:0.25em;
          left: 0.25em;
        }

      </style>
      <div class='top-right'>
        <star-count .count=${this._nonBlankCard.star_count || 0} .highlighted=${this._starred} .light=${this.light}></star-count>		
        <todo-decorator .visible=${this._hasTodo} .light=${this.light}></todo-decorator>
      </div>
      <read-decorator .visible=${this._read} .light=${this.light}></read-decorator>
      <thread-count .count=${this._nonBlankCard.thread_count || 0} .light=${this.light}></thread-count>
      <reading-list-decorator .visible=${this._onReadingList} .light=${this.light}></reading-list-decorator>
    `;
	}

	static get properties() { 
		return {
			//If a light theme shpould be used
			light: { type: Boolean },
			card: {type: Object},
			_starMap: {type: Object},
			_readMap: {type: Object},
			_todoMap: {type: Object},
			_readingListMap: {type: Object},
		};
	}

	get _nonBlankCard() {
		return this.card || {};
	}

	get _id(){
		return this._nonBlankCard.id || '';
	}

	get _starred() {
		return (this._starMap || {})[this._id];
	}

	get _read() {
		return (this._readMap || {})[this._id];
	}

	get _hasTodo() {
		return (this._todoMap || {})[this._id];
	}

	get _onReadingList() {
		return (this._readingListMap || {})[this._id];
	}

	stateChanged(state) {
		/* it isn't that much of a waste that we have four general maps that
		repeat for every card-decorators because it's just a reference to the
		same underlying object the selector returns */
		this._starMap = selectUserStars(state);
		this._readMap = selectUserReads(state);
		this._todoMap = selectCardTodosMapForCurrentUser(state);
		this._readingListMap = selectUserReadingListMap(state);
	}

}

window.customElements.define('card-badges', CardBadges);
