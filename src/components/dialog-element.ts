import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	registerShortcut,
	DIALOG_SHORTCUT_PRIORITY,
	SHORTCUT_COMBOS
} from '../shortcuts.js';

import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CANCEL_ICON
} from '../../shared/icons.js';

import {
	makeDialogShouldCloseEvent
} from '../events.js';

//document.activeElement stops at a shadow host, so a control inside another
//component reads as that component. Walk down to the real one.
const deepestActiveElement = () : HTMLElement | null => {
	let active = document.activeElement;
	while (active && active.shadowRoot && active.shadowRoot.activeElement) {
		active = active.shadowRoot.activeElement;
	}
	return active instanceof HTMLElement ? active : null;
};

@customElement('dialog-element')
export class DialogElement extends LitElement {

	@property({ type : Boolean })
		open: boolean;

	@property({ type : String })
	override title: string;

	@property({ type : Boolean })
		mobile: boolean;

	//'dialog' for a sub-task, 'alertdialog' for a surface whose whole content
	//IS the message (a destructive confirmation). alertdialog is announced
	//immediately on open, which is why such a dialog needs no separate
	//role='status'/aria-live region.
	@property({ type : String })
		dialogRole : 'dialog' | 'alertdialog' = 'dialog';

	static override styles = [
		ButtonSharedStyles,
		SharedStyles,
		css`
			.container {
				position: absolute;
				height: 100%;
				width: 100%;
				top: 0;
				left: 0;
				/* Note that card-preview has a z-index higher than this to
				show up above it */
				z-index: 1000;
				display: none;
			}

			.container.open {
				display: block;
			}

			.background {
				position:absolute;
				height:100%;
				width:100%;
				top:0;
				left:0;
				background-color:#FFFFFFCC;
				display:flex;
				flex-direction:column;
				align-items: center;
				justify-content:center;
			}

			.content {
				background-color:white;
				padding:1em;
				box-sizing: border-box;
				box-shadow: var(--card-shadow);
				position:relative;
				display:flex;
				flex-direction:column;
				min-height: 40%;
				min-width: 40%;
				max-height:90%;
				max-width:70%;
			}

			.mobile .content {
				height:100%;
				width:100%;
				max-height:none;
				max-width:none;
			}

			h2 {
				font-weight: normal;
				font-size:1.5em;
				text-align:left;
				margin:0;
			}

			#close {
				position: absolute;
				top: 0.5em;
				right: 0.5em;
			}

			/* #inner is THE scroll container for every dialog (#759): content
			   rendered inside a dialog must not introduce its own scroller
			   unless it is deliberately a nested pane. auto, not scroll —
			   scroll reserves a permanent gutter on always-show-scrollbar
			   systems (Windows, Linux, macOS with a mouse) whether or not
			   anything overflows; the layout-shift concern that motivates
			   scroll is what scrollbar-gutter: stable is for. contain keeps a
			   dialog scrolled to its end from chain-scrolling the page
			   behind it. */
			#inner {
				flex-grow:1;
				display:flex;
				flex-direction:column;
				overflow: auto;
				scrollbar-gutter: stable;
				overscroll-behavior: contain;
			}

			/* Six subclasses each carried a byte-identical copy of this. It is
			   the dialog contract's button row: bottom-right, primary last. */
			.buttons {
				display:flex;
				flex-direction:row;
				justify-content:flex-end;
			}

			/* The panel is the focus fallback when a dialog has no text field,
			   so it must not paint a focus ring when focused programmatically. */
			.content:focus {
				outline: none;
			}
		`
	];

	override render() {
		return html`
			<div class='container ${this.open ? 'open' : 'closed'}'>
				<div class='background ${this.mobile ? 'mobile': ''}' @click=${this._handleBackgroundClicked}>
					<div class='content' role=${this.dialogRole} aria-modal='true' aria-labelledby='dialog-title' tabindex='-1' @keydown=${this._handleKeyDown}>
						<button class='small' id='close' title='Close dialog' aria-label='Close dialog' @click=${this.cancel}>${CANCEL_ICON}</button>
						<h2 id='dialog-title'>${this.title || ''}</h2>
						<div id='inner'>
						${this.innerRender()}
						</div>
					</div>
				</div>
			</div>
	`;
	}

	innerRender() {
		//You can subclass this and return somethingelse for innerRender or use it directly with content inside.
		return html`<slot></slot>`;
	}

	_unregisterEscapeShortcut : (() => void) | null = null;

