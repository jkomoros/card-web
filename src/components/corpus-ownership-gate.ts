import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {connect} from 'pwa-helpers/connect-mixin.js';

import {store} from '../store.js';
import {selectCorpusStatus, selectCorpusStatusMessage} from '../selectors.js';
import {CorpusStatus, State} from '../types.js';
import {CORPUS_STATUS_BLOCKS_INTERACTION} from '../corpus-readiness.js';
import {takeOverOwnership} from '../corpus-bridge.js';

const BLOCKING = CORPUS_STATUS_BLOCKS_INTERACTION;

//How long a transient 'checking' may last before the full-screen overlay is
//worth showing. The single-tab happy path resolves the Web Lock in one task —
//flashing a modal over the just-painted app on EVERY boot is pure noise.
const CHECKING_REVEAL_GRACE_MS = 250;

@customElement('corpus-ownership-gate')
class CorpusOwnershipGate extends connect(store)(LitElement) {
	@state() _status : CorpusStatus = 'off';
	@state() _message = '';
	@state() _checkingRevealed = false;
	@state() _resetting = false;
	private _checkingRevealTimer = 0;
	private _wasOpen = false;
	private _returnFocus : HTMLElement | null = null;

	static override styles = css`
		:host { display: none; }
		:host([open]) {
			display: grid;
			position: fixed;
			inset: 0;
			z-index: 1000;
			place-items: center;
			padding:
				max(1.25rem, env(safe-area-inset-top))
				max(1.25rem, env(safe-area-inset-right))
				max(1.25rem, env(safe-area-inset-bottom))
				max(1.25rem, env(safe-area-inset-left));
			box-sizing: border-box;
			overflow: auto;
			background: rgb(248 250 252 / 97%);
			color: var(--app-dark-text-color);
		}
		.panel {
			width: min(30rem, 100%);
			max-height: 100%;
			padding: 1.5rem;
			box-sizing: border-box;
			overflow: auto;
			border-radius: 0.8rem;
			background: white;
			box-shadow: 0 12px 35px rgb(0 0 0 / 18%);
			font-family: var(--app-default-font-family, sans-serif);
		}
		h1 { margin: 0 0 0.65rem; font-size: 1.35rem; }
		p { margin: 0 0 1.2rem; line-height: 1.4; }
		button {
			border: 0;
			border-radius: 0.35rem;
			padding: 0.7rem 1rem;
			background: var(--app-primary-color, #5e2b97);
			color: white;
			font: inherit;
			font-weight: 600;
			cursor: pointer;
			min-height: 44px;
		}
		button:focus-visible { outline: 3px solid var(--app-primary-color, #5e2b97); outline-offset: 3px; }
		/* The escalation, not the first thing to reach for: same size and hit
		   target, visibly subordinate to the primary action. */
		button.secondary {
			margin-top: 0.6rem;
			background: transparent;
			color: var(--app-primary-color, #5e2b97);
			box-shadow: inset 0 0 0 1px var(--app-primary-color, #5e2b97);
		}
		button[disabled] { opacity: 0.6; cursor: wait; }
		/* The app's convention for a subordinate label is 0.75em, and the tokens
		   are inherited here (this renders inside card-web-app's shadow root) —
		   this panel was the only surface hardcoding its own greys. */
		.guidance { margin-top: 1rem; margin-bottom: 0; color: var(--app-dark-text-color-light); font-size: 0.75em; }
	`;

	private get _title() : string {
		if (this._status === 'checking') return 'Checking card sync…';
		if (this._status === 'inactive') return 'Compendium moved to another tab';
		if (this._status === 'takeover') return 'Moving Compendium to this tab…';
		if (this._status === 'unsupported') return 'This browser isn’t supported';
		if (this._status === 'ownership-error') return 'Card sync couldn’t start';
		if (this._status === 'degraded') return 'Cards could not load';
		return 'Compendium is open in another tab';
	}

