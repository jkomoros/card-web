import { html, LitElement, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	help,
	HelpStyles
} from './help-badges.js';

import {
	urlForCollection
} from '../actions/app.js';

import {
	OPEN_IN_BROWSER_ICON,
} from './my-icons.js';

import './card-link.js';
import { ExpandedReferenceBlock } from '../reference_blocks.js';

@customElement('reference-block')
export class ReferenceBlock extends LitElement {

	//expandedBlock, as returned from e.g. getExpandedReferenceBlocksForCard
	@property({ type : Object })
		block: ExpandedReferenceBlock;

	static override styles = [
		//isn't this expensive to repeat for every reference block?
		HelpStyles,
		css`
			:host {
				color: var(--app-dark-text-color);
			}

			h4 {
				font-size:0.7em;
				font-weight:normal;
				margin:0;
			}

			ul {
				margin:0;
				padding-inline-start: 1.2em;
			}

			p {
				margin: 0;
			}

			.editor {
				opacity: 0.5;
			}

			.condensed {
				line-height: 1.0em;
			}

			.inline, .inline ul {
				display: flex;
				flex-direction: row;
				align-items: center;
			}

			.inline ul {
				padding-inline-start: 0.5em;
				list-style-type: none;
			}

			.inline li {
				margin-right: 0.5em;
			}

			.condensed card-link {
				font-size: 0.7em;
			}
		`
	];

	override render() {

		const inline = this.block.inline || this.block.condensed || false;

		if (this._shouldHide()) return html``;
		return html`
			<div class='${this.block.onlyForEditors ? 'editor' :''} ${this.block.condensed ? 'condensed' : ''} ${inline ? 'inline' : ''}'>
			<h4>
				${this.block.title}
				${this.block.description ? help(this.block.description) : ''}
				${this.block.showPreview && this.block.collection.preview ? help(this.block.showPreview, true) : ''}
				${this.block.showNavigate ? html`<a title='Navigate to this collection' href=${urlForCollection(this.block.navigationCollectionDescription || this.block.collectionDescription)} class='help'>${OPEN_IN_BROWSER_ICON}</a>` : ''}
			</h4>
			${this.block.collection.filteredCards.length
		? html`<ul>${this.block.collection.filteredCards.map((card) => html`<li><card-link auto='title' card='${card.id}' .strong=${this.block.boldCards[card.id]} .subtle=${this.block.subtle || false}>${card.id}</card-link></li>`)}</ul>`
		: html`<p><em>${this.block.emptyMessage}</em></p>`
}
			</div>
	`;
	}

	_shouldHide() {
		return !this.block || (this.block.collection.filteredCards.length == 0 && !this.block.emptyMessage);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'reference-block': ReferenceBlock;
	}
}
