import { html } from '@polymer/lit-element';

import {BaseCard} from './base-card.js';

import './card-link.js';

import dompurify from 'dompurify';

import {
	reportSelectionRange
} from '../actions/editor.js';

import {
	normalizeBodyHTML,
	normalizeBodyToContentEditable
} from '../contenteditable.js';

import {
	TEXT_FIELD_BODY,
	TEXT_FIELD_TITLE,
	TEXT_FIELD_CONFIGURATION
} from '../card_fields.js';

import { makeElementContentEditable } from '../util.js';

// This element is *not* connected to the Redux store.
export class ContentCard extends BaseCard {
	innerRender() {
		return html`
      ${this._templateForField(TEXT_FIELD_TITLE)}
      ${this._templateForField(TEXT_FIELD_BODY)}
    `;
	}

	static get properties() {
		return {
			title: { type: String },
			body: { type: String },
			editing: { type: Boolean },
			id: {type: String},
			fullBleed: {type: String},
			updatedFromContentEditable: {type:Object},
			dataIsFullyLoaded: {type:Boolean},
			_elements: {type: Object},
		};
	}

	constructor() {
		super();
		this._elements = {};
	}

	_textFieldChanged(e) {
		let ele = e.composedPath()[0];
		const field = ele.field;
		const config = TEXT_FIELD_CONFIGURATION[field] || {};
		const value = config.html ? ele.innerHTML : ele.innerText;
		this.dispatchEvent(new CustomEvent('text-field-updated', {composed:true, detail: {field: field, value: value}}));
	}

	_selectionChanged() {
		let selection = this.shadowRoot.getSelection();
		if (!selection.focusNode) return;
		reportSelectionRange(selection.getRangeAt(0));
	}

	firstUpdated(changedProps) {
		super.firstUpdated(changedProps);
		document.addEventListener('selectionchange', this._selectionChanged.bind(this));
	}

	_templateForField(field) {
		const config = TEXT_FIELD_CONFIGURATION[field] || {};

		//If the update to body came from contentEditable then don't change it,
		//the state is already in it. If we were to update it, the selection state
		//would reset and defocus.
		const updatedFromContentEditable = (this.updatedFromContentEditable || {})[field];
		if (updatedFromContentEditable && this._elements[field]) {
			return this._elements[field];
		}

		let value = this[field];
		let htmlToSet = config.html ? normalizeBodyHTML(value) : '';
		if (!value && !this.editing) {
			if (this.fullBleed) {
				value = '';
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

		const ele = document.createElement(config.container|| 'span');
		this._elements[field] = ele;
		ele.field = field;
		if (this.editing) {
			makeElementContentEditable(ele);
			ele.addEventListener('input', this._textFieldChanged.bind(this));
			if (config.html) htmlToSet = normalizeBodyToContentEditable(htmlToSet);
		}

		if (config.html) {
			htmlToSet = dompurify.sanitize(htmlToSet, {
				ADD_ATTR: ['card'],
				ADD_TAGS: ['card-link'],
			});
			if (htmlToSet === '') {
				//This is a total hack. If the body is empty, then contenteditable
				//will have the first line of content in an anoymous top-level node,
				//even though makeElementContentEditable configures it to use <p>
				//for top-level elements, and even though the textarea will show the
				//first line of wrapped in <p>'s because that's what it's normalized
				//to but can't be reinjected into the contenteditable. If you then
				//link to anything in that first line, then it will put a <p> before
				//and after it for the rest of the content. If we just input
				//`<p></p>` as starter content then Chrome's contenteditable
				//wouldn't allow it to be focused. The answer is to inject a <p> so
				//that the first line has the right content, and include a
				//non-removable whitespace. Then, in the logic below in update(),
				//special case delete that content, leaving us with a content
				//editable that's selected, with the cursor starting out inside of
				//paragraph tags.
				htmlToSet = '<p>&nbsp;</p>';
			}
		}

		//Only set innerHTML if it came from this method; title is untrusted.
		if (htmlToSet) {
			ele.innerHTML = htmlToSet;
		} else {
			ele.innerText = value;
		}
		if(this.fullBleed) ele.className = 'full-bleed';
		return ele;
	}

	updated(changedProps) {
		if (changedProps.has('editing') && this.editing) {
			//If we just started editing, focus the content editable immediately
			//(the title if there's no title)
			if (this._elements[TEXT_FIELD_BODY]) {
				this._elements[TEXT_FIELD_BODY].focus();

				//Move the selection to the end of the content editable.
				if (this.body) {
					let range = document.createRange();
					range.selectNodeContents(this._elements[TEXT_FIELD_BODY]);
					range.collapse(false);
					let sel = window.getSelection();
					sel.removeAllRanges();
					sel.addRange(range);
				} else {
					//This is a total hack, but in the special case where the
					//body is empty, we had to include an nbsp; so that the
					//cursor would render inside of the <p>, so delete it.
					document.execCommand('selectAll');
					document.execCommand('delete');
				}

				if (!this.title && this._elements[TEXT_FIELD_TITLE]) {
					//If there isn't a title, we actually want the title focused
					//(after clearing out hte extra 'nbsp'. For some reason
					//Chrome doesn't actually focus the second item, unless we
					//do a timeout. :shrug:
					setTimeout(() => this._elements[TEXT_FIELD_TITLE].focus(), 0);
				}
			}
		}
	}
}

window.customElements.define('content-card', ContentCard);
