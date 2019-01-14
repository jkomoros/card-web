
import { LitElement, html } from '@polymer/lit-element';

import './tag-chip.js';

class TagList  extends LitElement {
	render() {
		return html`
			<div>
			${this.tags && this.tags.length
				? this.tags.map(item => html`<tag-chip .tag=${item}></tag-chip>`)
				: html`<em>No tags</em>`
			}
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
