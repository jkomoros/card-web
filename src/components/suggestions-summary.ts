
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Suggestion } from '../types.js';
import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	tagInfosForSuggestions
} from '../suggestions.js';

import './tag-list.js';

@customElement('suggestions-summary')
class SuggestionsSummary extends LitElement {

	@property( { type: Array })
		suggestions : Suggestion[] = [];

	static override styles = [
		SharedStyles,
		ButtonSharedStyles,
		css`
		`
	];

	override render() {
		if (!this.suggestions || this.suggestions.length == 0) return '';

		const tagInfos = tagInfosForSuggestions(this.suggestions);

		const defaultColor = '#006400'; //darkgreen

		//TODO: show that it's loading (signal with a null?)
		//TODO: even when empty render some vertical space (so it doesn't jump on a card with one and without one.)
		return html`
			<tag-list
				.tags=${this.suggestions.map(suggestion => suggestion.type)}
				.defaultColor=${defaultColor}
				.hideOnEmpty=${true}
				.tapEvents=${true}
				.tagInfos=${tagInfos}
			>
			</tag-list>
			`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'suggestions-summary': SuggestionsSummary;
	}
}
