
import { LitElement, html } from '@polymer/lit-element';

import './tag-chip.js';

import {
	arrayDiffAsSets
} from '../util.js';

class TagList  extends LitElement {
	render() {
		let effectiveTags = this.tags;
		let effectivePreviousTags = this.previousTags && this.previousTags.length ? this.previousTags : this.tags;
		let [additions, deletions] = arrayDiffAsSets(effectiveTags, effectivePreviousTags);
		return html`
			<div>
			${this.tags && this.tags.length ?
		this.tags.map(item => html`<tag-chip .tag=${item} .addition=${additions[item]} .deletion=${deletions[item]} .editing=${this.editing}></tag-chip>`) :
		html`<em>No tags</em>`}
			</div>
			`;
	}

	static get properties() {
		return {
			tags: { type: Array },
			//If set, will be considereed the uncommitted tags, and will have a diff rendered againast them.
			previousTags: {type:Array},
			editing: {type:Boolean},
		};
	}
}

window.customElements.define('tag-list', TagList);
