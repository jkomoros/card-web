import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';

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

	@state()
		mobile = false;

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
			/* NOT position:fixed. This used to anchor itself bottom-centre, which
			   was chosen because both bottom corners were occupied — but the
			   banner stack is bottom-anchored and up to 100vw-5.5rem wide, so at
			   narrow viewports the toasts landed directly on top of it and the
			   snack bar's higher z-index won. Rendering a toast over a banner is
			   the same corner-collision defect card-web-app carries three
			   comments about.
			   There is one bottom band, so there is one stack: card-web-app
			   renders this INSIDE .banners and everything in the corner shares
			   the same flex column. */
			:host {
				display: block;
				width: min(30rem, calc(100vw - 2rem));
				/* Still must not eat a click meant for what is underneath; only
				   the toasts themselves are interactive. */
				pointer-events: none;
			}

			/* The flex lives HERE, on the actual list of toasts. On :host it
			   applied to the live-region divs instead, so gap never separated
			   anything and column-reverse only swapped the two regions. */
			.toasts {
				display: flex;
				flex-direction: column-reverse;
				gap: 0.5rem;
			}

			/* A CLASS, not an attribute. mobile is a property and Lit does not
			   reflect by default, so :host([mobile]) could never match and this
			   whole branch was dead — the toast stayed at the desktop offset and
			   covered the update banner's Reload button on a phone. HOUSE-STYLE
			   §4.6 says the mobile flag is threaded down and set as a class, and
			   every other component in the repo does that. */
			:host(.mobile) {
				width: calc(100vw - 1rem);
			}

			/* Carries the words for a screen reader and nothing else. Not
			   display:none or hidden, which would remove it from the a11y tree. */
			.announce {
				position: absolute;
				width: 1px;
				height: 1px;
				overflow: hidden;
				clip-path: inset(50%);
				white-space: nowrap;
			}

			/* Follows progress-panel: the dialog .content treatment, square
			   corners, the one real surface shadow. NOT the old teal fill —
			   --app-secondary-color means "live/exists" in this app, and the
			   previous snack-bar used it as a neutral background for every
			   message it ever showed. */
			.toast {
				pointer-events: auto;
				background-color: var(--card-color);
				/* NOT --app-dark-text-color at this size. progress-panel, the
				   primitive this otherwise follows, carries a comment rejecting
				   exactly that: it is calibrated for 24px headings and fails AA
				   at body size (3.90:1 measured here). De-emphasize by SIZE, not
				   by grey. */
				color: var(--app-dark-text-color-darker, #4d4d4d);
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

			/* Subordinate by size, not by a grey that fails AA (2.26:1). */
			summary, .detail-line {
				cursor: pointer;
				font-size: 0.9em;
				color: var(--app-dark-text-color);
			}

			/* button.primary from ButtonSharedStyles, not a local seventh
			   variant; only the margin and hit padding are adjusted for a toast. */
			button.primary {
				flex-shrink: 0;
				margin: 0;
				padding: 0.25rem 0.5rem;
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

	//The NEWEST few, not the oldest few. A 'discarded' message never times out
	//by design, so taking from the front let one sticky message plus two others
	//occupy the window permanently and starve everything queued behind it — a
	//burst of five would show three and silently never show the last two.
	//Taking from the end means a new outcome always appears, and the sticky one
	//is not lost: it stays queued and comes back as the newer ones expire.
	private get _visible() : SnackbarMessage[] {
		return this._snackbars.slice(-MAX_VISIBLE);
	}

	//The visual list and the announced text are SEPARATE.
	//
	//They were the same thing, with the toasts living inside two role'd divs.
	//That broke both jobs at once: the divs were the host's only flex children,
	//so column-reverse and gap applied to THEM and never to the toasts —
	//messages rendered as one flush slab, oldest at top — while splitting by
	//kind made reading order disagree with visual order. Announcing the toast
	//subtree also re-read every button label on every new message, because
	//status and alert are implicitly aria-atomic.
	//
	//So: one flex list of toasts, and two text-only live regions that carry
	//nothing but the words.
	override render() {
		return html`
			<div class='toasts'>
				${this._visible.map(entry => this._renderToast(entry))}
			</div>
			<!-- Both regions exist before any message does: a live region created
			     at the same moment as its content is not announced. -->
			<div class='announce' role='status' aria-live='polite'>${this._announced.polite}</div>
			<div class='announce' role='alert'>${this._announced.alert}</div>
		`;
	}

	//What each region should say right now. Only the newest message of each
	//routing is announced: re-announcing the whole visible set on every arrival
	//is what aria-atomic would have done, and it is not useful.
	private get _announced() : {polite : string, alert : string} {
		const newest = (match : (entry : SnackbarMessage) => boolean) => {
			const hits = this._visible.filter(match);
			return hits.length ? hits[hits.length - 1].message : '';
		};
		return {
			polite: newest(entry => entry.kind !== 'discarded'),
			alert: newest(entry => entry.kind === 'discarded'),
		};
	}

	private _renderToast(entry : SnackbarMessage) {
		return html`
			<div class='toast' data-kind=${entry.kind}
				@mouseenter=${this._handlePause} @mouseleave=${this._handleResume}
				@focusin=${this._handlePause} @focusout=${this._handleResume}>
				${entry.kind === 'queued' || entry.kind === 'discarded' ? html`<span class='dot' aria-hidden='true'></span>` : ''}
				<div class='body'>
					${entry.message}
					${entry.detailLines && entry.detailLines.length ? html`
						<details>
							<summary>${entry.detailSummary || 'Show details'}</summary>
							${entry.detailLines.map(line => html`<div class='detail-line'>${line}</div>`)}
						</details>` : ''}
				</div>
				${entry.action ? html`<button class='primary' @click=${() => this._handleAction(entry)}>${entry.action.label}</button>` : ''}
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

	//Timers are cleared on disconnect, and updated() only re-syncs when the
	//message list CHANGES — so without this, a DOM move left every message on
	//screen with no clock and made all of them permanent.
	override connectedCallback() {
		super.connectedCallback();
		this._syncTimers();
	}

	override disconnectedCallback() {
		for (const handle of this._timers.values()) window.clearTimeout(handle);
		this._timers.clear();
		super.disconnectedCallback();
	}

	override stateChanged(state : State) {
		this._snackbars = state.app.snackbars;
		this.mobile = state.app.mobileMode;
		//A class on the host, so :host(.mobile) actually matches. See the note
		//in the styles.
		this.classList.toggle('mobile', Boolean(state.app.mobileMode));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'snack-bar': SnackBar;
	}
}
