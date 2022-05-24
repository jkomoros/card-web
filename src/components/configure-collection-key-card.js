import { LitElement, html, css } from 'lit';

import {
	EDIT_ICON
} from './my-icons.js';

import {
	parseKeyCardID,
	keyCardID
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './tag-list.js';

// This element is *not* connected to the Redux store.
class ConfigureCollectionKeyCard extends LitElement {

	static get styles() {
		return [
			css`
				:host {
					display:inline-block;
				}
				div {
					display:flex;
					flex-direction: row;
				}
			`
		];
	}

	render() {
		let [cardID, includeKeyCard] = parseKeyCardID(this.value);
		return html`
			${ButtonSharedStyles}
			<div>
				<input title='Include key card' type='checkbox' .checked=${includeKeyCard} @change=${this._handleKeyCardChanged}>
				<tag-list .tagInfos=${this.cardTagInfos} .tags=${cardID ? [cardID] : []} .tapEvents=${true}></tag-list><button class='small' @click=${this._handleEditClicked}>${EDIT_ICON}</button>
			</div>
		`;
	}

	_dispatchNewValue(newValue) {
		this.dispatchEvent(new CustomEvent('change-complex', {composed: true, detail: {value: newValue}}));
	}

	_handleKeyCardChanged(e) {
		const ele = e.composedPath()[0];
		const [oldCardID] = parseKeyCardID(this.value);
		this._dispatchNewValue(keyCardID(oldCardID, ele.checked));
	}

	_handleEditClicked() {
		//TODO: pop a dialog
		const cardID = prompt('What is the ID of the card?');
		const [, includeKeyCard] = parseKeyCardID(this.value);
		this._dispatchNewValue(keyCardID(cardID, includeKeyCard));
	}

	static get properties() {
		return {
			value: { type: String },
			cardTagInfos: { type: Object},
		};
	}
}

window.customElements.define('configure-collection-key-card', ConfigureCollectionKeyCard);
