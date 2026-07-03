
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
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

@customElement('limit-warning')
class LimitWarning extends connect(store)(LitElement) {
	

	@property({ type : Boolean })
		tight: boolean;

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

		const loadingUnpublished = this._loadingFetchTypes?.['unpublished'] || false;

			if (loadingUnpublished) {

				const classes = {
					container: true,
					loading: loadingUnpublished,
					tight: this.tight
				};

				return html`
					<div
						class=${classMap(classes)}
						title='Fetching unpublished cards'
					>
						<button
							class='small'
							id='warning'
						>
							${WARNING_ICON}
						</button>
						<label for='warning'>
							Fetching all cards <span class="bold">(slow)</span>
						</label>
					</div>
				`;
		}
		return html``;
	}

	override stateChanged(state : State) {
		this._loadingFetchTypes = selectLoadingCardFetchTypes(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'limit-warning': LimitWarning;
	}
}
