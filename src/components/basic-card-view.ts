import { html, css } from 'lit';
import { PageViewElement } from './page-view-element.js';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// These are the shared styles needed by this element.
import { SharedStyles } from './shared-styles.js';

import { 
	selectFetchedCard,
	selectPageExtra,
	selectCardBeingFetched,
	selectCardsLoaded,
} from '../selectors.js';

import { 
	fetchCard, 
	updateFetchedCard
} from '../actions/app.js';

import {
	updateCards,
} from '../actions/data.js';

//We need the implicit import AND the specific class CardStage.
import './card-stage.js';
import {
	CardStage
} from './card-stage.js';

import {
	Card,
	Cards,
	State
} from '../types.js';

//recreated in functions/common.js, and used as a literal immediately below as a
//global declaration
export const WINDOW_CARD_RENDERED_VARIABLE = 'BASIC_CARD_RENDERED';
export const WINDOW_INJECT_FETCHED_CARD_NAME = 'injectFetchedCard';

declare global {
	interface Window {
		BASIC_CARD_RENDERED : boolean;
		injectFetchedCard : (card : Card, cardLinkCards : Cards) => void;
	}
  }

@customElement('basic-card-view')
class BasicCardView extends connect(store)(PageViewElement) {

	@state()
	protected _card: Card;
	
	@state()
	protected _pageExtra: string;

	@state()
	protected _cardBeingFetched: boolean;

	@state()
	protected _cardsLoaded: boolean;

	static override styles = [
		SharedStyles,
		css`
			:host {
				height: 100%;
				width: 100%;
				position:absolute;
			}
			card-stage {
				height: 100%;
				width: 100%;
			}
		`
	];

	override render() {
		return html`
	  <card-stage .card=${this._card} .presenting=${true} .loading=${this._cardBeingFetched || !this._cardsLoaded}></card-stage>
    `;
	}

	override connectedCallback() {
		super.connectedCallback();
		//Expose an override injection point that can be used via puppeteer to
		//inject the data.
		window[WINDOW_INJECT_FETCHED_CARD_NAME] = (card : Card, cardLinkCards : Cards) => {
			//Set the flag down, so we can be used multiple times and still
			//waitFor the flag to raise for multiple screenshots.
			window[WINDOW_CARD_RENDERED_VARIABLE] = false;
			//Do this one first so that the page doesn't have to fetch the card link cards twice
			if (cardLinkCards) store.dispatch(updateCards(cardLinkCards, false));
			store.dispatch(updateFetchedCard(card));
		};
	}

	override stateChanged(state : State) {
		this._card = selectFetchedCard(state);
		this._pageExtra = selectPageExtra(state);
		this._cardBeingFetched = selectCardBeingFetched(state);
		this._cardsLoaded = selectCardsLoaded(state);
	}

	override updated(changedProps : Map<string, BasicCardView[keyof BasicCardView]>) {
		if (changedProps.has('_pageExtra')) {
			store.dispatch(fetchCard(this._pageExtra));
		}
		if ((changedProps.has('_card') || changedProps.has('_cardsLoaded')) && this._card && Object.entries(this._card).length && this._cardsLoaded) {
			//Signal to the top-level page that the card has been loaded.
			//Screenshot service will check for this to know when to take a
			//screenshot.
			this.updateComplete.then(() => {
				const cardStage : CardStage = this.shadowRoot.querySelector('card-stage') as CardStage;
				cardStage.mainCardRenderer.imagesLoaded().then(() => {
					window[WINDOW_CARD_RENDERED_VARIABLE] = true;
				});
			});
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'basic-card-view': BasicCardView;
	}
}