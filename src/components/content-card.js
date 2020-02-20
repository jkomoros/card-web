import { html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

import './card-link.js';

import {
	normalizeBodyToContentEditable,
	normalizeBodyHTML,
	reportSelectionRange
} from '../actions/editor.js';
import { makeElementContentEditable } from '../util.js';

let loadingTemplate = html`<span class='loading'>Loading...<span>`;
let blankTemplate = html`<span class='loading'>Content goes here...</span>`;
let invalidCardTemplate = html`No card by that name, try a link from above`;

// This element is *not* connected to the Redux store.
export class ContentCard extends BaseCard {
	innerRender() {
		return html`
      ${this._makeH1(this.title)}
      ${this._makeSection(this.body)}
    `;
	}

	static get properties() {
		return {
			title: { type: String },
			body: { type: String },
			editing: { type: Boolean },
			id: {type: String},
			fullBleed: {type: String},
			bodyFromContentEditable: {type:Boolean},
			titleFromContentEditable: {type:Boolean},
			dataIsFullyLoaded: {type:Boolean},
			_sectionElement: {type:Object},
			_h1Element: {type:Object},
		};
	}

	_bodyChanged() {
		this.dispatchEvent(new CustomEvent('body-updated', {composed:true, detail: {html: this._sectionElement.innerHTML}}));
	}

	_titleChanged() {
		this.dispatchEvent(new CustomEvent('title-updated', {composed: true, detail: {text: this._h1Element.innerText}}));
	}

	_selectionChanged() {
		let selection = this.shadowRoot.getSelection();
		if (!selection.focusNode) return;
		reportSelectionRange(selection.getRangeAt(0));
	}

	get _emptyTemplate() {
		if (this.id) return blankTemplate;
		return  this.dataIsFullyLoaded ? invalidCardTemplate: loadingTemplate;
	}

	firstUpdated(changedProps) {
		super.firstUpdated(changedProps);
		document.addEventListener('selectionchange', this._selectionChanged.bind(this));
	}

	_makeH1(title) {
		if (this.titleFromContentEditable && this._h1Element) {
			return this._h1Element;
		}
		let htmlToSet = '';
		if (!title) {
			if (this.fullBleed) {
				title = '';
			} else {
				if (this.id) {
					htmlToSet = '<span class=\'loading\'>Content goes here...</span>';
				} else if (this.dataIsFullyLoaded) {
					htmlToSet = 'No card by that name, try a link from above.';
				} else {
					htmlToSet = '<span class=\'loading\'>Loading...<span>';
				}
			}
		}
		const h1 = document.createElement('h1');
		this._h1Element = h1;
		if (this.editing) {
			h1.contentEditable = 'true';
			h1.addEventListener('input', this._titleChanged.bind(this));
		}
		//Only set innerHTML if it came from this method; title is untrusted.
		if (htmlToSet) {
			h1.innerHTML = htmlToSet;
		} else {
			h1.innerText = title;
		}
		return h1;
	}

	_makeSection(body) {
		//If the update to body came from contentEditable then don't change it,
		//the state is already in it. If we were to update it, the selection state
		//would reset and defocus.
		if (this.bodyFromContentEditable && this._sectionElement) {
			return this._sectionElement;
		}
		//If we're editing, then just put in blank content so someone tapping on
		//it immediately will be able to start writing content without selecting
		//the content textfield.
		if (!body && !this.editing) {
			return this._emptyTemplate;
		}
		const section = document.createElement('section');
		this._sectionElement = section;
		body = normalizeBodyHTML(body);
		if (this.editing) {
			makeElementContentEditable(section);
			section.addEventListener('input', this._bodyChanged.bind(this));
			body = normalizeBodyToContentEditable(body);
		}
		section.innerHTML = body;
		if(this.fullBleed) section.className = 'full-bleed';
		return section;
	}

	updated(changedProps) {
		if (changedProps.has('editing') && this.editing) {
			//If we just started editing, focus the content editable immediately
			if (this._sectionElement) {
				this._sectionElement.focus();

				//Move the selection to the end of the content editable.
				let range = document.createRange();
				range.selectNodeContents(this._sectionElement);
				range.collapse(false);
				let sel = window.getSelection();
				sel.removeAllRanges();
				sel.addRange(range);
			}
		}
	}
}

window.customElements.define('content-card', ContentCard);
