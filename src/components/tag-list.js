
import { LitElement, html, css } from 'lit';

import './tag-chip.js';

import {
	PLUS_ICON
} from './my-icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	arrayDiff, 
	arrayToSet
} from '../util.js';

class TagList  extends LitElement {
	
	static get styles() {
		return [
			css`
				select {
					display:none;
				}
				.editing select {
					display:inline;
				}
			`
		];
	}
	
	render() {
		let effectiveTags = this.tags || [];
		let effectivePreviousTags = this.previousTags ? (this.previousTags.length ? this.previousTags : []) : effectiveTags;
		let [additionsArray, deletionsArray] = arrayDiff(effectivePreviousTags, effectiveTags);
		let additions = arrayToSet(additionsArray);
		let deletions = arrayToSet(deletionsArray);
		let allTags = [];
		if (effectiveTags && deletionsArray) allTags = [...effectiveTags, ...deletionsArray];
		let tagInfos = this.tagInfos || {};
		let excludeItemsAsMap = Object.fromEntries(effectiveTags.map(item => [item, true]));
		let effectiveExcludeItems = this.excludeItems || [];
		effectiveExcludeItems.forEach(item => excludeItemsAsMap[item] = true);
		tagInfos = Object.fromEntries(Object.entries(tagInfos).filter(entry => !excludeItemsAsMap[entry[0]]));
		return html`
		${ButtonSharedStyles}
			<div class='${this.editing ? 'editing' : ''} ${this.subtle ? 'subtle' :''}'>
			${allTags && allTags.length ?
		allTags.map(item => html`<tag-chip .card=${this.card} .tagName=${item} .tagInfos=${this.tagInfos} .addition=${additions[item]} .deletion=${deletions[item]} .editing=${this.editing} .defaultColor=${this.defaultColor} .disabled=${this.disableTagIfMissingTagInfo && this.tagInfos && !this.tagInfos[item]} .disabledDescription=${this.disabledDescription || 'Disabled'} .tapEvents=${this.tapEvents} .subtle=${this.subtle || (this.subtleTags && this.subtleTags[item])}></tag-chip>`) :
		(this.hideOnEmpty ? html`` : html`<em>No ${this.typeName.toLowerCase()}s</em>`)}
			${((!allTags || !allTags.length) && this.hideOnEmpty) || this.disableAdd ? html`` :
		(this.disableSelect ? html`<button class='small' @click=${this._handleNew} title=${'New ' + this.typeName}>${PLUS_ICON}</button>` :
			html`<select @change=${this._handleSelectChanged}>
				<option value='#noop' selected>Add ${this.typeName}...</option>
				${Object.keys(tagInfos).map(item => html`<option value='${tagInfos[item].id}' title=${tagInfos[item].description}>${tagInfos[item].title}</option>`)}
				${this.disableNew ? '' : html`<option value='#new'>New ${this.typeName}</option>`}
			</select>`)}
			</div>
			`;
	}

	_handleNew() {
		this.dispatchEvent(new CustomEvent('new-tag', {composed:true}));
	}

	_handleSelectChanged(e) {
		let ele = e.composedPath()[0];
		if (ele.value == '#noop') return;
		let value = ele.value;
		//Set it back to #noop.
		ele.value = '#noop';
		if (value == '#new') {
			if (this.disableNew) {
				console.warn('New tag selected evey though it was supposed to be disabled');
				return;
			}
			this._handleNew();
			return;
		}
		//Note: a similar event is fired in tag-chip when editing and hitting
		//the x and deletion is true.
		this.dispatchEvent(new CustomEvent('add-tag', {composed: true, detail:{tag: value}}));
	}

	get typeName() {
		return this.overrideTypeName || 'Tag';
	}

	static get properties() {
		return {
			tags: { type: Array },
			//If set, will be considereed the uncommitted tags, and will have a diff rendered against them.
			previousTags: {type:Array},
			//if this list has any items, those items will be omitted from the
			//select drop down even if they're in tagInfos and not yet in the
			//tags list.
			excludeItems: { type:Array },
			//tagInfos is a map that includes objects, with an id property, a
			//title property, and optionally a color and cardPreview property.
			//Typically it's just the result of selectTags, but if the tag-list
			//is displaying other things then it could be any kinds of objects.
			tagInfos: {type:Object},
			editing: {type:Boolean},
			//if true, instead of navigating, will emit a 'tag-tapped' event
			tapEvents: {type:Boolean},
			//Subtle coloring for all items
			subtle: {type:Boolean},
			//Will flag the tags in this map as subtle individually
			subtleTags: {type:Object},
			//if true and empty then don't show any
			hideOnEmpty: {type:Boolean},
			//If set, typeName will be used in the UI to describe the types of things the tags represent, e.g. "New FOO". If not set, will default to "Tag".
			overrideTypeName: {type:String},
			//If true, then any tagName that doesn't also exist in tagInfo will be set to disabled
			disableTagIfMissingTagInfo: {type:Boolean},
			//Passed through to tag-chip.disabledDescription
			disabledDescription: {type:String},
			//If true, then the select option to add a new tag will not be shown.
			disableNew: {type:Boolean},
			//If true, then the select drop down of existing items won't be
			//shown, rendering a button instead.
			disableSelect: {type:Boolean},
			//If true, then even if editing, the select to add a new item will
			//not be shown, so only deletion will be possible.
			disableAdd: {type:Boolean},
			//Will be passed on to the tag-chips, which will provide the color
			//if the tag itself doesn't have one specified in the tagInfos.
			defaultColor: {type:String},
			card: {type:Object},
		};
	}
}

window.customElements.define('tag-list', TagList);
