
import { LitElement, html } from '@polymer/lit-element';

import './tag-chip.js';

import {
	arrayDiff, 
	arrayToSet
} from '../util.js';

class TagList  extends LitElement {
	render() {
		let effectiveTags = this.tags;
		let effectivePreviousTags = this.previousTags && this.previousTags.length ? this.previousTags : [];
		let [additionsArray, deletionsArray] = arrayDiff(effectivePreviousTags, effectiveTags);
		let additions = arrayToSet(additionsArray);
		let deletions = arrayToSet(deletionsArray);
		let allTags = [];
		if (effectiveTags && deletionsArray) allTags = [...effectiveTags, ...deletionsArray];
		let tagInfos = this.tagInfos || {};
		return html`
			<style>
				select {
					display:none;
				}
				.editing select {
					display:inline;
				}
			</style>
			<div class='${this.editing ? 'editing' : ''}'>
			${allTags && allTags.length ?
		allTags.map(item => html`<tag-chip .tagName=${item} .tagInfos=${this.tagInfos} .addition=${additions[item]} .deletion=${deletions[item]} .editing=${this.editing}></tag-chip>`) :
		html`<em>No tags</em>`}
			<select @change=${this._handleSelectChanged}>
				<option value='#noop' selected>Add Tag...</option>
				${Object.keys(tagInfos).map(item => html`<option value='${tagInfos[item].id}'>${tagInfos[item].title}</option>`)}
				<option value='#new'>New Tag</option>
			</select>
			</div>
			`;
	}

	_handleSelectChanged(e) {
		let ele = e.composedPath()[0];
		if (ele.value == '#noop') return;
		let value = ele.value;
		//Set it back to #noop.
		ele.value = '#noop';
		if (value == '#new') {
			this.dispatchEvent(new CustomEvent('new-tag', {composed:true}));
			return;
		}
		this.dispatchEvent(new CustomEvent('add-tag', {composed: true, detail:{tag: value}}));
	}

	static get properties() {
		return {
			tags: { type: Array },
			//If set, will be considereed the uncommitted tags, and will have a diff rendered againast them.
			previousTags: {type:Array},
			tagInfos: {type:Object},
			editing: {type:Boolean},
		};
	}
}

window.customElements.define('tag-list', TagList);
