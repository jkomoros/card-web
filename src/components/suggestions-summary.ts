
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Suggestion } from '../types.js';

@customElement('suggestions-summary')
class SuggestionsSummary extends LitElement {

	@property( { type: Array })
		suggestions : Suggestion[] = [];

	static override styles = [
		css`
		`
	];

	override render() {
		if (!this.suggestions || this.suggestions.length == 0) return '';
		//TODO: use an icon
		//TODO: use a tab-strip
		return html`Suggestions:
			${this.suggestions.map(suggestion => html`${suggestion.type}`)};
			`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'suggestions-summary': SuggestionsSummary;
	}
}
