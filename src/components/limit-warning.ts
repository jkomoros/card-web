
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
	selectCardLimitReached,
	selectCompleteModeEnabled
} from '../selectors.js';

import {
	WARNING_ICON
} from './my-icons.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	State
} from '../types.js';

import {
	toggleCompleteMode
} from '../actions/data.js';

@customElement('limit-warning')
class LimitWarning extends connect(store)(LitElement) {
	

	@state()
		_cardLimitReached: boolean;

	@state()
		_completeMode: boolean;

	static override styles = [
		SharedStyles,
		ButtonSharedStyles,
		css`
			:host {
				display:flex;
				width: 100%;
				flex-direction: column;
				align-items: center;
			}

			div.container {
				padding: 0.5em 0.5em 0;
			}
		`
	];
	
	override render() {
		if (this._cardLimitReached) {
			return html`
				<div class='container' title=${this._completeMode ? 'All cards are downloaded and visible, but it is a significant number. Performance may be affected. Click to enable performance mode' : 'You are seeing only partial unpublished cards to preserve performance. If you want to see all cards, click to turn on complete mode.'}>
					<button class='small' id='warning'>${WARNING_ICON}</button>
					<label for='warning'>
						${this._completeMode ? 'Showing all cards (slow)' : 'Showing only recent cards'}
					</label>
				</div>
			`;
		}
		return html``;
	}

	override stateChanged(state : State) {
		this._cardLimitReached = selectCardLimitReached(state);
		this._completeMode = selectCompleteModeEnabled(state);
	}

	_handleToggleClicked() {
		store.dispatch(toggleCompleteMode());
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'limit-warning': LimitWarning;
	}
}
