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
} from '../../shared/icons.js';

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
	selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard,
	selectExpandedInfoPanelReferenceBlocksForActiveCard,
	selectIsEditing,
	selectEditingNormalizedCard,
	selectActiveCardEnriched,
	selectCollectionConstructorArguments,
	selectCardIDsUserMayEdit
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
	ExpandedReferenceBlocks,
	expandReferenceBlocksViaRunner,
	infoPanelReferenceBlocksForCard
} from '../reference_blocks.js';

import {
	corpusWorkerCanRunCollections,
	corpusWorkerRunCollection
} from '../corpus-bridge.js';

import {
	corpusWorkerServesCollections
} from '../corpus-mode.js';

import {
	deferredWorkIsOverdue,
	deferredWorkStartedAt
} from '../deferred-work.js';

import {
	sectionRender,
	sectionResultCommits
} from '../section-coherence.js';

//Matches card-view's reference-blocks debounce: long enough that navigation
//keystrokes never pay the whole-corpus reference-block cost.
const EXPENSIVE_PROPERTIES_DEBOUNCE_MS = 250;
//Max-wait: the debounce resets on every state change, so sustained store
//churn could starve it and the panel would never populate. See the same
//guarantee in card-view.ts.
const EXPENSIVE_PROPERTIES_MAX_WAIT_MS = 1000;

