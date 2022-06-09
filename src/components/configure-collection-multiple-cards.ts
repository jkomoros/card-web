import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	TagEvent
} from '../events.js';

import {
	parseMultipleCardIDs,
	combineMultipleCardIDs
} from '../filters.js';

import {
	TagInfos
} from '../types.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './tag-list.js';

@customElement('configure-collection-multiple-cards')
class ConfigureCollectionMultipleCards extends LitElement {

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
		let cardIDs = parseMultipleCardIDs(this.value);
		return html`
			<div>
				<tag-list .overrideTypeName=${'Card'} .tagInfos=${this.cardTagInfos} .tags=${cardIDs} .tapEvents=${true} .editing=${true} .disableSelect=${true} @tag-tapped=${this._handleTagTapped} @new-tag=${this._handleNewTag} @remove-tag=${this._handleRemoveTag}></tag-list>
			</div>
		`;
	}

	_dispatchNewValue(newValue) {
		this.dispatchEvent(new CustomEvent('change-complex', {composed: true, detail: {value: newValue}}));
	}

	_handleRemoveTag(e) {
		const oldValues = parseMultipleCardIDs(this.value);
		if (oldValues.length < 2) {
			console.warn('You must include at least one card');
			return;
		}
		this._dispatchNewValue(combineMultipleCardIDs(oldValues.filter(item => item != e.detail.tag)));
	}

	_handleNewTag() {
		const cardID = prompt('What is the ID of the card?');
		if (!cardID) return;
		const oldValues = parseMultipleCardIDs(this.value);
		this._dispatchNewValue(combineMultipleCardIDs([...oldValues, cardID]));
	}

	_handleTagTapped(e : TagEvent) {
		//TODO: pop a dialog
		const cardID = prompt('What is the ID of the card?');
		if (!cardID) return;
		const oldValues = parseMultipleCardIDs(this.value);
		this._dispatchNewValue(combineMultipleCardIDs(oldValues.map(item => item == e.detail.tag ? cardID : item)));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-multiple-cards': ConfigureCollectionMultipleCards;
	}
}
