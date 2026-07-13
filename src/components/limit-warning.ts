
import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

import { 
	selectLoadingCardFetchTypes,
	selectCorpusStatus,
	selectCorpusStatusMessage
} from '../selectors.js';

import {
	WARNING_ICON
} from '../../shared/icons.js';

import {
	CardFetchTypeMap,
	CorpusStatus,
	State
} from '../types.js';

@customElement('limit-warning')
class LimitWarning extends connect(store)(LitElement) {
	

	@property({ type : Boolean })
		tight: boolean;

	@state()
		_loadingFetchTypes: CardFetchTypeMap;

	@state()
		_corpusStatus: CorpusStatus;

	@state()
		_corpusStatusMessage: string;

	static override styles = [
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

			.bold, div.bold label, div.bold svg {
				color: var(--app-primary-color);
				fill: var(--app-primary-color);
			}

			.bold:hover, div.bold:hover label, div.bold:hover svg {
				color: var(--app-primary-color-light);
				fill: var(--app-primary-color-light);
			}

			span.small {
				display: inline-flex;
				vertical-align: middle;
				margin-right: 0.25em;
			}

			span.small svg {
				fill: var(--app-dark-text-color);
				height: 18px;
				width: 18px;
			}

		`
	];
	
	override render() {

		const loadingUnpublished = this._loadingFetchTypes?.['unpublished'] || false;
		const showCorpusStatus = this._corpusStatus === 'stale' || this._corpusStatus === 'degraded' || this._corpusStatus === 'fallback';

			if (loadingUnpublished || showCorpusStatus) {

				const classes = {
					container: true,
					loading: loadingUnpublished && !showCorpusStatus,
					tight: this.tight
				};

				return html`
					<div
						class=${classMap(classes)}
						role='status'
						aria-live='polite'
						title=${showCorpusStatus ? this._corpusStatusMessage : 'Fetching unpublished cards'}
					>
						<span
							class='small'
							aria-hidden='true'
						>
							${WARNING_ICON}
						</span>
						<span>
							${showCorpusStatus ? this._corpusStatusMessage : html`Fetching all cards <span class="bold">(slow)</span>`}
						</span>
					</div>
				`;
		}
		return html``;
	}

	override stateChanged(state : State) {
		this._loadingFetchTypes = selectLoadingCardFetchTypes(state);
		this._corpusStatus = selectCorpusStatus(state);
		this._corpusStatusMessage = selectCorpusStatusMessage(state);
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'limit-warning': LimitWarning;
	}
}
