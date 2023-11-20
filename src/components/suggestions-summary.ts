
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Suggestion } from '../types.js';
import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import './tag-list.js';
import { SUGGESTORS } from '../suggestions.js';

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

		const defaultColor = '#006400'; //darkgreen

		//TODO: use an icon
		//TODO: show that it's loading (signal with a null?)
		//TODO: even when empty render some vertical space (so it doesn't jump on a card with one and without one.)
		//TODO: when clicking a suggestion show suggestion-viewer
		return html`
			<tag-list
				.tags=${this.suggestions.map(suggestion => suggestion.type)}
				.defaultColor=${defaultColor}
				.hideOnEmpty=${true}
				.tapEvents=${true}
				.tagInfos=${SUGGESTORS}
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
