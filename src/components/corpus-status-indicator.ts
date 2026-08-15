import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

import { store } from '../store.js';
import {
	LOCK_ICON
} from '../../shared/icons.js';
import {
	selectCorpusStatus,
	selectCorpusStatusMessage,
	selectCorpusSize,
	selectCorpusSnapshotAgeMs,
	selectExpectedCorpusSize,
	selectPendingAuxWriteCount,
	selectPendingModificationCount,
} from '../selectors.js';
import {
	corpusStatusGlyph,
} from '../corpus-status-glyph.js';
import {
	CorpusStatus,
	State,
} from '../types.js';

@customElement('corpus-status-indicator')
class CorpusStatusIndicator extends connect(store)(LitElement) {
	@property({type: Boolean, reflect: true})
		floating = false;

	@state()
		_status: CorpusStatus = 'off';

	@state()
		_message = '';

	@state()
		_corpusSize = 0;

	@state()
		_expectedCorpusSize : number | null = null;

	@state()
		_snapshotAgeMs : number | null = null;

	@state()
		_pendingSaveCount = 0;

	@state()
		_queuedWriteCount = 0;

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

		/* The quiet pill used to be a bare dot, so it collapsed to a circle.
		   With a count beside it that padding crops the number. */
		:host([floating][data-quiet]:not([data-has-count])) {
			padding: 0.3rem;
		}

		/* The one number that is worth showing even in the quiet states. Same
		   0.72rem the floating pill uses, in the app's subordinate-label grey,
		   with tabular figures so it does not jitter as the count changes. */
		.count {
			font-size: 0.72em;
			font-variant-numeric: tabular-nums;
			/* NOT --app-dark-text-color-light (#AAA): ~2.3:1 on the pill's
			   white background, for the one number this whole surface exists
			   to show. #7f7f7f is 4.6:1. */
			color: var(--app-dark-text-color);
			line-height: 1;
		}

		.count[hidden] {
			display: none;
		}

		/* The un-confirmed-changes layer: a superscript count in the same
		   amber as the pending dot, so the two read as one signal. */
		.lock {
			opacity: 0.8;
			margin-left: 0.15em;
			display: inline-block;
			vertical-align: -0.1em;
		}

		.lock svg {
			width: 0.8em;
			height: 0.8em;
			fill: currentColor;
		}


		.badge {
			font-size: 0.8em;
			vertical-align: super;
			font-variant-numeric: tabular-nums;
			color: var(--app-pending-color, #b26a00);
			line-height: 1;
		}

		.badge[hidden] {
			display: none;
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

		/* One tone per layer of health (see corpus-status-glyph.ts). The ok /
		   working / problem tones reuse the app's own palette exactly as
		   before; 'pending' is the one new hue — amber, for "your change has
		   not reached the server yet" — because nothing in the palette sits
		   between the live teal and the warning red. */
		.dot {
			width: 8px;
			height: 8px;
			flex-shrink: 0;
			box-sizing: border-box;
			border-radius: 50%;
			/* muted: this tab deliberately is not syncing. */
			background: var(--app-dark-text-color-light);
			box-shadow: 0 0 0 1px rgb(0 0 0 / 12%);
		}

		.dot[data-tone='ok'] {
			background: var(--app-secondary-color);
			color: var(--app-secondary-color);
		}

		/* Same purple the 'Loading…' placeholder card uses. */
		.dot[data-tone='working'] {
			background: var(--app-primary-color-light);
			color: var(--app-primary-color-light);
		}

		.dot[data-tone='pending'] {
			background: var(--app-pending-color, #b26a00);
			color: var(--app-pending-color, #b26a00);
		}

		.dot[data-tone='problem'] {
			background: var(--app-warning-color);
			color: var(--app-warning-color);
		}

		/* "Still working" is its own axis: a pending (amber) dot pulses too
		   while a fetch is in flight, and goes steady when the fetch is done
		   but a change is still unconfirmed. */
		.dot[data-pulse] {
			animation: corpus-status-pulse 1.8s ease-in-out infinite;
		}

		/* During the initial download the dot becomes a tiny progress ring:
		   the tone color sweeps clockwise over a muted track as the fetched
		   fraction grows. Same pixels, one more layer of meaning. */
		.dot.ring {
			background:
				conic-gradient(currentColor var(--corpus-progress, 0deg), transparent 0) border-box,
				var(--app-divider-color, #e0e0e0);
		}

		@keyframes corpus-status-pulse {
			0%, 100% { opacity: 0.45; }
			50% { opacity: 1; }
		}

		@media (prefers-reduced-motion: reduce) {
			.dot[data-pulse] {
				animation: none;
			}
		}
	`;

	//All display decisions live in the pure mapping so they are Node-testable;
	//this component only renders the result.
	get _glyph() {
		return corpusStatusGlyph({
			status: this._status,
			message: this._message,
			corpusSize: this._corpusSize,
			expectedCorpusSize: this._expectedCorpusSize,
			corpusSnapshotAgeMs: this._snapshotAgeMs,
			pendingSaveCount: this._pendingSaveCount,
			queuedWriteCount: this._queuedWriteCount,
		});
	}

	override render() {
		//In the quiet states the dot alone said nothing at all. A card count is
		//one glanceable number that distinguishes 'live with the whole corpus'
		//from 'live with a fraction of it', which is the failure this whole
		//branch is about — and during the initial fetch it ticks upward
		//('12.4k↑', or '12.4k/40.2k' when the worker knows the target), with a
		//superscript amber badge for local changes the server has not
		//confirmed.
		const glyph = this._glyph;
		return html`
			<span
				class='dot ${glyph.progress !== null ? 'ring' : ''}'
				data-tone=${glyph.tone}
				?data-pulse=${glyph.pulse}
				aria-hidden='true'
				title=${glyph.tooltip}
				style=${glyph.progress !== null ? `--corpus-progress:${Math.round(glyph.progress * 360)}deg` : ''}
			></span><span class='count' aria-hidden='true' title=${glyph.tooltip} ?hidden=${!glyph.countLabel && !glyph.pendingBadge}>${glyph.countLabel}<span class='lock' ?hidden=${!glyph.writeLocked} aria-hidden='true'>${LOCK_ICON}</span><span class='badge' ?hidden=${!glyph.pendingBadge}>${glyph.pendingBadge}</span></span><span class='label' role='status' aria-live='polite'>${glyph.tooltip}</span>
		`;
	}

	override stateChanged(state : State) {
		this._status = selectCorpusStatus(state);
		this._message = selectCorpusStatusMessage(state);
		this._corpusSize = selectCorpusSize(state);
		this._expectedCorpusSize = selectExpectedCorpusSize(state);
		this._snapshotAgeMs = selectCorpusSnapshotAgeMs(state);
		this._pendingSaveCount = selectPendingModificationCount(state);
		this._queuedWriteCount = selectPendingAuxWriteCount(state);
		const glyph = this._glyph;
		this.toggleAttribute('data-has-count', Boolean(glyph.countLabel || glyph.pendingBadge));
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
