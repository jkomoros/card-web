import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { SharedStyles } from './shared-styles.js';
import { ScrollingSharedStyles } from './scrolling-shared-styles.js';

import {
	REPEAT_ICON,
	FAVORITE_ICON,
} from './my-icons.js';

import {
	sectionTitle,
} from '../reducers/data.js';

import { 
	fetchTweets
} from '../actions/data.js';

import {
	TWITTER_HANDLE
} from '../config.GENERATED.SECRET.js';

import {
	selectActiveCard,
	selectTags,
	getAuthorForId,
	selectCollaboratorInfosForActiveCard,
	selectActiveCardTweets,
	selectTweetsLoading,
	selectCommentsAndInfoPanelOpen,
	selectWordCloudForActiveCard,
	selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard
} from '../selectors.js';

import {
	emptyWordCloud
} from '../nlp.js';

import {
	PageViewElement
} from './page-view-element.js';

import {
	prettyTime,
	markdownElement,
	urlForTweet,
} from '../util.js';

import {
	help,
	HelpStyles
} from './help-badges.js';

import './author-chip.js';
import './card-link.js';
import './tag-list.js';
import './word-cloud.js';
import './reference-block.js';
import './limit-warning.js';

import {
	Author,
	ProcessedCard,
	State,
	TagInfos,
	TweetInfo,
	TweetMap,
	WordCloud
} from '../types.js';

import {
	ExpandedReferenceBlocks
} from '../reference_blocks.js';

@customElement('card-info-panel')
class CardInfoPanel extends connect(store)(PageViewElement) {

	@state()
		_open: boolean;

	@state()
		_card: ProcessedCard | null;

	@state()
		_sectionTitle: string;

	@state()
		_author: Author;

	@state()
		_collaborators: Author[];

	@state()
		_tagInfos: TagInfos;

	@state()
		_referenceBlocks: ExpandedReferenceBlocks;

	@state()
		_tweets: TweetMap;

	@state()
		_tweetsLoading: boolean;

	@state()
		_wordCloud: WordCloud;

	@state()
		_expensivePropertiesTimeout: number;

	static override styles = [
		ScrollingSharedStyles,
		HelpStyles,
		SharedStyles,
		css`
			:host {
				flex-grow: 1;
				border-bottom: 1px solid var(--app-divider-color);
				overflow: hidden;
			}

			svg {
				height:1.3em;
				width:1.3em;
				fill: var(--app-dark-text-color-subtle);
			}

			h3 {
				padding: 0.5em 0.5em 0;
			}

			.container {
				width: 13em;
				height:100%;
				padding: 0 0.5em 0.5em 0.5em;
				position:relative;
				color: var(--app-dark-text-color);
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
			.spacer {
				/* Ensure that there's ample space below the scroll. Note: this is likely related to the height of the h3 */
				height: 3em;
				width:100%;
			}
		`
	];

