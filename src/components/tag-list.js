
import { LitElement, html } from '@polymer/lit-element';

import './tag-chip.js';

class TagList  extends LitElement {
	render() {
		return html`
			<style>
				:host {
					background-color:blue;
					border-radius:0.1em;
					color:var(--app-light-text-color);
				}
			</style>
			<div>
				${this.tags.map(item => html`<tag-chip .tag=${item}></tag-chip>`)}
			</div>
			`;
	}

	static get properties() {
		return {
			tags: { type: Array },
		};
	}
}

window.customElements.define('tag-list', TagList);
