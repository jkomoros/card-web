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
	TEXT_FIELD_TITLE
} from '../card_fields.js';

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
			updatedFromContentEditable: {type:Object},
			dataIsFullyLoaded: {type:Boolean},
			_sectionElement: {type:Object},
			_h1Element: {type:Object},
		};
	}

	_textPropertyChanged(field, value) {
		this.dispatchEvent(new CustomEvent('text-field-updated', {composed:true, detail: {field: field, value: value}}));
	}

	_bodyChanged() {
		this._textPropertyChanged(TEXT_FIELD_BODY, this._sectionElement.innerHTML);
	}

	_titleChanged() {
		this._textPropertyChanged(TEXT_FIELD_TITLE, this._h1Element.innerText);
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

	get _titleFromContentEditable() {
		return (this.updatedFromContentEditable || {})[TEXT_FIELD_TITLE];
	}

	get _bodyFromContentEditable() {
		return (this.updatedFromContentEditable || {})[TEXT_FIELD_BODY];
	}

	_makeH1(title) {
		if (this._titleFromContentEditable && this._h1Element) {
			return this._h1Element;
		}
		let htmlToSet = '';
		if (!title && !this.editing) {
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
		if (this._bodyFromContentEditable && this._sectionElement) {
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
		body = dompurify.sanitize(body, {
			ADD_ATTR: ['card'],
			ADD_TAGS: ['card-link'],
		});
		if (body === '') {
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
			body = '<p>&nbsp;</p>';
		}
		section.innerHTML = body;
		if(this.fullBleed) section.className = 'full-bleed';
		return section;
	}

	updated(changedProps) {
		if (changedProps.has('editing') && this.editing) {
			//If we just started editing, focus the content editable immediately
			//(the title if there's no title)
			if (this._sectionElement) {
				this._sectionElement.focus();

				//Move the selection to the end of the content editable.
				if (this.body) {
					let range = document.createRange();
					range.selectNodeContents(this._sectionElement);
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

				if (!this.title && this._h1Element) {
					//If there isn't a title, we actually want the title focused
					//(after clearing out hte extra 'nbsp'. For some reason
					//Chrome doesn't actually focus the second item, unless we
					//do a timeout. :shrug:
					setTimeout(() => this._h1Element.focus(), 0);
				}
			}
		}
	}
}

window.customElements.define('content-card', ContentCard);