//Stable empty values for sectionRender: fresh instances every render would
//churn property identity on the child components for no reason.
const EMPTY_REFERENCE_BLOCKS : ExpandedReferenceBlocks = [];
const EMPTY_WORD_CLOUD = emptyWordCloud();

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
	_expensivePropertiesFirstDeferredAt = 0;
	//Which card the committed blocks/word cloud were computed for ('' =
	//nothing committed yet). Per the section-coherence principle these are NOT
	//cleared on card change: the previous card's value keeps rendering,
	//dimmed as stale, until the first for-this-card result commits — one swap
	//per section per transition, never an empty flash between two real
	//values, never a value keyed to a third card. Separate stamps because the
	//word cloud commits synchronously at the debounce fire while the blocks
	//commit at worker-promise resolution.
	@state()
		_referenceBlocksForCardID = '';

	@state()
		_wordCloudForCardID = '';

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
				/* Match the drawer's 'updating' treatment: ease the dim in so
				   a fast swap doesn't read as a flash. */
				transition: opacity 0.15s ease-in;
			}
			/* The reference-blocks wrapper exists only to carry the stale dim;
			   don't let the generic direct-child margin double-space it. */
			.container > div.blocks {
				margin: 0;
			}
			.spacer {
				/* Ensure that there's ample space below the scroll. Note: this is likely related to the height of the h3 */
				height: 3em;
				width:100%;
			}
		`
	];

	override render() {
		//Per the section-coherence principle, the async-derived sections
		//(reference blocks, word cloud) hold the previous card's committed
		//value — dimmed with the house 'updating' treatment — until their
		//first result FOR the active card commits. Everything else in the
		//rail derives synchronously from the active card and swaps instantly.
		const activeCardID = this._card?.id || '';
		const blocks = sectionRender({forCardID: this._referenceBlocksForCardID, value: this._referenceBlocks}, activeCardID, EMPTY_REFERENCE_BLOCKS);
		const wordCloud = sectionRender({forCardID: this._wordCloudForCardID, value: this._wordCloud}, activeCardID, EMPTY_WORD_CLOUD);
		return html`
			<limit-warning></limit-warning>
			<h3 ?hidden=${!this._open}>Card Info</h3>
			<div class='container scroller' ?hidden=${!this._open}>
				<div class='blocks ${blocks.stale ? 'loading' : ''}'>
					${blocks.value.map(item => html`<reference-block .block=${item}></reference-block>`)}
				</div>
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
				<div class='${wordCloud.stale ? 'loading' : ''}'>
					<h4>Word Cloud</h4>
					<word-cloud .wordCloud=${wordCloud.value}></word-cloud>
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
		if (!this._open) {
			//Reset the max-wait epoch: a stale timestamp would make the first
			//schedule after reopening instantly "overdue" and fire the
			//expensive path right on the open click.
			this._expensivePropertiesFirstDeferredAt = 0;
			this._card = null;
			this._sectionTitle = '';
			this._author = undefined as unknown as Author;
			this._collaborators = [];
			this._tagInfos = {};
			this._tweets = {};
			this._tweetsLoading = false;
			this._referenceBlocks = [];
			this._referenceBlocksForCardID = '';
			this._wordCloud = emptyWordCloud();
			this._wordCloudForCardID = '';
			window.clearTimeout(this._expensivePropertiesTimeout);
			return;
		}
		const previousCardID = this._card?.id || '';
		this._card = selectActiveCard(state);
		const activeCardChanged = previousCardID !== (this._card?.id || '');
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
		//NOTE: blocks/word cloud computed for a DIFFERENT card are deliberately
		//NOT cleared here. render() consults the per-section ownership stamps
		//and shows the previous card's value dimmed as stale (the house
		//'updating' treatment) until the first for-this-card result commits —
		//labeled-stale, one swap per section, instead of the old
		//clear-then-fill's blank flash on every navigation. Wrong-card data
		//can never render undimmed because commits below are gated on the
		//result's card id matching the then-active card.
		//The info-panel reference blocks run several key-card collections over
		//the whole corpus (very expensive at 40k cards), so they must never
		//land between navigation keystrokes: debounce until the user settles,
		//and read FRESH state at fire time (capturing the stateChanged
		//argument would break selector memoization with a stale state).
		//Max-wait guarantee: fire on the next tick if deferrals have piled up
		//past the bound (the debounce resets on EVERY state change and could
		//otherwise be starved by store churn).
		const now = Date.now();
		//A max-wait window belongs to one card. Carrying an already-overdue
		//window across ArrowRight made the first navigation dispatch launch all
		//info-panel collections immediately; their worker replies and cloned ID
		//arrays could then land in one renderer-blocking burst.
		this._expensivePropertiesFirstDeferredAt = deferredWorkStartedAt(
			this._expensivePropertiesFirstDeferredAt,
			now,
			activeCardChanged
		);
		//Only short-circuit when the worker can serve (async): an early fire
		//onto the SYNC 1-2s local fallback is a mid-interaction freeze, and
		//starvation only arises from worker-mode store churn anyway.
		const overdue = deferredWorkIsOverdue(this._expensivePropertiesFirstDeferredAt, now, EXPENSIVE_PROPERTIES_MAX_WAIT_MS) && corpusWorkerCanRunCollections();
		this._expensivePropertiesTimeout = window.setTimeout(() => {
			this._expensivePropertiesFirstDeferredAt = 0;
			const freshState = store.getState() as State;
			if (!this._open) {
				this._referenceBlocks = [];
				this._referenceBlocksForCardID = '';
				this._wordCloud = emptyWordCloud();
				this._wordCloudForCardID = '';
				return;
			}
			//The word cloud computes synchronously from fresh state, so its
			//value and ownership stamp commit as a coherent pair. With no
			//active card there is nothing to commit — hold the previous
			//card's dimmed value rather than flashing empty.
			const freshCardID = selectActiveCard(freshState)?.id || '';
			if (freshCardID) {
				this._wordCloud = selectWordCloudForActiveCard(freshState);
				this._wordCloudForCardID = freshCardID;
			}
			//Prefer computing the blocks in the corpus worker (off the UI
			//thread) when it holds the corpus.
			if (corpusWorkerCanRunCollections()) {
				//While editing, derive the blocks from the live editing card —
				//exactly like card-view's primary blocks — so similar/related
				//content tracks what the user is typing instead of freezing at
				//the card-as-opened. The editing card only changes identity on
				//the 1s normalization debounce, so this adds no per-keystroke
				//work.
				const card = selectIsEditing(freshState)
					? (selectEditingNormalizedCard(freshState) || selectActiveCardEnriched(freshState))
					: selectActiveCardEnriched(freshState);
				const cardID = card ? card.id : '';
				expandReferenceBlocksViaRunner(
					card,
					infoPanelReferenceBlocksForCard(card),
					selectCollectionConstructorArguments(freshState),
					selectCardIDsUserMayEdit(freshState),
					corpusWorkerRunCollection
				).then(blocks => {
					if (blocks === null) {
						if (corpusWorkerServesCollections()) {
							//The run tore down mid-flight but the worker still
							//claims to serve: nothing for this card arrives
							//until it recovers (the live-status Redux update
							//reschedules us). Hold the dimmed previous value —
							//committing an empty here used to clobber a NEWER
							//card's correct blocks and stamp them with this
							//run's stale card id.
							return;
						}
						//Fallback computes from FRESH state — value and
						//ownership stamp form a coherent pair for the fresh
						//card, whatever card this run was launched for.
						const fallbackState = store.getState() as State;
						this._referenceBlocks = selectExpandedInfoPanelReferenceBlocksForActiveCard(fallbackState);
						this._referenceBlocksForCardID = selectActiveCard(fallbackState)?.id || '';
						return;
					}
					//Drop results keyed to any card other than the NOW-active
					//card — a late previous-card result must never render.
					const currentState = store.getState() as State;
					if (!sectionResultCommits(cardID, selectActiveCardEnriched(currentState)?.id || '')) return;
					this._referenceBlocks = blocks;
					this._referenceBlocksForCardID = cardID;
				});
				return;
			}
			//Do not replace a loading worker with a synchronous whole-corpus
			//fallback; hold the previous card's dimmed value (or the empty
			//state when nothing has committed) until the worker is live. A
			//worker circuit-break flips servesCollections() false, preserving
			//recovery.
			if (corpusWorkerServesCollections()) return;
			//While editing, use the active-card variant: the editing-card
			//variant re-runs ~10 whole-corpus collections at every typing
			//pause because the editing card changes per keystroke.
			const blocksSelector = selectIsEditing(freshState) ? selectExpandedInfoPanelReferenceBlocksForActiveCard : selectExpandedInfoPanelReferenceBlocksForEditingOrActiveCard;
			this._referenceBlocks = blocksSelector(freshState);
			this._referenceBlocksForCardID = freshCardID;
		}, overdue ? 0 : EXPENSIVE_PROPERTIES_DEBOUNCE_MS);

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
