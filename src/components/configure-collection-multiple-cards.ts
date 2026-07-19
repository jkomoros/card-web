import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	makeFilterModifiedComplexEvent,
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

	focusPrimaryControl() {
		const tagList = this.shadowRoot?.querySelector('tag-list');
		const control = tagList?.shadowRoot?.querySelector<HTMLElement>('input, button, [tabindex="0"]');
		(control || tagList)?.focus();
	}

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
		const cardIDs = parseMultipleCardIDs(this.value);
		return html`
			<div>
				<tag-list .overrideTypeName=${'Card'} .tagInfos=${this.cardTagInfos} .tags=${cardIDs} .editing=${true} .disableNew=${true} @tag-added=${this._handleAddTag} @tag-removed=${this._handleRemoveTag}></tag-list>
			</div>
		`;
	}

	_dispatchNewValue(newValue : string) {
		this.dispatchEvent(makeFilterModifiedComplexEvent(newValue));
	}

	_handleRemoveTag(e : TagEvent) {
		const oldValues = parseMultipleCardIDs(this.value);
		if (oldValues.length < 2) {
			console.warn('You must include at least one card');
			return;
		}
		this._dispatchNewValue(combineMultipleCardIDs(oldValues.filter(item => item != e.detail.tag)));
	}

	_handleAddTag(e : TagEvent) {
		const oldValues = parseMultipleCardIDs(this.value);
		this._dispatchNewValue(combineMultipleCardIDs([...oldValues, e.detail.tag]));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'configure-collection-multiple-cards': ConfigureCollectionMultipleCards;
	}
}
