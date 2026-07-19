import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	parseKeyCardID,
	keyCardID
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	TagInfos
} from '../types.js';

import {
	makeFilterModifiedComplexEvent
} from '../events.js';

@customElement('configure-collection-key-card')
class ConfigureCollectionKeyCard extends LitElement {

	focusPrimaryControl() {
		this.shadowRoot?.querySelector<HTMLSelectElement>('select')?.focus();
	}

	@property({ type : String })
		value: string;

	@property({ type : Object })
		cardTagInfos: TagInfos;

	@property({ type : Boolean })
		allowIncludeKeyCard = true;

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
			select {
				max-width: 22em;
			}
		`
	];

	override render() {
		const [cardID, includeKeyCard] = this._valueParts();
		const cardInfos = this.cardTagInfos || {};
		const currentIsKnown = Boolean(cardInfos[cardID]);
		return html`
			<div>
				<select aria-label='Key card' .value=${cardID} @change=${this._handleCardChanged}>
					${this.allowIncludeKeyCard ? '' : html`<option value='_'>First card in the collection</option>`}
					${currentIsKnown || (!this.allowIncludeKeyCard && cardID === '_') ? '' : html`<option .value=${cardID}>${cardID && cardID !== 'key-card-id' ? `Unavailable card (${cardID})` : 'Choose a card…'}</option>`}
					${Object.values(cardInfos).map(info => html`<option .value=${info.id}>${info.title}</option>`)}
				</select>
				${this.allowIncludeKeyCard ? html`<label><input title='Include key card' type='checkbox' .checked=${includeKeyCard} @change=${this._handleKeyCardChanged}> Include the key card itself</label>` : ''}
			</div>
		`;
	}

	_valueParts() : [string, boolean] {
		if (!this.allowIncludeKeyCard) return [this.value || '_', false];
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

	_handleCardChanged(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		const [, includeKeyCard] = this._valueParts();
		this._dispatchNewValue(this._valueFor(ele.value, includeKeyCard));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-key-card': ConfigureCollectionKeyCard;
	}
}
