import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { connect } from 'pwa-helpers/connect-mixin.js';

import { store } from '../store.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	dismissSnackbar,
	runSnackbarAction
} from '../actions/app.js';

import {
	CANCEL_ICON
} from '../../shared/icons.js';

import {
	SnackbarID,
	SnackbarMessage,
	State
} from '../types.js';

//At most this many on screen at once. More than three stacked toasts stops
//being a report and starts being a wall; the rest wait their turn.
const MAX_VISIBLE = 3;

@customElement('snack-bar')
//NOT PageViewElement: its shouldUpdate() returns this.active, and nothing sets
//active on an ambient surface, so it would never render. That base class is for
//routed pages.
class SnackBar extends connect(store)(LitElement) {

	@state()
		_snackbars : SnackbarMessage[] = [];

	@property({ type : Boolean })
		mobile : boolean;

	//ONE TIMER PER VISIBLE MESSAGE, owned by the component.
	//
	//This is the fix for the bug that motivated the rewrite. The old timer was a
	//single module-level handle in actions/app.ts that every showSnackbar()
	//cleared and reset, so a second message both replaced the first's text and
	//restarted its clock — two outcomes close together showed one of them.
	//
	//It lives HERE rather than in an action because only the component knows
	//what is visible: a message queued behind three others must not be counting
	//down, and hovering one must pause it. Actions cannot see either.
	private _timers : Map<SnackbarID, number> = new Map();

	private _paused = false;

	static override styles = [
		ButtonSharedStyles,
		css`
			/* Bottom CENTRE. Both corners are already taken: the comments
			   panel's add-thread button and the drawer's create buttons at the
			   bottom, the save-status pill and the update/draft banners above
			   them. card-web-app carries three separate comments about
			   corner-collision bugs that shipped, one of which had a banner
			   covering the very controls it told the user to press. */
			:host {
				position: fixed;
				left: 50%;
				transform: translateX(-50%);
				bottom: max(0.75rem, env(safe-area-inset-bottom));
				z-index: 960;
				width: min(30rem, calc(100vw - 2rem));
				display: flex;
				flex-direction: column-reverse;
				gap: 0.5rem;
				/* The container must never eat a click meant for something
				   underneath it; only the toasts themselves are interactive. */
				pointer-events: none;
			}

			:host([mobile]) {
				width: calc(100vw - 1rem);
				bottom: 5.5rem;
			}

			/* Follows progress-panel: the dialog .content treatment, square
			   corners, the one real surface shadow. NOT the old teal fill —
			   --app-secondary-color means "live/exists" in this app, and the
			   previous snack-bar used it as a neutral background for every
			   message it ever showed. */
			.toast {
				pointer-events: auto;
				background-color: var(--card-color);
				color: var(--app-dark-text-color);
				box-shadow: var(--card-shadow);
				padding: 0.75rem;
				display: flex;
				flex-direction: row;
				align-items: flex-start;
				gap: 0.5rem;
				font-size: 0.85rem;
				transition: opacity var(--transition-fade), transform var(--transition-fade);
			}

			.dot {
				width: 0.5rem;
				height: 0.5rem;
				border-radius: 50%;
				flex-shrink: 0;
				margin-top: 0.35rem;
			}

			/* Amber is "not yet on the server", red is "this did not survive".
			   committed and info get no dot at all — a dot for "it worked" is
			   noise. */
			.toast[data-kind='queued'] .dot { background: var(--app-pending-color); }
			.toast[data-kind='discarded'] .dot { background: var(--app-warning-color); }

			.body {
				flex-grow: 1;
			}

			details {
				margin-top: 0.35rem;
				font-size: 0.9em;
			}

			summary {
				cursor: pointer;
				color: var(--app-dark-text-color-light);
			}

			.detail-line {
				color: var(--app-dark-text-color-light);
			}

			button.action {
				flex-shrink: 0;
				margin: 0;
				padding: 0.25rem 0.5rem;
				background: var(--app-primary-color);
				font-size: 0.85rem;
			}

			button.small {
				flex-shrink: 0;
				padding: 0.25rem;
			}

			@media (prefers-reduced-motion: reduce) {
				.toast { transition: none; }
			}
		`
	];

	private get _visible() : SnackbarMessage[] {
		return this._snackbars.slice(0, MAX_VISIBLE);
	}

	override render() {
		const visible = this._visible;
		return html`
			<!-- BOTH live regions exist before any message does. A live region
			     created at the same moment as its content is not announced. -->
			<div role='status' aria-live='polite'>
				${visible.filter(entry => entry.kind !== 'discarded').map(entry => this._renderToast(entry))}
			</div>
			<div role='alert'>
				${visible.filter(entry => entry.kind === 'discarded').map(entry => this._renderToast(entry))}
			</div>
		`;
	}

	private _renderToast(entry : SnackbarMessage) {
		return html`
			<div class='toast' data-kind=${entry.kind}
				@mouseenter=${this._handlePause} @mouseleave=${this._handleResume}
				@focusin=${this._handlePause} @focusout=${this._handleResume}>
				<span class='dot' aria-hidden='true'></span>
				<div class='body'>
					${entry.message}
					${entry.detailLines && entry.detailLines.length ? html`
						<details>
							<summary>${entry.detailSummary || 'Show details'}</summary>
							${entry.detailLines.map(line => html`<div class='detail-line'>${line}</div>`)}
						</details>` : ''}
				</div>
				${entry.action ? html`<button class='action' @click=${() => this._handleAction(entry)}>${entry.action.label}</button>` : ''}
				<button class='small' title='Dismiss' aria-label='Dismiss' @click=${() => this._handleDismiss(entry)}>${CANCEL_ICON}</button>
			</div>
		`;
	}

	private _handleAction(entry : SnackbarMessage) {
		if (!entry.action) return;
		store.dispatch(runSnackbarAction(entry.id, entry.action.actionID));
	}

	private _handleDismiss(entry : SnackbarMessage) {
		store.dispatch(dismissSnackbar(entry.id));
	}

	//An action button that vanishes mid-reach is worse than no action button.
	private _handlePause() {
		this._paused = true;
		for (const handle of this._timers.values()) window.clearTimeout(handle);
		this._timers.clear();
	}

	private _handleResume() {
		this._paused = false;
		this._syncTimers();
	}

	//Start a timer for anything VISIBLE that does not have one, and drop timers
	//for anything that has left. A message still queued behind others has no
	//timer at all, which is the whole point: its clock starts when it appears.
	private _syncTimers() {
		const visible = new Set(this._visible.map(entry => entry.id));
		for (const [id, handle] of [...this._timers.entries()]) {
			if (visible.has(id)) continue;
			window.clearTimeout(handle);
			this._timers.delete(id);
		}
		if (this._paused) return;
		for (const entry of this._visible) {
			if (this._timers.has(entry.id)) continue;
			//0 means "until dismissed" — a discarded write does not evaporate.
			if (!entry.durationMs) continue;
			const handle = window.setTimeout(() => {
				this._timers.delete(entry.id);
				store.dispatch(dismissSnackbar(entry.id));
			}, entry.durationMs);
			this._timers.set(entry.id, handle);
		}
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_snackbars')) this._syncTimers();
	}

	override disconnectedCallback() {
		for (const handle of this._timers.values()) window.clearTimeout(handle);
		this._timers.clear();
		super.disconnectedCallback();
	}

	override stateChanged(state : State) {
		this._snackbars = state.app.snackbars;
		this.mobile = state.app.mobileMode;
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'snack-bar': SnackBar;
	}
}
