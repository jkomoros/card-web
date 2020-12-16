import { LitElement, html } from '@polymer/lit-element';
import {GestureEventListeners} from '@polymer/polymer/lib/mixins/gesture-event-listeners.js';
import * as Gestures from '@polymer/polymer/lib/utils/gestures.js';

import { SharedStyles } from './shared-styles.js';

import {
	badgeStyles,
	starBadge
} from './card-badges.js';

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
	TEXT_FIELD_CONFIGURATION,
	CARD_TYPE_CONFIGURATION,
	CARD_TYPE_CONTENT,
	editableFieldsForCardType
} from '../card_fields.js';

import { makeElementContentEditable } from '../util.js';

export const CARD_WIDTH_IN_EMS = 43.63;
export const CARD_HEIGHT_IN_EMS = 24.54;
export const CARD_VERTICAL_PADDING_IN_EMS = 1.0;
export const CARD_HORIZONTAL_PADDING_IN_EMS = 1.45;

//Number of pixels until a track is considered a swipe
const SWIPE_DX = 15.0;

const EPSILON = 0.5;

// This element is *not* connected to the Redux store.
export class BaseCard extends GestureEventListeners(LitElement) {
	render() {
		const cardType = this._card.card_type || CARD_TYPE_CONTENT;
		const cardTypeConfig = CARD_TYPE_CONFIGURATION[cardType] || {};
		const styleBlock = cardTypeConfig.styleBlock || html``;
		const fieldsToRender = editableFieldsForCardType(cardType);
		return html`
			${SharedStyles}
			${badgeStyles}
			<style>
				:host {
					display:block;
					background-color: var(--card-color);
					
					width: ${CARD_WIDTH_IN_EMS}em;
					height: ${CARD_HEIGHT_IN_EMS}em;
					

					box-shadow: var(--card-shadow);
					box-sizing: border-box;
					line-height:1.4;
					position:relative;
				}

				.container {
					height:100%;
					width:100%;
					padding: ${CARD_VERTICAL_PADDING_IN_EMS}em ${CARD_HORIZONTAL_PADDING_IN_EMS}em;
					box-sizing:border-box;
				}

				.container.unpublished {
					background-color: var(--unpublished-card-color);
				}

				.container.editing {
					box-shadow: inset 0 0 4em 1em var(--app-primary-color-light-transparent);
				}

				.container.editing card-link[card] {
					--card-link-cursor:not-allowed;
				}

				h1, h2, h3{
					font-family: 'Raleway', sans-serif;
					font-weight:bold;
					margin-top:0;
				}

				h1 {
					color: var(--app-primary-color);
					font-size: 1.4em;
				}

				h2 {
					color: var(--app-dark-text-color);
					font-size: 1.2em;
				}

				h3 {
					color: var(--app-dark-text-color);
					font-size: 1.1em;
				}

				h1 strong, h2 strong, h3 strong {
					color: var(--app-primary-color);
				}

				section {
					font-family: 'Source Sans Pro', sans-serif;
					font-size: 1em;
					color: var(--app-dark-text-color);
					background-color:transparent;
				}

				section p {
					/* make it so the top most item doesn't push the whole
					section down. p still have margin-bottom that previously
					would collapse with margin-top so the only effect is
					allowing boosted p to not push down the screen */
					margin-top:0;
				}

				section.full-bleed {
					top:0;
					left:0;
					height:100%;
					width:100%;
					position:absolute;
					display:flex;
					flex-direction:column;
					justify-content:center;
					align-items:center;
				}

				.small {
					font-size:0.72em;
				}
				.loading {
					font-style:italic;
					opacity: 0.5;
				}

				.star-count {
					position:absolute;
					top:0.5em;
					right:0.5em;
				}

				.background {
					display: none;
				}

				/* Google docs pasted output includes <p> inside of li a lot. This
				is a hack, #361 covers fixing it */
				li > p {
					display:inline;
				}

				${Object.entries(this.editing ? {} : (this._card.font_size_boost || {})).map(entry => {
		return html`[data-field=${entry[0]}] {
						font-size: ${1.0 + entry[1]}em;
					}`;
	})}

			</style>
			${styleBlock}
			<div class="container ${this.editing ? 'editing' : ''} ${this._card.published ? 'published' : 'unpublished'}">
				<div class='background'></div>
				${Object.keys(fieldsToRender).map(fieldName => this._templateForField(fieldName))}
				${starBadge(this._card.star_count)}
			</div>
		`;
	}

	get _card() {
		return this.card || {};
	}

	static get properties() {
		return {
			card: {type: Object},
			editing : { type:Boolean },
			updatedFromContentEditable: {type:Object},
			dataIsFullyLoaded: {type:Boolean},
			_elements: {type: Object},
		};
	}

