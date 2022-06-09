
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { StyleInfo, styleMap } from 'lit/directives/style-map.js';

import {
	urlForTag
} from '../actions/app.js';

import {
	makeTagTappedEvent,
	makeTagAddedEvent
} from '../events.js';

import {
	Card,
	CSSColorString,
	TagInfos
} from '../types.js';

@customElement('tag-chip')
class TagChip  extends LitElement {

	@property({ type : Boolean })
	addition: boolean;

	@property({ type : Boolean })
	deletion: boolean;

	//TODO: maybe we should rename this so it doesn't overlap with LitElement.tagName?
	@property({ type : String })
	override tagName: string;

	@property({ type : Boolean })
	editing: boolean;

	@property({ type : Object })
	tagInfos: TagInfos;

	@property({ type : Boolean })
	tapEvents: boolean;

	@property({ type : Boolean })
	subtle: boolean;

	@property({ type : Boolean })
	disabled: boolean;

	//If the tag is disabled, what should the description be?
	@property({ type : String })
	disabledDescription: string;

	//If set, will use this defualt color if the tag doesn't have one
	//defined. Should be of the form "#AABBCC" or some other literal
	//color value;
	@property({ type : String })
	defaultColor: CSSColorString;

	@property({ type : Object })
	card: Card;

	static override styles = [
		css`
			:host {
				margin: 0 0.2em;
				display: inline-block;
				color: var(--app-light-text-color);
				font-weight:bold;
			}
			span {
				padding: 0.2em;
				border-radius: 0.3em;
				font-size: 0.7em;
				transition: filter 0.1s ease-in-out;
			}
			span.enabled:hover {
				/* !important necessary to reach up and override the styles setting directly on element */
				filter:none !important;
			}
			a.primary {
				color: var(--app-light-text-color);
				text-decoration:none;
			}
			span.editing a.primary {
				/* We'll cancel navigation, so don't make it look clikable */
				cursor:default;
			}
			span.deletion {
				font-style: italic;
				text-decoration-line:line-through;
			}
			span.addition {
				font-style:italic;
			}
			span a.delete {
				display:none;
				color: var(--app-light-text-color);
				padding: 0 0.3em;
			}
			span.enabled.editing a.delete {
				display:inline;
			}
		`
	];

	override render() {
		const styles : StyleInfo = {
			backgroundColor: this._color,
		};
		if (this._filter) styles.filter = this._filter;
		return html`
			<span style=${styleMap(styles)} class='${this.editing ? 'editing' : ''} ${this.addition ? 'addition' : ''} ${this.deletion ? 'deletion' : ''} ${this._disabled ? 'disabled' : 'enabled'}' title='${this._description}' @mousemove=${this._handleMouseMove}><a class='primary' href='${this._url}' @click=${this._handleTagClicked}>${this._displayName}</a><a class='delete' href='#' @click=${this._handleXClicked}>X</a></span>
			`;
	}

	_handleMouseMove(e) {
		if (!this._previewCard) return;
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		e.stopPropagation();
		//card-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: this._previewCard, x: e.clientX, y: e.clientY}}));
	}

	_handleTagClicked(e) {
		if (this._disabled) {
			e.preventDefault();
			return;
		}
		if (this.tapEvents) {
			e.preventDefault();
			this.dispatchEvent(makeTagTappedEvent(this.tagName, this.subtle));
			return;
		}
		if (this.editing) {
			e.preventDefault();
			return;
		}
		//There's no good way to remove the href if suppressLink is true, so if
		//we don't also prevent default here we'd navigate to `/`.
		if (this._suppressLink) {
			e.preventDefault();
			return;
		}
		//Allow it go on and navigate
	}

	_handleXClicked(e) {
		if (this._disabled) return false;
		e.preventDefault();
		if (this.deletion) {
			//In this (special) case, the user has removed us previously and so
			//now clicking again should UN-delete us, by firing an add-tag.
			this.dispatchEvent(makeTagAddedEvent(this.tagName));
		} else {
			//the dfeault case, this will fire a remove-tag
			this.dispatchEvent(new CustomEvent('remove-tag', {composed: true, detail: {tag: this.tagName}}));
		}
		
		return false;
	}

	get _effectiveDefaultColor() {
		return this.defaultColor || '#CD5C5C';
	}

	get _previewCard() {
		if (this.tagInfos) {
			const info = this.tagInfos[this.tagName];
			if (info && info.previewCard) return info.previewCard;
		}
		return '';
	}

	get _suppressLink() {
		if (this.tagInfos) {
			const info = this.tagInfos[this.tagName];
			if (info && info.suppressLink) return true;
		}
		return false;
	}

	get _url() {
		return this._suppressLink || this._disabled ? '' : urlForTag(this.tagName, this._cardName);
	}

	get _subtle() {
		if (this.subtle) return true;
		if (!this.tagInfos) return false;
		let info = this.tagInfos[this.tagName];
		if (!info) return false;
		return info.subtle || false;
	}

	get _color() {
		const defaultColor = this._effectiveDefaultColor;
		if (!this.tagInfos) return defaultColor;
		let info = this.tagInfos[this.tagName];
		if (!info) return defaultColor;
		return info.color || defaultColor;
	}

	get _filter() {
		if (this._subtle || this._disabled) return 'grayscale(80%) opacity(40%)';
		if (!this.tagInfos) return '';
		let info = this.tagInfos[this.tagName];
		if (!info) return '';
		return info.filter || '';
	}

	get _disabled() {
		if (this.disabled) return true;
		if (!this.tagInfos) return false;
		let info = this.tagInfos[this.tagName];
		if (!info) return false;
		return info.disabled || false;
	}

	get _displayName() {
		if (!this.tagInfos) return this.tagName;
		let info = this.tagInfos[this.tagName];
		if (!info) return this.tagName;
		return info.title || this.tagName;
	}

	get _description() {
		if (this._disabled && this.disabledDescription) return this.disabledDescription;
		if (!this.tagInfos) return this.tagName;
		let info = this.tagInfos[this.tagName];
		if (!info) return this.tagName;
		return info.description || this.tagName;
	}

	get _cardName() {
		if (!this.card) return '';
		return this.card.name;
	}

}

declare global {
	interface HTMLElementTagNameMap {
	  'tag-chip': TagChip;
	}
}