	//A worker chunk that 404s after a deploy is a STALE CACHE problem, and a
	//plain reload re-fetches the same stale bundle from the same service
	//worker — so the panel's only button led straight back to the panel, for
	//good. Unregister the service worker and drop its caches first, so the
	//reload actually fetches the new bundle.
	//
	//Deliberately NOT a switch to legacy main-thread listeners: criterion 9
	//says no fallback may bypass worker ownership, and this failure mode does
	//not need one. It needs the correct bundle.
	private _resetAndReload = async () => {
		if (this._resetting) return;
		this._resetting = true;
		try {
			if ('serviceWorker' in navigator) {
				const registrations = await navigator.serviceWorker.getRegistrations();
				await Promise.all(registrations.map(registration => registration.unregister().catch(() => false)));
			}
		} catch {
			//Best effort: a browser that denies this still gets the reload.
		}
		try {
			if (typeof caches !== 'undefined') {
				const keys = await caches.keys();
				await Promise.all(keys.map(key => caches.delete(key).catch(() => false)));
			}
		} catch {
			//Same.
		}
		//Deliberately NOT clearing IndexedDB: the compact snapshot is not what
		//failed here, and discarding it turns every recovery into a cold boot.
		window.location.reload();
	};

	//Keep activation bound to the gate across shadow-DOM event dispatchers.
	private _activate = () => {
		if (this._status === 'unsupported') return;
		if (this._status === 'degraded' || this._status === 'ownership-error') {
			window.location.reload();
			return;
		}
		void takeOverOwnership();
	};

