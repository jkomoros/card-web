import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	parseKeyCardID,
	keyCardID
} from '../filters.js';

import {
	findCardToConfigure
} from '../actions/find.js';

import {
	selectFindConfigureRequestID,
	selectFindConfiguredCardID
} from '../selectors.js';

import {
	SEARCH_ICON
} from '../../shared/icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './tag-list.js';

import {
	CardID,
	State,
	TagInfos
} from '../types.js';

import {
	makeFilterModifiedComplexEvent
} from '../events.js';

import {
	newID
} from '../util.js';

//The placeholder a card-valued filter carries before anyone has picked a card.
//An internal identifier, so it never reaches a user (HS-1.4) — it is only ever
//compared against.
const UNSET_CARD_ID = 'key-card-id';

//What the collection means by "whichever card the collection opens on".
const FIRST_CARD_IN_COLLECTION = '_';

@customElement('configure-collection-key-card')
class ConfigureCollectionKeyCard extends connect(store)(LitElement) {

	focusPrimaryControl() {
		this.shadowRoot?.querySelector<HTMLButtonElement>('#choose-card')?.focus();
	}

	@property({ type : String })
		value: string;

	@property({ type : Object })
		cardTagInfos: TagInfos;

	@property({ type : Boolean })
		allowIncludeKeyCard = true;

	//The token this control handed the picker, '' when it is not waiting for an
	//answer. Several key-card controls can be on screen at once — the web focus
	//card, and one per card-valued clause — so the answer is ADDRESSED, and only
	//the control holding the matching token may take it.
	_requestID = '';

	@state()
		_pickerRequestID: string;

	@state()
		_pickedCardID: CardID;

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				display:inline-block;
			}
			div,
			label {
				display:flex;
				flex-direction: row;
				align-items: center;
				gap: 0.4em;
			}
			div {
				flex-wrap: wrap;
			}
			.current {
				max-width: 22em;
			}
		`
	];

	override render() {
		const [cardID, includeKeyCard] = this._valueParts();
		return html`
			<div>
				<span class='current'>${this._currentRender(cardID)}</span>
				<button
					id='choose-card'
					class='small'
					title='Choose card'
					aria-label='Choose card'
					@click=${this._handleChooseCard}
				>${SEARCH_ICON}</button>
				${this._resetRender(cardID)}
				${this.allowIncludeKeyCard ? html`<label><input title='Include key card' type='checkbox' .checked=${includeKeyCard} @change=${this._handleKeyCardChanged}> Include the key card itself</label>` : ''}
			</div>
		`;
	}

	//A card id is an internal identifier and never reaches a user (HS-1.4).
	//tag-list shows a card this account CAN see by its title; everything else is
	//said in words, because the id itself tells the user nothing they can act
	//on, and there is no admin exemption — the rule has no audience clause.
	_currentRender(cardID : CardID) {
		const cardInfos = this.cardTagInfos || {};
		if (cardInfos[cardID]) {
			return html`<tag-list .overrideTypeName=${'Card'} .tagInfos=${cardInfos} .tags=${[cardID]} .disableNew=${true}></tag-list>`;
		}
		if (!this.allowIncludeKeyCard && cardID === FIRST_CARD_IN_COLLECTION) return html`<em>The first card in the collection</em>`;
		if (cardID && cardID !== UNSET_CARD_ID) return html`<em>A card you can’t see</em>`;
		return html`<em>No card chosen yet</em>`;
	}

	//Only the web-focus-card control has a meaningful value OTHER than a
	//specific card, and it used to reach that value through an <option>. A card
	//picker cannot offer it, so it stays reachable as its own control instead of
	//quietly disappearing with the <select>. A verb is clearer than a glyph for
	//a one-off like this (HS-4.2).
	_resetRender(cardID : CardID) {
		if (this.allowIncludeKeyCard) return '';
		if (cardID === FIRST_CARD_IN_COLLECTION) return '';
		return html`<button class='discard' title='Use the first card in the collection' @click=${this._handleUseFirstCard}>Use the first card</button>`;
	}

	_valueParts() : [string, boolean] {
		if (!this.allowIncludeKeyCard) return [this.value || FIRST_CARD_IN_COLLECTION, false];
		const [cardID, includeKeyCard] = parseKeyCardID(this.value);
		return [cardID, includeKeyCard];
	}

	_valueFor(cardID : string, includeKeyCard : boolean) : string {
		return this.allowIncludeKeyCard ? keyCardID(cardID, includeKeyCard) : cardID;
	}

	_dispatchNewValue(newValue : string) {
		this.dispatchEvent(makeFilterModifiedComplexEvent(newValue));
	}

	_handleKeyCardChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLInputElement)) throw new Error('not input ele');
		const [oldCardID] = this._valueParts();
		this._dispatchNewValue(this._valueFor(oldCardID, ele.checked));
	}

	_handleUseFirstCard() {
		const [, includeKeyCard] = this._valueParts();
		this._dispatchNewValue(this._valueFor(FIRST_CARD_IN_COLLECTION, includeKeyCard));
	}

	//HS-5: find-dialog is the primitive for 'pick a card'. The <select> this
	//replaced could only offer cards the app happened to have loaded, in load
	//order, with no search.
	_handleChooseCard() {
		this._requestID = newID();
		store.dispatch(findCardToConfigure(this._requestID));
	}

	//Applied from updated(), not from stateChanged: the new value is reported as
	//an event whose handler dispatches back into the store, and running that
	//inside a store subscriber is re-entrant.
	override updated(changedProps : PropertyValues<this>) {
		if (!changedProps.has('_pickedCardID') && !changedProps.has('_pickerRequestID')) return;
		if (!this._requestID) return;
		if (this._pickerRequestID !== this._requestID) return;
		if (!this._pickedCardID) return;
		//Forget the token BEFORE reporting: the answer stays in state until the
		//next request replaces it, and a later render must not apply it twice.
		this._requestID = '';
		const [, includeKeyCard] = this._valueParts();
		this._dispatchNewValue(this._valueFor(this._pickedCardID, includeKeyCard));
	}

	override stateChanged(state : State) {
		this._pickerRequestID = selectFindConfigureRequestID(state);
		this._pickedCardID = selectFindConfiguredCardID(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-key-card': ConfigureCollectionKeyCard;
	}
}
