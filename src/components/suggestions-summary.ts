
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Suggestion } from '../types.js';
import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

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
		//TODO: use an icon
		//TODO: use a tab-strip
		return html`<label>Suggestions</label>
			${this.suggestions.map(suggestion => html`<label>${suggestion.type}</label>`)}
			`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'suggestions-summary': SuggestionsSummary;
	}
}
