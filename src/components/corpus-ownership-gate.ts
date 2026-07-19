import {LitElement, html, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {connect} from 'pwa-helpers/connect-mixin.js';

import {store} from '../store.js';
import {selectCorpusStatus, selectCorpusStatusMessage} from '../selectors.js';
import {CorpusStatus, State} from '../types.js';

const BLOCKING = new Set<CorpusStatus>(['checking', 'contended', 'inactive', 'takeover', 'unsupported', 'ownership-error', 'degraded']);

@customElement('corpus-ownership-gate')
class CorpusOwnershipGate extends connect(store)(LitElement) {
	@state() _status : CorpusStatus = 'off';
	@state() _message = '';

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
			color: #303030;
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
		button[disabled] { opacity: 0.6; cursor: wait; }
		.guidance { margin-top: 1rem; margin-bottom: 0; color: #666; font-size: 0.9rem; }
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

	private _activate() {
		if (this._status === 'unsupported') return;
		if (this._status === 'degraded' || this._status === 'ownership-error') {
			window.location.reload();
			return;
		}
		void window.CORPUS_WORKER.takeOver();
	}

	private _focusTarget() : HTMLElement | null {
		return this.renderRoot.querySelector<HTMLElement>('button:not([disabled])') ||
			this.renderRoot.querySelector<HTMLElement>('.panel');
	}

	private _setBackgroundInert(inert : boolean) {
		const siblings = Array.from((this.parentNode as ParentNode | null)?.children || []);
		for (const sibling of siblings) {
			if (!(sibling instanceof HTMLElement) || sibling === this) continue;
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
		const target = this._focusTarget();
		if (!target) return;
		event.preventDefault();
		target.focus();
	}

	private _focusGate = () => {
		if (!BLOCKING.has(this._status)) return;
		//Focus/visibility events can fire just before Chrome makes a newly
		//foregrounded document focusable. Defer one frame so focus is not lost.
		requestAnimationFrame(() => {
			if (!BLOCKING.has(this._status)) return;
			const target = this._focusTarget();
			target?.focus({preventScroll: true});
		});
	};

	override render() {
		if (!BLOCKING.has(this._status)) return html``;
		const canTakeOver = this._status === 'contended' || this._status === 'inactive';
		return html`
			<section class='panel' tabindex='-1' role='alertdialog' aria-modal='true' aria-labelledby='ownership-title' aria-describedby='ownership-description' @keydown=${this._containFocus}>
				<h1 id='ownership-title'>${this._title}</h1>
				<p id='ownership-description' role='status' aria-live='polite'>${this._message}</p>
				${canTakeOver ? html`<button data-testid='corpus-use-this-tab' @click=${this._activate}>Use this tab</button>` : ''}
				${this._status === 'takeover' ? html`<button disabled>Moving…</button>` : ''}
				${this._status === 'degraded' || this._status === 'ownership-error' ? html`<button @click=${this._activate}>Reload and retry</button>` : ''}
				${this._status === 'contended' ? html`<p class='guidance'>Or keep using the other tab and close this one.</p>` : ''}
			</section>
		`;
	}

	override stateChanged(state : State) {
		this._status = selectCorpusStatus(state);
		this._message = selectCorpusStatusMessage(state);
		this.toggleAttribute('open', BLOCKING.has(this._status));
	}

	override updated() {
		const open = BLOCKING.has(this._status);
		this._setBackgroundInert(open);
		if (open) this._focusGate();
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
