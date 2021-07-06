import { LitElement, html } from '@polymer/lit-element';

import {
	parseMultipleCardIDs,
	combineMultipleCardIDs
} from '../filters.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import './tag-list.js';

// This element is *not* connected to the Redux store.
class ConfigureCollectionMultipleCards extends LitElement {
	render() {
		let cardIDs = parseMultipleCardIDs(this.value);
		return html`
			<style>
				:host {
					display:inline-block;
				}
				div {
					display:flex;
					flex-direction: row;
				}
			</style>
			${ButtonSharedStyles}
			<div>
				<tag-list .overrideTypeName='Card' .tagInfos=${this.cardTagInfos} .tags=${cardIDs} .tapEvents=${true} .editing=${true} .disableSelect=${true} @tag-tapped=${this._handleTagTapped} @new-tag=${this._handleNewTag} @remove-tag=${this._handleRemoveTag}></tag-list>
			</div>
		`;
	}

	_dispatchNewValue(newValue) {
		this.dispatchEvent(new CustomEvent('change-complex', {composed: true, detail: {value: newValue}}));
	}

	_handleRemoveTag(e) {
		const oldValues = parseMultipleCardIDs(this.value);
		this._dispatchNewValue(combineMultipleCardIDs(oldValues.filter(item => item != e.detail.tag)));
	}

	_handleNewTag() {
		const cardID = prompt('What is the ID of the card?');
		if (!cardID) return;
		const oldValues = parseMultipleCardIDs(this.value);
		this._dispatchNewValue(combineMultipleCardIDs([...oldValues, cardID]));
	}

	_handleTagTapped(e) {
		//TODO: pop a dialog
		const cardID = prompt('What is the ID of the card?');
		if (!cardID) return;
		const oldValues = parseMultipleCardIDs(this.value);
		this._dispatchNewValue(combineMultipleCardIDs(oldValues.map(item => item == e.detail.tag ? cardID : item)));
	}

	static get properties() {
		return {
			value: { type: String },
			cardTagInfos: { type: Object},
		};
	}
}

window.customElements.define('configure-collection-multiple-cards', ConfigureCollectionMultipleCards);
