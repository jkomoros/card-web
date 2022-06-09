import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	EDIT_ICON
} from './my-icons.js';

import {
	parseKeyCardID,
	keyCardID
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './tag-list.js';

import {
	TagInfos
} from '../types.js';

import {
	makeFilterModifiedComplexEvent
} from '../events.js';

@customElement('configure-collection-key-card')
class ConfigureCollectionKeyCard extends LitElement {

	@property({ type : String })
	value: string;

	@property({ type : Object })
	cardTagInfos: TagInfos;

	static override styles = [
		ButtonSharedStyles,
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

	override render() {
		let [cardID, includeKeyCard] = parseKeyCardID(this.value);
		return html`
			<div>
				<input title='Include key card' type='checkbox' .checked=${includeKeyCard} @change=${this._handleKeyCardChanged}>
				<tag-list .tagInfos=${this.cardTagInfos} .tags=${cardID ? [cardID] : []} .tapEvents=${true}></tag-list><button class='small' @click=${this._handleEditClicked}>${EDIT_ICON}</button>
			</div>
		`;
	}

	_dispatchNewValue(newValue) {
		this.dispatchEvent(makeFilterModifiedComplexEvent(newValue));
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

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-key-card': ConfigureCollectionKeyCard;
	}
}
