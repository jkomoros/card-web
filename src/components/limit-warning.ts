
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
	selectCardLimitReached
} from '../selectors.js';

import {
	WARNING_ICON
} from './my-icons.js';

import { SharedStyles } from './shared-styles.js';
import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	State
} from '../types.js';

@customElement('limit-warning')
class LimitWarning extends connect(store)(LitElement) {
	

	@state()
		_cardLimitReached: boolean;

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
				<div class='container'>
					<button class='small' id='warning'>${WARNING_ICON}</button>
					<label for='warning'>Card limit reached</label>
				</div>
			`;
		}
		return html``;
	}

	override stateChanged(state : State) {
		this._cardLimitReached = selectCardLimitReached(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'limit-warning': LimitWarning;
	}
}
