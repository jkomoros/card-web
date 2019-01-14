
import { LitElement, html } from '@polymer/lit-element';

class TagChip  extends LitElement {
	render() {
		return html`
			<style>
				:host {
					background-color:blue;
					border-radius:0.1em;
					color:var(--app-light-text-color);
				}
			</style>
			<span>${this.tagName}</span>
			`;
	}

	static get properties() {
		return {
			tagName: { type: String },
		};
	}
}

window.customElements.define('tag-chip', TagChip);
