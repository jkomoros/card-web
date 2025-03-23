
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
	selectCardLimitReached,
	selectCompleteModeEffectiveCardLimit,
	selectCompleteModeEnabled,
	selectLoadingCardFetchTypes
} from '../selectors.js';

import {
	WARNING_ICON
} from '../../shared/icons.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CardFetchTypeMap,
	State
} from '../types.js';

import {
	modifyCompleteModeCardLimit,
	toggleCompleteMode
} from '../actions/data.js';

@customElement('limit-warning')
class LimitWarning extends connect(store)(LitElement) {
	

	@property({ type : Boolean })
		tight: boolean;

	@state()
		_effectiveCardLimit : number;

	@state()
		_cardLimitReached: boolean;

	@state()
		_completeMode: boolean;

	@state()
		_loadingFetchTypes: CardFetchTypeMap;

	static override styles = [
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

			div.container.tight {
				padding: 0;
			}

			div.loading {
				font-style: italic;
			}

			.bold, div.bold label, div.bold button svg {
				color: var(--app-primary-color);
				fill: var(--app-primary-color);
			}

			.bold:hover, div.bold:hover label, div.bold:hover button svg {
				color: var(--app-primary-color-light);
				fill: var(--app-primary-color-light);
			}

		`
	];
	
	override render() {

		const loadingUnpublishedComplete = this._loadingFetchTypes?.['unpublished-complete'] || false;

		if (this._cardLimitReached || loadingUnpublishedComplete) {

			const classes = {
				container: true,
				loading: loadingUnpublishedComplete,
				bold: !this._completeMode,
				tight: this.tight
			};

			return html`
				<div
					class=${classMap(classes)}
					title=${this._completeMode ? 'All cards are downloaded and visible, but it is a significant number. Performance may be affected. Click to enable performance mode' : 'You are seeing only partial unpublished cards (roughly ' + this._effectiveCardLimit + ') to preserve performance. If you want to see all cards, click to turn on complete mode. Ctrl-click to change the limit.'}
				>
					<button
						class='small'
						id='warning'
						@click=${this._handleToggleClicked}
					>
						${WARNING_ICON}
					</button>
					<label for='warning'>
						${this._completeMode ? (loadingUnpublishedComplete ? html`Fetching all cards <span class="bold">(slow)</span>` : html`Showing all cards <span class="bold">(slow)</span>`) : 'Showing only recent cards'}
					</label>
				</div>
			`;
		}
		return html``;
	}

	override stateChanged(state : State) {
		this._cardLimitReached = selectCardLimitReached(state);
		this._completeMode = selectCompleteModeEnabled(state);
		this._loadingFetchTypes = selectLoadingCardFetchTypes(state);
		this._effectiveCardLimit = selectCompleteModeEffectiveCardLimit(state);
	}

	_handleToggleClicked(e : MouseEvent) {
		//if Ctrl or Command is clicked
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			const newLimit = parseInt(prompt('Enter new limit', this._effectiveCardLimit + '') || '0');
			if (isNaN(newLimit)) return;
			store.dispatch(modifyCompleteModeCardLimit(newLimit));
			return;
		}
		store.dispatch(toggleCompleteMode());
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'limit-warning': LimitWarning;
	}
}
