import { html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { SharedStyles } from './shared-styles.js';

import {
	helpIcon,
	warningIcon,
	repeatIcon,
	favoriteIcon,
} from './my-icons.js';

import {
	sectionTitle,
} from '../reducers/data.js';

import { 
	fetchTweets
} from '../actions/data.js';

import {
	selectActiveCard,
	selectTags,
	getAuthorForId,
	selectInboundLinksForActiveCard,
	selectActiveCardTweets,
	selectTweetsLoading,
} from '../selectors.js';

import {
	PageViewElement
} from './page-view-element.js';

import {
	prettyTime,
	markdownElement,
	urlForTweet
} from '../util.js';

import './author-chip.js';
import './card-link.js';
import './tag-list.js';

class CardInfoPanel extends connect(store)(PageViewElement) {
	render() {
		return html`
		${SharedStyles}
			<style>

				.help {
					margin-left:0.4em;
				}

				svg {
					height:1.3em;
					width:1.3em;
					fill: var(--app-dark-text-color-subtle);
				}

				.container {
					width: 13em;
					height:100%;
					padding:0.5em;
					border-left: 1px solid var(--app-divider-color);
					position:relative;
					color: var(--app-dark-text-color);
					overflow: scroll;
				}

				h3 {
					margin:0;
					font-weight:normal;
					color: var(--app-dark-text-color-light);
				}
				div>h4 {
					font-size:0.7em;
					font-weight:normal;
					margin:0;
				}
				div>p {
					margin:0;
				}
				div>ul {
					margin:0;
					padding-inline-start: 1.2em;
				}
				.container > div {
					margin: 0.5em 0;
				}
				.loading {
					opacity:0.7;
				}
			</style>
			<div class='container' ?hidden=${!this._open}>
				<h3>Card Info</h3>
				<div>
					<h4>ID${this._help('The underlying id of this card, which never changes. Navigating to this name will always come here')}</h4>
					<p>${this._card.id}</p>
				</div>
				<div>
					<h4>Name${this._help('The preferred name for this card, which will show up in the URL when you visit. Must be either the id or one of the slugs')}</h4>
					<p>${this._card.name}</p>
				</div>
				<div>
					<h4>Slugs${this._help('The alternate names that will navigate to this card.')}</h4>
					${this._card && this._card.slugs && this._card.slugs.length 
		? html`<ul>${this._card.slugs.map((item) => html`<li>${item}</li>`)}</ul>`
		: html`<p><em>No slugs</em></p>`
}
				</div>
				<div>
					<h4>Section${this._help('The collection that this card lives in.')}</h4>
					<p>${this._sectionTitle}</p>
				</div>
				<div>
					<h4>Last Updated</h4>
					<p>${prettyTime(this._card.updated_substantive)}</p>
				</div>
				<div>
					<h4>Created</h4>
					<p>${prettyTime(this._card.created)}</p>
				</div>
				<div>
					<h4>Author</h4>
					<p><author-chip .author=${this._author}></author-chip></p>
				</div>
				<div>
					<h4>Tags</h4>
					<tag-list .card=${this._card} .tags=${this._card.tags} .tagInfos=${this._tagInfos}></tag-list>
				</div>
				<div>
					<h4>Cards That Link Here${this._help('Cards that link to this one.')}</h4>
					${this._inboundLinks
		? html`<ul>${this._inboundLinks.map((item) => html`<li><card-link auto='title' card='${item}'>${item}</a></li>`)}</ul>`
		: html`<p><em>No cards link to this one.</em></p>`
}
				</div>
				<div>
					<h4>Notes${this._help('Notes are notes left by the author of the card.')}</h4>
					${this._card && this._card.notes
		? markdownElement(this._card.notes)
		: html `<p><em>No notes for this card</em></p>`
}
				</div>
				<div>
					<h4>Tweets from <a href='https://twitter.com/cardscompendium' target='_blank'>@CardsCompendium</a></h4>
					${this._tweets && Object.values(this._tweets).length
		? html`<ul class='${this._tweetsLoading ? 'loading' : ''}'>${Object.entries(this._tweets).map(entry => this._tweet(entry[1]))}</ul>`
		: this._tweetsLoading ? html`<em class='loading'>Loading...</em>` : html`<em>No tweets</em>` 
}
				</div>
			</div>
		`;
	}

	static get properties() {
		return {
			_open: {type: Boolean},
			_card: {type: Object},
			_sectionTitle: { type: String},
			_author: {type:Object},
			_tagInfos: {type: Object},
			_inboundLinks: {type: Array},
			_tweets: {type: Object},
			_tweetsLoading: {type: Boolean},
		};
	}

	_help(message, alert) {
		return html`<span class='help' title="${message}">${alert ? warningIcon : helpIcon}</span>`;
	}

	_tweet(tweet) {
		return html`<li><a href='${urlForTweet(tweet)}' target='_blank'>${prettyTime(tweet.created)}</a> ${favoriteIcon} ${tweet.favorite_count} ${repeatIcon} ${tweet.retweet_count}</li>`;
	}

	stateChanged(state) {
		this._open = state.app.cardInfoPanelOpen;
		this._card = selectActiveCard(state) || {};
		this._sectionTitle = sectionTitle(state, this._card ? this._card.section : '');
		this._author = getAuthorForId(state, this._card.author);
		this._tagInfos = selectTags(state);
		this._inboundLinks = selectInboundLinksForActiveCard(state);
		this._tweets = selectActiveCardTweets(state);
		this._tweetsLoading = selectTweetsLoading(state);
	}

	updated(changedProps) {
		if (changedProps.has('_card') || changedProps.has('_open')) {
			if (this._open && this._card && Object.values(this._card).length != 0) {
				store.dispatch(fetchTweets(this._card));
			}
		}
	}

}

window.customElements.define('card-info-panel', CardInfoPanel);