	//Registered on OPEN, not on connect (adversarial review): dialogs render
	//unconditionally, so connect-time registration froze the Escape order at
	//mount order — with the image browser stacked over image properties,
	//Escape closed the HIDDEN properties dialog. Registering when a dialog
	//opens, with the registry's newest-first tiebreak, makes Escape peel
	//stacked dialogs top-down. (Two open dialogs used to BOTH cancel on one
	//press; one-at-a-time is the improvement, not a compatibility break.)
	//At dialog priority so an open dialog's Escape beats the page-level
	//blur-focused binding — the legacy pair (card-view on document, this on
	//window, neither stopping propagation) DOUBLE-fired. Unregistered on
	//close and on disconnect; the legacy window listener leaked one
	//registration per dialog instance forever (~9 subclasses).
	private _syncEscapeShortcut() {
		if (this.open && !this._unregisterEscapeShortcut) {
			this._unregisterEscapeShortcut = registerShortcut({
				id: 'dialog-escape',
				keys: SHORTCUT_COMBOS['dialog-escape'],
				label: 'Close the dialog',
				priority: DIALOG_SHORTCUT_PRIORITY,
				//Escape must close the dialog from its own text inputs.
				focusPolicy: 'any-focus',
				handler: () => {
					if (!this.open) return false;
					this.cancel();
					return true;
				},
			});
		} else if (!this.open && this._unregisterEscapeShortcut) {
			this._unregisterEscapeShortcut();
			this._unregisterEscapeShortcut = null;
		}
	}

	override disconnectedCallback() {
		if (this._unregisterEscapeShortcut) this._unregisterEscapeShortcut();
		this._unregisterEscapeShortcut = null;
		this._previouslyFocused = null;
		super.disconnectedCallback();
	}

	_handleBackgroundClicked(e : MouseEvent) {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('No shadowroot');
		const background = shadowRoot.querySelector('.background');
		//If the click wasn't actualy directly on the background then ignore it.
		if (e.composedPath()[0] != background) return;
		this._shouldClose();
	}

	cancel() {
		this._shouldClose(true);
	}

	//Will be called with a single argument of true if cancelled
	_shouldClose(cancelled = false) {
		//Override point for sub classes
		this.dispatchEvent(makeDialogShouldCloseEvent(cancelled));
	}

	//What had focus before we opened, so it can be handed back on close.
	//Nothing did this before, so closing a dialog dropped focus to <body> and a
	//keyboard user restarted from the top of the document every time.
	private _previouslyFocused : HTMLElement | null = null;

	//Standard focusable set. Deliberately scoped to THIS shadow root: content
	//nested in a child custom element's own shadow root (card-drawer inside
	//find-dialog) is not reachable from here, so the trap wraps around the
	//controls this dialog itself renders. That is strictly better than the
	//status quo of no trap at all; a full treewalk is a separate change.
	private _focusableElements() : HTMLElement[] {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) return [];
		const content = shadowRoot.querySelector('.content');
		if (!content) return [];
		const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
		return [...content.querySelectorAll(selector)].filter((ele) : ele is HTMLElement => {
			if (!(ele instanceof HTMLElement)) return false;
			//offsetParent is null for display:none subtrees, which is what the
			//?hidden'd branches of several dialogs render.
			return ele.offsetParent !== null || ele === shadowRoot.activeElement;
		});
	}

	private _handleKeyDown(e : KeyboardEvent) {
		if (e.key !== 'Tab') return;
		const focusable = this._focusableElements();
		//WCAG 2.1.2: do not trap when there is nothing to trap into. Every
		//dialog renders a close button so this is insurance, not a live case.
		if (!focusable.length) return;
		const shadowRoot = this.shadowRoot;
		const active = shadowRoot ? shadowRoot.activeElement : null;
		const index = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (e.shiftKey) {
			//Focus on the panel itself (index -1) shift-tabs to the end.
			if (index > 0) return;
			e.preventDefault();
			last.focus();
			return;
		}
		if (index !== -1 && index < focusable.length - 1) return;
		e.preventDefault();
		first.focus();
	}

	_focusInputOnOpen() {
		//Override point for sub classes

		//Make sure if there's a text field it's focused.

		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('No shadowroot');
		let input = shadowRoot.querySelector('input[type=text]');
		if (!input) input = shadowRoot.querySelector('input[type=search]');
		if (!input) input = shadowRoot.querySelector('textarea');
		//Fall back to the panel rather than leaving focus outside the dialog:
		//without this, a dialog with no text field (multi-edit,
		//configure-collection) opened with focus still on the page behind it,
		//so Tab walked the app instead of the dialog.
		if (!input) input = shadowRoot.querySelector('.content');
		if (!input) return;
		if (input instanceof HTMLElement) input.focus();
	}

	override willUpdate(changedProps : PropertyValues<this>) {
		super.willUpdate(changedProps);
		//willUpdate, NOT updated: two subclasses (ai-dialog, find-dialog)
		//override updated() without calling super, so a hook there silently
		//never runs for them — and find-dialog is the most-used dialog.
		//No dialog subclass overrides willUpdate.
		if (!changedProps.has('open')) return;
		this._syncEscapeShortcut();
		//Focus is scheduled from HERE, via updateComplete, rather than from
		//updated(). ai-dialog and find-dialog override updated() without
		//calling super, so the old hook silently never ran for them — ai-dialog
		//focused nothing at all on open. Same reasoning that moved the Escape
		//sync up here; the focus hook was left behind.
		if (this.open) {
			this._previouslyFocused = deepestActiveElement();
			this.updateComplete.then(() => {
				//Re-check: a dialog can be closed again before the frame lands.
				if (this.open) this._focusInputOnOpen();
			});
			return;
		}
		const previous = this._previouslyFocused;
		this._previouslyFocused = null;
		if (previous && previous.isConnected) previous.focus();
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'dialog-element': DialogElement;
	}
}
