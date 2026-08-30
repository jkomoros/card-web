
import { LitElement, html, css, TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { StyleInfo, styleMap } from 'lit/directives/style-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import {
	urlForTag
} from '../actions/app.js';

import {
	makeTagTappedEvent,
	makeTagAddedEvent,
	makeTagRemovedEvent,
	makeCardHoveredEvent
} from '../events.js';

import {
	Card,
	CSSColorString,
	TagInfos
} from '../types.js';

import {
	COLORS
} from '../../shared/card_fields.js';

import * as icons from '../../shared/icons.js';

import {
	CANCEL_ICON
} from '../../shared/icons.js';

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

	//THE OUTLINED NOT-STATE. Fill inversion mirrors meaning inversion: a
	//negated clause keeps its colour but stops being filled with it, and gains a
	//quiet lowercase "not " in front of its own name. This is the ONLY extension
	//the composer's negation story needs, and it is deliberately not a toggle
	//widget — the negation is a word inside the chip, where a reader meets it.
	//
	//A filter with a named inverse (`published` -> `unpublished`) must NOT come
	//through here: it renders as its own word on a plain filled pill. The caller
	//decides, via conditionCanUseNamedInverse.
	@property({ type : Boolean })
		negated: boolean;

	//THIS CHIP IS A TOKEN INSIDE A FOCUS-MANAGED SURFACE.
	//
	//A chip in the collection sentence is one item of a toolbar whose roving
	//tabindex lives on the HOST elements, so the chip's own internals must not
	//be tab stops of their own: the label is not a link (there is nowhere to
	//navigate — the containing surface owns the gesture) and the remove control
	//is a pointer affordance whose keyboard equivalent is the surface's Delete
	//key. The X also stops being permanently visible and becomes quiet until
	//hover or focus, so a sentence of pills reads as a sentence rather than as a
	//row of delete buttons — with the space still reserved, so nothing reflows
	//under the cursor.
	@property({ type : Boolean })
		tokenized: boolean;

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
		card: Card | null;

	static override styles = [
		css`
			:host {
				color: var(--app-light-text-color);
				font-weight:bold;
			}
			span {
				padding: 0.2em;
				border-radius: 0.3em;
				font-size: 0.7em;
				margin: 0 0.1em;
				display: inline-block;
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

			svg {
				height:1.0em;
				width:1.0em;
				margin-right: 0.3em;
				fill: var(--app-light-text-color);
			}

			/* THE OUTLINED NOT-STATE. White fill, the chip's own colour as
			   border and text — the inversion of the fill mirrors the inversion
			   of the meaning, so nothing has to be learned to read it.
			   The border is compensated in the padding rather than added to it,
			   so a negated chip occupies exactly the same box as a plain one and
			   flipping a pill does not reflow the sentence around it. The colour
			   itself is not written here: it arrives per-chip through styleMap,
			   from the same tagInfos pipeline the fill uses. */
			span.negated {
				border: 1px solid;
				padding: calc(0.2em - 1px);
			}

			span.negated a.primary,
			span.negated a.delete {
				color: inherit;
			}

			span.negated svg {
				fill: currentColor;
			}

			/* The negation is a word in the chip's own name, not a badge beside
			   it: lowercase and at normal weight so the NAME stays what the eye
			   lands on. */
			.not {
				font-weight: normal;
			}

			/* A TOKEN IS A CONTROL, NOT A PASSAGE OF TEXT. On a touch screen a
			   tap begins life as a press-and-hold, and the browser's default
			   answer to a press-and-hold on text is to select the word under
			   it — so tapping a pill in the collection sentence selected the
			   word "Tagged" and the tap never reached the pill. Only in
			   tokenized mode: an editor's tag-list is prose the user may well
			   want to select. */
			span.tokenized {
				-webkit-user-select: none;
				user-select: none;
			}

			/* The negation is a word, and a word needs a space after it. It was
			   written as the literal 'not ' inside its own element, where the
			   trailing space sits at an inline element's edge and is collapsed
			   away in exactly the cases that matter. A margin cannot be
			   collapsed. */
			.not {
				margin-right: 0.25em;
			}

			/* A TOKEN'S REMOVE CONTROL IS QUIET UNTIL REACHED FOR. opacity, not
			   display, because the space stays reserved: a sentence that grew a
			   glyph under the cursor would shove the pills after it sideways at
			   the exact moment one is being aimed at. */
			span.tokenized.enabled.editing a.delete {
				display: inline-flex;
				align-items: center;
				opacity: 0;
				padding: 0 0.15em;
				position: relative;
				transition: opacity var(--transition-fade);
			}

			span.tokenized.enabled.editing:hover a.delete,
			span.tokenized.enabled.editing:focus-within a.delete,
			:host(:focus-visible) span.tokenized.enabled.editing a.delete,
			:host([data-selected]) span.tokenized.enabled.editing a.delete {
				opacity: 1;
			}

			/* §4.2's 44px minimum, bought with an overlay rather than with a
			   44px glyph: the pill is ~1.4em tall and a control that actually
			   measured 44px would be taller than the sentence it sits in. */
			span.tokenized a.delete::after {
				content: '';
				height: 44px;
				left: 50%;
				position: absolute;
				top: 50%;
				transform: translate(-50%, -50%);
				width: 44px;
			}

			span.tokenized a.delete svg {
				height: 0.9em;
				margin-right: 0;
				width: 0.9em;
			}

			/* SELECTION AND FOCUS ARE THE SAME RING ON PURPOSE. The surface's
			   roving tabindex means the selected token IS the focused one
			   whenever the sentence has focus; the separate selected state
			   exists for when it does not (a host selecting a pill
			   programmatically), and it would be dishonest to draw those as two
			   different things. */
			:host(:focus-visible),
			:host([data-selected]) {
				outline: none;
			}

			:host(:focus-visible) span.tokenized,
			:host([data-selected]) span.tokenized {
				outline: 2px solid var(--app-primary-color);
				outline-offset: 2px;
			}
		`
	];

	override render() {
		//THE NEGATED CHIP TRADES ITS FILL FOR ITS OUTLINE, and the swap happens
		//here rather than in CSS because the colour is per-chip data, not a
		//style: it comes from the same tagInfos pipeline the fill comes from, so
		//the two states cannot disagree about what colour this tag is.
		const styles : StyleInfo = this.negated ?
			{backgroundColor: 'var(--app-light-text-color)', color: this._color} :
			{backgroundColor: this._color};
		if (this._filter) styles.filter = this._filter;
		return html`
			<span style=${styleMap(styles)} class='${this.editing ? 'editing' : ''} ${this.addition ? 'addition' : ''} ${this.deletion ? 'deletion' : ''} ${this.negated ? 'negated' : ''} ${this.tokenized ? 'tokenized' : ''} ${this._disabled ? 'disabled' : 'enabled'}' title='${this._description}' @mousemove=${this._handleMouseMove}><a class='primary' href=${ifDefined(this._url || undefined)} @click=${this._handleTagClicked}>${this._icon}${this._negationPrefix}${this._displayName}</a><a class='delete' href=${ifDefined(this.tokenized ? undefined : '#')} tabindex=${ifDefined(this.tokenized ? '-1' : undefined)} aria-hidden=${ifDefined(this.tokenized ? 'true' : undefined)} @click=${this._handleXClicked}>${this.tokenized ? CANCEL_ICON : 'X'}</a></span>
			`;
	}

	//"not " is part of the name, so it lives inside the label's own element:
	//quiet and lowercase, because the reader is not being taught an operator.
	get _negationPrefix() : TemplateResult {
		if (!this.negated) return html``;
		return html`<span class='not'>not</span>`;
	}

	get _icon() : TemplateResult {
		if (!this.tagInfos) return html``;
		const info = this.tagInfos[this.tagName];
		if (!info) return html``;
		if (!info.iconName) return html ``;
		return icons[info.iconName];
	}

	_handleMouseMove(e : MouseEvent) {
		if (!this._previewCard) return;
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		e.stopPropagation();
		//card-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(makeCardHoveredEvent(this._previewCard, e.clientX, e.clientY));
	}

	_handleTagClicked(e : MouseEvent) {
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

	_handleXClicked(e : MouseEvent) {
		if (this._disabled) return false;
		e.preventDefault();
		//A TOKEN'S ✕ IS NOT ALSO A TAP ON THE TOKEN. In a sentence the chip
		//itself is a control — clicking it selects the clause, and in the drawer
		//it opens the composer — so a removal whose click went on bubbling would
		//give one gesture two answers: the clause disappears AND the composer
		//opens over the collection it just left. Only in tokenized mode: an
		//editor's tag-list has no second meaning for the same click.
		if (this.tokenized) e.stopPropagation();
		if (this.deletion) {
			//In this (special) case, the user has removed us previously and so
			//now clicking again should UN-delete us, by firing an tag-added.
			this.dispatchEvent(makeTagAddedEvent(this.tagName));
		} else {
			//the dfeault case, this will fire a tag-removed
			this.dispatchEvent(makeTagRemovedEvent(this.tagName));
		}
		
		return false;
	}

	get _effectiveDefaultColor() {
		return this.defaultColor || COLORS.INDIAN_RED;
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
		const info = this.tagInfos[this.tagName];
		if (!info) return false;
		return info.subtle || false;
	}

	get _color() {
		const defaultColor = this._effectiveDefaultColor;
		if (!this.tagInfos) return defaultColor;
		const info = this.tagInfos[this.tagName];
		if (!info) return defaultColor;
		return info.color || defaultColor;
	}

	get _filter() {
		if (this._subtle || this._disabled) return 'grayscale(80%) opacity(40%)';
		if (!this.tagInfos) return '';
		const info = this.tagInfos[this.tagName];
		if (!info) return '';
		return info.filter || '';
	}

	get _disabled() {
		if (this.disabled) return true;
		if (!this.tagInfos) return false;
		const info = this.tagInfos[this.tagName];
		if (!info) return false;
		return info.disabled || false;
	}

	get _displayName() {
		if (!this.tagInfos) return this.tagName;
		const info = this.tagInfos[this.tagName];
		if (!info) return this.tagName;
		return info.title || this.tagName;
	}

	get _description() {
		if (this._disabled && this.disabledDescription) return this.disabledDescription;
		if (!this.tagInfos) return this.tagName;
		const info = this.tagInfos[this.tagName];
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