	override render() {
		return html`
			<limit-warning></limit-warning>
			<h3 ?hidden=${!this._open}>Card Info</h3>
			<div class='container scroller' ?hidden=${!this._open}>
				${this._referenceBlocks.map(item => html`<reference-block .block=${item}></reference-block>`)}
				<div>
					<h4>Notes${help('Notes are notes left by the author of the card.')}</h4>
					${this._card && this._card.notes
		? markdownElement(this._card.notes)
		: html `<p><em>No notes for this card</em></p>`
}
				</div>
				${TWITTER_HANDLE ? 
		html`<div>
					<h4>Tweets from <a href='https://twitter.com/${TWITTER_HANDLE}' target='_blank'>@${TWITTER_HANDLE}</a></h4>
					${this._tweets && Object.values(this._tweets).length
		? html`<ul class='${this._tweetsLoading ? 'loading' : ''}'>${Object.entries(this._tweets).map(entry => this._tweet(entry[1]))}</ul>`
		: this._tweetsLoading ? html`<em class='loading'>Loading...</em>` : html`<em>No tweets</em>` 
}
				</div>` : html``}
				<div>
					<h4>Tags</h4>
					<tag-list .card=${this._card} .tags=${this._card?.tags || []} .tagInfos=${this._tagInfos}></tag-list>
				</div>
				<div>
					<h4>Word Cloud</h4>
					<word-cloud .wordCloud=${this._wordCloud}></word-cloud>
				</div>
				<div>
					<h4>Last Updated</h4>
					<p>${prettyTime(this._card?.updated_substantive)}</p>
				</div>
				<div>
					<h4>Name${help('The preferred name for this card, which will show up in the URL when you visit. Must be either the id or one of the slugs')}</h4>
					<p>${this._card?.name}</p>
				</div>
				<div>
					<h4>ID${help('The underlying id of this card, which never changes. Navigating to this name will always come here')}</h4>
					<p>${this._card?.id}</p>
				</div>
				<div>
					<h4>Slugs${help('The alternate names that will navigate to this card.')}</h4>
					${this._card && this._card.slugs && this._card.slugs.length 
		? html`<ul>${this._card.slugs.map((item) => html`<li>${item}</li>`)}</ul>`
		: html`<p><em>No slugs</em></p>`
}
				</div>
				<div>
					<h4>Section${help('The collection that this card lives in.')}</h4>
					<p>${this._sectionTitle}</p>
				</div>
				<div>
					<h4>Created</h4>
					<p>${prettyTime(this._card?.created)}</p>
				</div>
				<div>
					<h4>Author</h4>
					<p><author-chip .author=${this._author}></author-chip></p>
					${this._collaborators && this._collaborators.length ?
		html`<h4>Collaborator${this._collaborators && this._collaborators.length > 1 ? 's' : ''}</h4>
					<p>
					${this._collaborators.map(item => html`<author-chip .author=${item}></author-chip>`)}
					</p>
					`: html``}
				</div>
				<div class='spacer'></div>
			</div>
		`;
	}

	constructor() {
		super();
		//since referenceBlocks will be set a little later, make sure it always has a value.
		this._referenceBlocks = [];
		this._wordCloud = emptyWordCloud();
	}

	_tweet(tweet : TweetInfo) {
		return html`<li><a href='${urlForTweet(tweet)}' target='_blank'>${prettyTime(tweet.created)}</a> ${FAVORITE_ICON} ${tweet.favorite_count} ${REPEAT_ICON} ${tweet.retweet_count}</li>`;
	}

	override stateChanged(state : State) {
		this._open = selectCommentsAndInfoPanelOpen(state);
		this._card = selectActiveCard(state);
		this._sectionTitle = sectionTitle(state, this._card ? this._card.section : '');
		this._author = getAuthorForId(state, this._card?.author || '');
		this._collaborators = selectCollaboratorInfosForActiveCard(state);
		this._tagInfos = selectTags(state);
		this._tweets = selectActiveCardTweets(state);
		this._tweetsLoading = selectTweetsLoading(state);

		//Espeiclaly when a card has been saved for editing, the state is
		//changing quickly. There might be a pending expensie properties timeout
		//that hasn't fired yet that is no longer necessary (it uses an old
		//state, which will break memoization of selectors by selecting old
		//things), so skip it. 
		window.clearTimeout(this._expensivePropertiesTimeout);
		//selectActiveCardSimilarCards is extremly expensive to call into being,
		//so only do it if the user is an admin, and always wait and update
		//without blocking the main update.
		this._expensivePropertiesTimeout = window.setTimeout(() => {
			this._referenceBlocks = this._open ? selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard(state) : [];
			this._wordCloud = this._open ? selectWordCloudForActiveCard(state) : emptyWordCloud();
		}, 0);
		
	}

	override async updated(changedProps : Map<string, CardInfoPanel[keyof CardInfoPanel]>) {
		if (changedProps.has('_card') || changedProps.has('_open')) {
			if (this._open && this._card && Object.values(this._card).length != 0) {
				store.dispatch(fetchTweets(this._card));
			}
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'card-info-panel': CardInfoPanel;
	}
}
