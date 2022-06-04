
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import {
	urlForCard
} from '../actions/app.js';

import {
	selectActivePreviewCardId
} from '../selectors.js';

import {
	killEvent
} from '../util.js';

import {
	CardID,
	State
} from '../types.js';

@customElement('card-highlight')
class CardHighlight extends connect(store)(LitElement) {

	@property({ type : String})
	card: CardID;

	//If disabled, then won't navigate to the card, and also won't light
	//up on hover. However, a click event will be dispatched,
	//`disabled-card-highlight-clicked`.
	@property({ type : Boolean })
	disabled: boolean;

	//If true, will render in an alternate color
	@property({ type : Boolean })
	alternate: boolean;

	@state()
	_hoverCardID: CardID;

	//TODO: switch to static styles property
	static override styles = [
		css`
			:host {
				display:inline;
				margin:0;
				padding:0;
			}

			span {
				cursor: pointer;
				background-color: var(--app-secondary-color-light-very-transparent);
			}

			span.alternate {
				background-color: var(--app-primary-color-light-very-transparent);
			}

			span.disabled {
				/* icon looks kind of like it will be removed. this and and
				the next rule are for the behavior in card editor that do
				things with the disabled-card-clicked event, which is a
				little odd that we do something with it here. */
				cursor: alias;
			}

			span.alternate.disabled {
				cursor: copy;
			}

			/* the next two don't need enabled class when hover class is
			also manually set, so they can highlight any time the card is
			hovered elsewhere */
			span.enabled:hover, span.hover {
				background-color: var(--app-secondary-color-light-somewhat-transparent);
			}

			span.enabled.alternate:hover, span.alternate.hover {
				background-color: var(--app-primary-color-light-somewhat-transparent);
			}

			a {
				text-decoration: none;
				color: var(--app-dark-text-color);
			}
		`
	];

	override render() {
		/* the following is all on one line to avoid extra whitespace that would lead to gaps between the text and punctuation */
		return html`<span class='${this.disabled ? 'disabled' : 'enabled'} ${this.alternate ? 'alternate' : ''} ${this.card == this._hoverCardID ? 'hover' : ''}' @mousedown=${this._handleMouseDown} @mousemove=${this._handleMouseMove}>${this.disabled ? html`<slot></slot>` : html`<a href=${this._href}><slot></slot></a>`}</span>`;
	}

	override stateChanged(state : State) {
		this._hoverCardID = selectActivePreviewCardId(state);
	}

	get _href() {
		return this.disabled ? '' : urlForCard(this.card);
	}

	_handleMouseDown(e) {
		//This is on mousedown because if a click is generated, by then the
		//content editable would already be focused, and the highlight would be
		//gone.
		if (!this.disabled) return false;
		this.dispatchEvent(new CustomEvent('disabled-card-highlight-clicked', {composed: true, detail: {card: this.card, alternate: this.alternate}}));
		return killEvent(e);
	}

	_handleMouseMove(e) {
		//if any buttons are down (which could happen for e.g. a drag), don't report the hover
		if (e.buttons) return;
		if (this.disabled) return;
		e.stopPropagation();
		//cards-web-app will catch the card-hovered event no matter where it was
		//thrown from
		this.dispatchEvent(new CustomEvent('card-hovered', {composed:true, detail: {card: this.card, x: e.clientX, y: e.clientY}}));
	}

}

declare global {
	interface HTMLElementTagNameMap {
	  "card-highlight": CardHighlight;
	}
}
