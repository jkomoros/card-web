import { LitElement, html } from '@polymer/lit-element';

import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
	selectUserStars,
	selectUserReads,
	selectCardTodosMapForCurrentUser,
	selectUserReadingListMap
} from '../selectors.js';

import {
	PLAYLISLT_ADD_CHECK_ICON,
	FORUM_ICON,
	VISIBILITY_ICON,
	ASSIGNMENT_TURNED_IN_ICON,
	STAR_ICON
} from './my-icons.js';

const badge = (name, icon, countOrVisible, highlighted) => {
	const text = typeof countOrVisible == 'number' ? countOrVisible : '';
	return html`<div class='badge ${name} ${highlighted ? 'highlighted' : ''}' ?hidden=${!countOrVisible}><div>${icon}${text}</div></div>`;
};

export const starBadge = (count, highlighted) => {
	return badge('star-count', STAR_ICON, count, highlighted);
};

export const badgeStyles =  html`
	<style>
		.badge {
				display:block;
				font-size:0.8em;
		}

		.badge[hidden] {
			display:none;
		}

			.badge > div {
				display:flex;
				flex-direction:row;
				align-items:center;
				color: var(--app-dark-text-color-light);
			}

			.light {
				color: var(--app-light-text-color);
			}

			.badge.highlighted {
				color: var(--app-primary-color-subtle);
			}

			.light .badge.highlighted {
				color: var(--app-primary-color-light);
			}

			svg {
				height: 1em;
				width: 1em;
				fill: var(--app-dark-text-color-light);
			}

			.light svg {
				fill: var(--app-light-text-color);
			}

			.badge.highlighted svg {
				fill: var(--app-primary-color-subtle);
			}

			.light .badge.highlighted {
				fill: var(--app-primary-color-light);
			}
	</style>
`;

//CardBadges is designed to be included in a card-like object and
//automatically put the applicable badges into the various corners.
class CardBadges extends connect(store)(LitElement) {
	render() {
		return html`
      <style>

		:host, .container {
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

        .read{
          position:absolute;
          left: 0.25em;
          top: 0.25em;
        }

        .thread-count {
          position:absolute;
          bottom:0.25em;
          right: 0.25em;
        }

        .reading-list {
          position: absolute;
          bottom:0.25em;
          left: 0.25em;
        }
	  </style>
	  ${badgeStyles}
	  <div class="container ${this.light ? 'light' : ''}">
		<div class='top-right'>
			${badge('star-count', STAR_ICON, this._nonBlankCard.star_count, this._starred)}
			${badge('todo', ASSIGNMENT_TURNED_IN_ICON, this._hasTodo)}
		</div>
		${badge('read', VISIBILITY_ICON, this._read)}
		${badge('thread-count', FORUM_ICON, this._nonBlankCard.thread_count)}
		${badge('reading-list', PLAYLISLT_ADD_CHECK_ICON, this._onReadingList)}
	</div>
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
