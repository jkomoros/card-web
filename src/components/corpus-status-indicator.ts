import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

import { store } from '../store.js';
import {
	selectCorpusStatus,
	selectCorpusStatusMessage,
} from '../selectors.js';
import {
	CorpusStatus,
	State,
} from '../types.js';

const DEFAULT_MESSAGES : Record<CorpusStatus, string> = {
	off: 'Card sync: standard mode',
	loading: 'Card sync: loading and verifying the corpus',
	live: 'Card sync: live',
	stale: 'Card sync is interrupted. Lists and search are temporarily unavailable; retrying automatically.',
	degraded: 'Card sync is degraded.',
	fallback: 'Background card sync is unavailable; using standard loading.',
	checking: 'Checking whether this tab can safely start card sync…',
	contended: 'Compendium is active in another tab.',
	inactive: 'Compendium moved to another tab. This tab is safely disconnected.',
	takeover: 'Moving Compendium to this tab…',
	unsupported: 'This browser cannot safely coordinate card sync.',
	'ownership-error': 'Card sync could not start.',
};

@customElement('corpus-status-indicator')
class CorpusStatusIndicator extends connect(store)(LitElement) {
	@property({type: Boolean, reflect: true})
		floating = false;

	@state()
		_status: CorpusStatus = 'off';

	@state()
		_message = '';

	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			margin: 0 0.35em;
		}

		:host([floating]) {
			position: fixed;
			right: max(0.6rem, env(safe-area-inset-right));
			top: max(0.6rem, env(safe-area-inset-top));
			z-index: 20;
			gap: 0.4rem;
			max-width: min(24rem, calc(100vw - 1.2rem));
			padding: 0.35rem 0.55rem;
			border-radius: 999px;
			background: rgb(255 255 255 / 92%);
			box-shadow: 0 1px 5px rgb(0 0 0 / 18%);
			font-size: 0.72rem;
		}

		:host([floating][data-quiet]) {
			padding: 0.3rem;
		}

		.label {
			position: absolute;
			width: 1px;
			height: 1px;
			padding: 0;
			margin: -1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}

		:host(:not([data-quiet])) .label {
			position: static;
			width: auto;
			height: auto;
			margin: 0;
			overflow: visible;
			clip: auto;
			white-space: normal;
		}

		.dot {
			width: 8px;
			height: 8px;
			box-sizing: border-box;
			border-radius: 50%;
			background: #9ca3af;
			box-shadow: 0 0 0 1px rgb(0 0 0 / 12%);
		}

		.dot[data-status='live'] {
			background: #2e9b50;
		}

		.dot[data-status='loading'],
		.dot[data-status='checking'] {
			background: #c69214;
			animation: corpus-status-pulse 1.8s ease-in-out infinite;
		}

		.dot[data-status='stale'] {
			background: #d97706;
		}

		.dot[data-status='degraded'] {
			background: #c2410c;
		}

		.dot[data-status='fallback'] {
			background: #6b7280;
		}

		.dot[data-status='contended'],
		.dot[data-status='inactive'],
		.dot[data-status='takeover'],
		.dot[data-status='unsupported'],
		.dot[data-status='ownership-error'] {
			background: #c2410c;
		}

		@keyframes corpus-status-pulse {
			0%, 100% { opacity: 0.45; }
			50% { opacity: 1; }
		}

		@media (prefers-reduced-motion: reduce) {
			.dot[data-status='loading'],
			.dot[data-status='checking'] {
				animation: none;
			}
		}
	`;

	override render() {
		const description = this._message || DEFAULT_MESSAGES[this._status];
		return html`
			<span
				class='dot'
				data-status=${this._status}
				aria-hidden='true'
				title=${description}
			></span><span class='label' role='status' aria-live='polite'>${description}</span>
		`;
	}

	override stateChanged(state : State) {
		this._status = selectCorpusStatus(state);
		this._message = selectCorpusStatusMessage(state);
		this.toggleAttribute('data-quiet', this._status === 'live' || this._status === 'off');
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'corpus-status-indicator': CorpusStatusIndicator;
	}
}