	_handleClick(e) {
		//We only cancel link following if editing is true
		if (!this.editing) return;
		let ele = e.composedPath()[0];
		if (ele.localName != 'a') return;
		//Links that will open a new tab are fine
		if (ele.target == '_blank') return;
		e.preventDefault();

	}

	_handleTrack(e) {
		//Wait until the track ends, and they lift their finger
		if (e.detail.state != 'end') return;
		if (e.detail.dx > SWIPE_DX) {
			this.dispatchEvent(new CustomEvent('card-swiped', {composed:true, detail: {direction:'right'}}));
		}
		if (e.detail.dx < - 1 *SWIPE_DX) {
			this.dispatchEvent(new CustomEvent('card-swiped', {composed:true, detail: {direction:'left'}}));
		}
	}

	firstUpdated() {
		this.addEventListener('click', e => this._handleClick(e));
		Gestures.addListener(this, 'track', e => this._handleTrack(e));
		document.addEventListener('selectionchange', this._selectionChanged.bind(this));
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

	_templateForField(field) {
		const config = TEXT_FIELD_CONFIGURATION[field] || {};

		//If the update to body came from contentEditable then don't change it,
		//the state is already in it. If we were to update it, the selection state
		//would reset and defocus.
		const updatedFromContentEditable = (this.updatedFromContentEditable || {})[field];
		if (updatedFromContentEditable && this._elements[field]) {
			return this._elements[field];
		}

		let value = this._card[field] || '';
		let htmlToSet = config.html ? normalizeBodyHTML(value) : '';
		if (!value && !this.editing) {
			if (this._card.full_bleed) {
				value = '';
			} else {
				if (this._card.id) {
					htmlToSet = '<span class=\'loading\'>Content goes here...</span>';
				} else if (this.dataIsFullyLoaded) {
					htmlToSet = 'No card by that name, try a link from above.';
				} else {
					htmlToSet = '<span class=\'loading\'>Loading...<span>';
				}
			}
		}

		const ele = document.createElement(config.container || 'span');
		this._elements[field] = ele;
		ele.field = field;
		ele.dataset.field = field;
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
		if(this._card.full_bleed) ele.className = 'full-bleed';
		return ele;
	}

	updated(changedProps) {
		if (changedProps.has('editing') && this.editing) {
			//If we just started editing, focus the content editable immediately
			//(the title if there's no title)
			if (this._elements[TEXT_FIELD_BODY]) {
				this._elements[TEXT_FIELD_BODY].focus();

				//Move the selection to the end of the content editable.
				if (this._card[TEXT_FIELD_BODY]) {
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
			}
			//If the title is empty we _always_ want to select it
			if (!this._card[TEXT_FIELD_TITLE] && this._elements[TEXT_FIELD_TITLE]) {
				//If there isn't a title, we actually want the title focused
				//(after clearing out hte extra 'nbsp'. For some reason
				//Chrome doesn't actually focus the second item, unless we
				//do a timeout. :shrug:
				setTimeout(() => this._elements[TEXT_FIELD_TITLE].focus(), 0);
			}
		}
	}

	//isOverflowing checks if any fields are overflowing--that is, that the
	//field's bounds are outside the bounds of the positioning parent. If
	//optFieldNames is provided, it will check just those fields, and if
	//optFieldNames is not provided it will check all of them.
	isOverflowing(optFieldNames) {
		let eles = [...this.shadowRoot.querySelectorAll('[data-field]')];
		if (optFieldNames) {
			const fieldNamesMap = Object.fromEntries(optFieldNames.map(item => [item, true]));
			eles = eles.filter(ele => fieldNamesMap[ele.field]);
		}
		const offsetParentEle = this;
		const offsetParentHeight = offsetParentEle.offsetHeight;
		const offsetParentWidth = offsetParentEle.offsetWidth;
		const fontSize = parseFloat(getComputedStyle(offsetParentEle).fontSize);
		const verticalPaddingInPx = CARD_VERTICAL_PADDING_IN_EMS * fontSize;
		const horizontalPaddingInPx = CARD_HORIZONTAL_PADDING_IN_EMS * fontSize;
		for (let ele of eles) {
			if (ele.offsetParent != offsetParentEle) console.warn('Offset parentw as not the expected node');
			if ((ele.offsetTop + ele.offsetHeight) -  (offsetParentHeight - verticalPaddingInPx) > EPSILON) return true;
			if ((ele.offsetLeft + ele.offsetWidth) - (offsetParentWidth - horizontalPaddingInPx) > EPSILON) return true;
		}
		return false;
	}

}

window.customElements.define('base-card', BaseCard);
