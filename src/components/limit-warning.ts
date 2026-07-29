
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
	SCHEDULE_ICON,
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
				/* The app's convention for a subordinate label (see the label
				   rule in ButtonSharedStyles): 0.75em, light grey. Without it
				   this routine status line rendered at full body size and read
				   as an error. */
				display: flex;
				align-items: center;
				justify-content: center;
				gap: 0.3em;
				font-size: 0.75em;
				line-height: 1.3;
				color: var(--app-dark-text-color-light);
				text-align: center;
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
				flex-shrink: 0;
			}

			span.small svg {
				/* Sized off the (now small) text so the icon does not tower
				   over the label it annotates. */
				fill: var(--app-dark-text-color-light);
				height: 1.35em;
				width: 1.35em;
			}

		`
	];
	
	override render() {

		const loadingUnpublished = this._loadingFetchTypes?.['unpublished'] || false;
		//'loading' included: the corpus now SERVES while it is still being
		//verified, so the user should be told the list is complete-but-
		//unverified rather than seeing an unlabeled (and briefly stale) list.
		const showCorpusStatus = this._corpusStatus === 'stale' || this._corpusStatus === 'degraded' || this._corpusStatus === 'fallback' || this._corpusStatus === 'loading';

			if (loadingUnpublished || showCorpusStatus) {

				const classes = {
					container: true,
					//A routine boot status should read as quietly as the app's
					//other placeholder copy ('No notes for this card'), not as
					//a warning.
					loading: (loadingUnpublished && !showCorpusStatus) || this._corpusStatus === 'loading',
					tight: this.tight
				};

				return html`
					<div
						class=${classMap(classes)}
						role='note'
						title=${showCorpusStatus ? this._corpusStatusMessage : 'Fetching unpublished cards'}
					>
						<span
							class='small'
							aria-hidden='true'
						>
							${this._corpusStatus === 'loading' ? SCHEDULE_ICON : WARNING_ICON}
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