	private _focusTarget() : HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>('button:not([disabled])') ||
			this.renderRoot.querySelector<HTMLElement>('.panel');
	}

	private _setBackgroundInert(inert : boolean) {
		const siblings = Array.from((this.parentNode as ParentNode | null)?.children || []);
		for (const sibling of siblings) {
			if (!(sibling instanceof HTMLElement) || sibling === this) continue;
			//The save-status pill is the ONLY escape from a stranded durable
			//intent, and a stranded intent is one of the states that puts this
			//gate on screen ('degraded'). Marking it inert would make the app's
			//sole recovery control unclickable exactly when it is needed.
			if (sibling.hasAttribute('data-corpus-gate-keep-interactive')) continue;
			if (inert) {
				if (!sibling.inert) sibling.dataset.corpusGateInert = 'true';
				sibling.inert = true;
			} else if (sibling.dataset.corpusGateInert === 'true') {
				sibling.inert = false;
				delete sibling.dataset.corpusGateInert;
			}
		}
	}

	private _containFocus(event : KeyboardEvent) {
		//The rest of the app is inert, and keyboard shortcuts must be inert too.
		event.stopPropagation();
		if (event.key !== 'Tab') return;
		//Only trap Tab when there is somewhere to trap it. For 'unsupported'
		//the panel has no button at all, so preventDefault-ing Tab onto a
		//tabindex="-1" panel was a keyboard trap (WCAG 2.1.2) on a
		//non-interactive element: no way out, and nothing to act on.
		const target = this.renderRoot.querySelector<HTMLElement>('button:not([disabled])');
		if (!target) return;
		event.preventDefault();
		target.focus();
	}

	private _focusGate = () => {
		if (!this._shouldBlock()) return;
		//Focus/visibility events can fire just before Chrome makes a newly
		//foregrounded document focusable. Defer one frame so focus is not lost.
		requestAnimationFrame(() => {
			if (!this._shouldBlock()) return;
			const target = this._focusTarget();
			target?.focus({preventScroll: true});
		});
	};

	override render() {
		if (!this._shouldBlock()) return html``;
		const canTakeOver = this._status === 'contended' || this._status === 'inactive';
		return html`
			<section class='panel' tabindex='-1' role='alertdialog' aria-modal='true' aria-labelledby='ownership-title' aria-describedby='ownership-description' @keydown=${this._containFocus}>
				<h1 id='ownership-title'>${this._title}</h1>
				<!-- No role='status'/aria-live here: an alertdialog already
				     announces its aria-describedby content on open, so the live
				     region made screen readers say it twice. -->
				<p id='ownership-description'>${this._message}</p>
				${canTakeOver ? html`<button data-testid='corpus-use-this-tab' @click=${this._activate}>Use this tab</button>` : ''}
				${this._status === 'takeover' ? html`<button disabled>Moving…</button>` : ''}
				${this._status === 'degraded' || this._status === 'ownership-error' ? html`
					<button @click=${this._activate} ?disabled=${this._resetting}>Reload and retry</button>
					<button class='secondary' data-testid='corpus-reset-and-reload' @click=${this._resetAndReload} ?disabled=${this._resetting}>${this._resetting ? 'Resetting…' : 'Reset cached app and reload'}</button>
					<p class='guidance'>If reloading keeps landing here, the cached app is likely stale — resetting clears it and fetches a fresh copy. Your cards are on the server; the local cache is rebuilt automatically.</p>
				` : ''}
				${this._status === 'unsupported' ? html`<p class='guidance'>Compendium needs Web Locks and BroadcastChannel to keep a single tab authoritative over your card data. Recent Chrome, Edge, Firefox and Safari all support them.</p>` : ''}
				${this._status === 'contended' ? html`<p class='guidance'>Or keep using the other tab and close this one.</p>` : ''}
			</section>
		`;
	}

	_shouldBlock() : boolean {
		if (!BLOCKING.has(this._status)) return false;
		//'checking' resolves within one task on the single-tab happy path;
		//only reveal the overlay if it is still unresolved after the grace.
		if (this._status === 'checking' && !this._checkingRevealed) return false;
		return true;
	}

	override stateChanged(state : State) {
		this._status = selectCorpusStatus(state);
		this._message = selectCorpusStatusMessage(state);
		if (this._status === 'checking') {
			if (!this._checkingRevealTimer && !this._checkingRevealed) {
				this._checkingRevealTimer = window.setTimeout(() => {
					this._checkingRevealTimer = 0;
					if (this._status === 'checking') this._checkingRevealed = true;
				}, CHECKING_REVEAL_GRACE_MS);
			}
		} else {
			if (this._checkingRevealTimer) window.clearTimeout(this._checkingRevealTimer);
			this._checkingRevealTimer = 0;
			this._checkingRevealed = false;
		}
		this.toggleAttribute('open', this._shouldBlock());
	}

	override updated() {
		const open = this._shouldBlock();
		//Visibility and inertness MUST be set together. `open` drives
		//`:host([open])` (the host is `display:none` otherwise) and was toggled
		//only in stateChanged — but this method runs on every render, including
		//the one caused by the `checking` grace timer flipping
		//_checkingRevealed, which is not a Redux dispatch. That combination
		//made the background inert while the overlay stayed invisible: an app
		//that looks completely normal and in which every click and every
		//focusable control is dead, with no message, until some unrelated
		//dispatch happened to re-enter stateChanged.
		this.toggleAttribute('open', open);
		if (open && !this._wasOpen) {
			const active = document.activeElement;
			this._returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
		}
		this._setBackgroundInert(open);
		if (open) {
			this._focusGate();
		} else if (this._wasOpen) {
			const target = this._returnFocus;
			this._returnFocus = null;
			requestAnimationFrame(() => {
				if (target?.isConnected) target.focus({preventScroll: true});
				else (this.parentNode as ParentNode | null)?.querySelector<HTMLElement>('main-view')?.focus({preventScroll: true});
			});
		}
		this._wasOpen = open;
	}

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener('focus', this._focusGate);
	}

	override disconnectedCallback() {
		window.removeEventListener('focus', this._focusGate);
		this._setBackgroundInert(false);
		super.disconnectedCallback();
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'corpus-ownership-gate': CorpusOwnershipGate;
	}
}
