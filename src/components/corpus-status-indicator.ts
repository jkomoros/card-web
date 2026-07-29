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
			/* Without this the dot butted directly against its label whenever
			   the header instance became non-quiet. */
			gap: 0.4em;
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

		/* Quiet statuses keep the text for screen readers only. */
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

		/* The header instance has no width budget of its own, so a long status
		   sentence (the 'stale' copy is ~90 chars) wrapped and grew the header
		   bar. Truncate instead; the full text stays in the title attribute.
		   These belong HERE: on the visually-hidden rule above they were dead,
		   and this rule used to undo them with white-space:normal. */
		:host(:not([data-quiet])) .label {
			position: static;
			width: auto;
			max-width: 22em;
			height: auto;
			margin: 0;
			clip: auto;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--app-dark-text-color);
		}

		/* The header instance inherits the header's full-size type, which is
		   far too loud for a status line; the app's convention for a
		   subordinate label is 0.75em. The floating pill already sets its own
		   0.72rem, so it must not be scaled again. */
		:host(:not([floating]):not([data-quiet])) .label {
			font-size: 0.75em;
		}

		/* The palette is the app's own (purple/teal/red/grey); the previous
		   hand-picked greens, golds and oranges belonged to no other surface
		   in this UI. */
		.dot {
			width: 8px;
			height: 8px;
			flex-shrink: 0;
			box-sizing: border-box;
			border-radius: 50%;
			background: var(--app-dark-text-color-light);
			box-shadow: 0 0 0 1px rgb(0 0 0 / 12%);
		}

		.dot[data-status='live'] {
			background: var(--app-secondary-color);
		}

		/* Same purple the 'Loading…' placeholder card uses. */
		.dot[data-status='loading'],
		.dot[data-status='checking'] {
			background: var(--app-primary-color-light);
			animation: corpus-status-pulse 1.8s ease-in-out infinite;
		}

		/* Tab coordination is informational, not an error. */
		.dot[data-status='takeover'],
		.dot[data-status='contended'],
		.dot[data-status='inactive'] {
			background: var(--app-primary-color-subtle);
		}

		.dot[data-status='stale'],
		.dot[data-status='degraded'],
		.dot[data-status='unsupported'],
		.dot[data-status='ownership-error'] {
			background: var(--app-warning-color);
		}

		.dot[data-status='fallback'] {
			background: var(--app-dark-text-color);
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
		//'loading' is quiet too: a labeled pill on every ordinary boot is
		//noise — the floating indicator should speak only for degraded states.
		this.toggleAttribute('data-quiet', this._status === 'live' || this._status === 'off' || this._status === 'loading');
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'corpus-status-indicator': CorpusStatusIndicator;
	}
}
