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
				/* max-width, NOT width. A fixed width was WIDER than the
				   shrink-wrapped .banners container, so on a 390px phone it
				   dragged the whole column 40px off the left edge of the screen
				   — carrying the pre-existing banners with it, and clipping the
				   status dot and the first word of every toast. Sizing to
				   content the way its three neighbours do cannot do that. */
				max-width: calc(100vw - 5.5rem);
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

			/* It wears the BANNER's clothes, not progress-panel's.
			   An earlier version copied progress-panel exactly — --card-color,
			   var(--card-shadow), square — and that comment was right that those
			   are the app's better-established values. It was still wrong,
			   because a surface has to match what it is STACKED AGAINST, and
			   once the toasts moved inside .banners they sit 8px from three
			   rounded white banners. Design review put the two boxes side by
			   side: same column, sharing nothing — different radius, shadow,
			   background, padding, gap, text colour and even typeface.
			   Whether the banner or the card is the app's real surface language
			   is a live question (§4.4 says square, and the banner's shadow is
			   the only one of its kind in the repo). But that is a change to
			   .update-ready affecting three shipped surfaces, not something to
			   settle by making a fourth box disagree with the other three. */
			.toast {
				pointer-events: auto;
				background: white;
				color: inherit;
				border-radius: 0.45rem;
				box-shadow: 0 2px 12px rgb(0 0 0 / 20%);
				padding: 0.55rem 0.7rem;
				display: flex;
				flex-direction: row;
				align-items: flex-start;
				gap: 0.65rem;
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
				color: var(--app-dark-text-color-darker);
			}

			/* The banner's text-button treatment, so all four boxes in the
			   column offer their actions the same way. */
			button.primary {
				flex-shrink: 0;
				border: 0;
				border-radius: 0.3rem;
				margin: 0;
				box-shadow: none;
				padding: 0.4rem 0.6rem;
				background: var(--app-primary-color);
				color: white;
				font: inherit;
				cursor: pointer;
			}
			button.primary:hover { box-shadow: none; }

			/* An underlined text link, like the banners' Dismiss and Discard —
			   not a filled circle-X. Four boxes in one column dismissing two
			   different ways is the kind of thing a user notices without being
			   able to say why. */
			button.dismiss {
				flex-shrink: 0;
				margin: 0;
				padding: 0.4rem 0.2rem;
				background: transparent;
				color: inherit;
				box-shadow: none;
				text-decoration: underline;
				font: inherit;
				cursor: pointer;
			}
			button.dismiss:hover { box-shadow: none; background: transparent; }

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
				<button class='dismiss' title='Dismiss' aria-label='Dismiss' @click=${() => this._handleDismiss(entry)}>Dismiss</button>
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
