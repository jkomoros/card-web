import { html, LitElement } from '@polymer/lit-element';

import {
	help,
	HelpStyles
} from './help-badges.js';

import './card-link.js';

export class ReferenceBlock extends LitElement {
	render() {
		if (this._shouldHide()) return html``;
		return html`
			<!-- isn't this expensive to repeat for every reference block? -->
			${HelpStyles}
			<style>
				:host {
					color: var(--app-dark-text-color);
				}
				h4 {
					font-size:0.7em;
					font-weight:normal;
					margin:0;
				}
			</style>
			<h4>${this.block.title}${this.block.description ? help(this.block.description) : ''}</h4>
			${this.block.collection.filteredCards.length
		? html`<ul>${this.block.collection.filteredCards((item) => html`<li><card-link auto='title' card='${item}'>${item}</card-link></li>`)}</ul>`
		: html`<p><em>${this.block.emptyMessage}</em></p>`
}
			</div>
	`;
	}

	_shouldHide() {
		return !this.block || (this.block.collection.filteredCards.length == 0 && !this.block.emptyMessage);
	}

	static get properties() {
		return {
			//expandedBlock, as returned from e.g. getExpandedReferenceBlocksForCard
			block: {type:Object},
		};
	}

}

window.customElements.define('reference-block', ReferenceBlock);
