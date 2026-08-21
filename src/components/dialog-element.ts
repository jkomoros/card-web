import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	registerShortcut,
	DIALOG_SHORTCUT_PRIORITY
} from '../shortcuts.js';

import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CANCEL_ICON
} from '../../shared/icons.js';

import {
	makeDialogShouldCloseEvent
} from '../events.js';

@customElement('dialog-element')
export class DialogElement extends LitElement {

	@property({ type : Boolean })
		open: boolean;

	@property({ type : String })
	override title: string;

	@property({ type : Boolean })
		mobile: boolean;

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
		`
	];

	override render() {
		return html`
			<div class='container ${this.open ? 'open' : 'closed'}'>
				<div class='background ${this.mobile ? 'mobile': ''}' @click=${this._handleBackgroundClicked}>
					<div class='content'>
						<button class='small' id='close' @click=${this.cancel}>${CANCEL_ICON}</button>
						<h2>${this.title || ''}</h2>
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
				keys: {key: 'Escape'},
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

	_focusInputOnOpen() {
		//Override point for sub classes

		//Make sure if there's a text field it's focused.

		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) throw new Error('No shadowroot');
		let input = shadowRoot.querySelector('input[type=text]');
		if (!input) input = shadowRoot.querySelector('input[type=search]');
		if (!input) input = shadowRoot.querySelector('textarea');
		if (!input) return;
		if (input instanceof HTMLElement) input.focus();
	}

	override willUpdate(changedProps : PropertyValues<this>) {
		super.willUpdate(changedProps);
		//willUpdate, NOT updated: two subclasses (ai-dialog, find-dialog)
		//override updated() without calling super, so a hook there silently
		//never runs for them — and find-dialog is the most-used dialog.
		//No dialog subclass overrides willUpdate.
		if (changedProps.has('open')) this._syncEscapeShortcut();
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('open') && this.open) {
			this._focusInputOnOpen();
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'dialog-element': DialogElement;
	}
}
