import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	selectActiveCard,
	selectEditorMinimized,
	selectSuggestionsOpen
} from '../selectors.js';

import suggestions from '../reducers/suggestions.js';
store.addReducers({
	suggestions
});

import {
	HelpStyles,
} from './help-badges.js';


import {
	Card,
	State
} from '../types.js';

@customElement('suggestions-viewer')
class SuggestionsViewer extends connect(store)(LitElement) {

	@state()
		_card: Card | null;

	@state()
		_active: boolean;

	@state()
		_minimized: boolean;

	static override styles = [
		ButtonSharedStyles,
		HelpStyles,
		css`
			:host {
				position:relative;
				background-color: white;
			}

			.container {
				width: 100%;
				height:100%;
				display:flex;
				flex-direction: column;
				/* The up-down padding comes from margins in the top and bottom elements */
				padding: 0 0.5em;
				box-sizing:border-box;
			}

			.container.not-minimized {
				position:absolute;
			}

			.flex {
				flex-grow:1;
			}

			[hidden] {
				display:none;
			}

		`
	];

	override render() {

		if (!this._active) return '';

		const card = this._card;

		if (!card) return html`No card`;
		return html`<div class='container'>
		This is where suggestions will show up
	</div>`;
	}

	override stateChanged(state : State) {
		this._card= selectActiveCard(state);
		this._active = selectSuggestionsOpen(state);
		this._minimized = selectEditorMinimized(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'suggestions-viewer': SuggestionsViewer;
	}
}