import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import {
	declareShortcut,
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
//Rises by one per dialog open, so the newest-opened dialog stacks above its
//siblings (see the .container z-index comment). card-preview sits at 10001;
//reaching it would take ~9000 opens in one session.
let nextDialogZ = 1000;

const deepestActiveElement = () : HTMLElement | null => {
	let active = document.activeElement;
	while (active && active.shadowRoot && active.shadowRoot.activeElement) {
		active = active.shadowRoot.activeElement;
	}
	return active instanceof HTMLElement ? active : null;
};

//Catalogued at module scope so the shortcut sheet knows about Escape even for a
//user who has never opened a dialog. The binding itself registers only while a
//dialog is OPEN (see _syncEscapeShortcut), so a live scan of the registry would
//show it missing exactly when the sheet is most likely to be consulted.
declareShortcut({
	id: 'dialog-escape',
	keys: SHORTCUT_COMBOS['dialog-escape'],
	label: 'Close the dialog',
	group: 'dialogs',
	focusPolicy: 'any-focus',
	handler: () => false,
});

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
				show up above it.
				Dialogs are siblings sharing one base z-index, so DOM order —
				not opening order — decided who painted on top: the composer's
				key-card picker opened find-dialog UNDER the composer, because
				find-dialog happens to come first in main-view's template. The
				host sets --dialog-z on each open so the most recently opened
				dialog stacks above the ones beneath it. */
				z-index: var(--dialog-z, 1000);
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

			/* Tab wrap points. They must be in the tab order (tabindex 0) but
			   never visible and never a scroll target. */
			.focus-sentinel {
				position: absolute;
				width: 1px;
				height: 1px;
				padding: 0;
				margin: -1px;
				overflow: hidden;
				clip-path: inset(50%);
				white-space: nowrap;
				outline: none;
			}
		`
	];

	override render() {
		return html`
			<div class='container ${this.open ? 'open' : 'closed'}'>
				<div class='background ${this.mobile ? 'mobile': ''}' @click=${this._handleBackgroundClicked}>
					<span class='focus-sentinel' tabindex='0' @focus=${this._handleSentinelStartFocused}></span>
					<div class='content' role=${this.dialogRole} aria-modal='true' aria-labelledby='dialog-title' tabindex='-1'>
						<button class='small' id='close' title='Close dialog' aria-label='Close dialog' @click=${this.cancel}>${CANCEL_ICON}</button>
						<h2 id='dialog-title'>${this.title || ''}</h2>
						<div id='inner'>
						${this.innerRender()}
						</div>
					</div>
					<span class='focus-sentinel' tabindex='0' @focus=${this._handleSentinelEndFocused}></span>
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
				group: 'dialogs',
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

	//Focusable descendants of .content, DESCENDING INTO SHADOW ROOTS.
	//
	//The obvious implementation — querySelectorAll on this shadow root, compare
	//against shadowRoot.activeElement — is wrong, and wrong in a way that is
	//worse than having no trap. shadowRoot.activeElement reports the HOST when
	//focus is inside a child custom element, so a dialog containing a tag-list
	//or a card-drawer reads "focus is nowhere in my list" and yanks it back to
	//the first control. Adversarial review measured the result: multi-edit
	//collapsed to a three-element Tab cycle, and find-dialog's "Next 250 cards"
	//button became unreachable entirely.
	private _deepFocusableElements() : HTMLElement[] {
		const shadowRoot = this.shadowRoot;
		if (!shadowRoot) return [];
		const content = shadowRoot.querySelector('.content');
		if (!content) return [];
		//summary and [contenteditable] are natively tabbable and are both
		//reachable inside dialogs (multi-edit's disclosure, the editor's body
		//fields). Omitting them made them reachable forward by native Tab but
		//never in reverse, and made "last focusable" target the wrong element.
		const selector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])';
		const result : HTMLElement[] = [];
		const visit = (root : ParentNode) => {
			for (const ele of root.querySelectorAll('*')) {
				if (!(ele instanceof HTMLElement)) continue;
				//offsetParent is null for display:none subtrees, which is what
				//the ?hidden'd branches of several dialogs render. NOTE: it is
				//also null for position:fixed elements, and visibility:hidden
				//is NOT caught by it at all. No dialog-reachable component uses
				//either today; if one does, widen this test rather than letting
				//the control silently drop out of the cycle.
				if (ele.offsetParent === null) continue;
				if (ele.matches(selector) && !ele.classList.contains('focus-sentinel')) result.push(ele);
				//Skipping hidden subtrees entirely, not just hidden elements: a
				//display:none subtree cannot contain a focusable, and descending
				//into one was pure traversal cost.
				if (ele.shadowRoot) visit(ele.shadowRoot);
			}
		};
		visit(content);
		return result;
	}

	//Tab wrapping is done with sentinels rather than by intercepting keydown,
	//because a sentinel receives focus no matter which shadow root the focus
	//came from — including one this component cannot see into.
	//
	//They are SIBLINGS of .content, not its children. As children, the start
	//sentinel sat AFTER .content in tab order, so it could not tell "wrapped
	//around from the end" from "arrived from before the panel" — clicking a
	//dialog's title (which focuses .content, since it is tabindex=-1) and
	//pressing Tab jumped to the LAST control, and Shift-Tab from .content
	//escaped the dialog entirely, past a sentinel that backward navigation
	//never reached. As siblings, Shift-Tab from .content lands on the start
	//sentinel and wraps, and a plain Tab from .content proceeds naturally to
	//the close button without any sentinel involved.
	private _handleSentinelStartFocused() {
		const focusable = this._deepFocusableElements();
		//WCAG 2.1.2: never trap when there is nothing to trap into.
		if (!focusable.length) return;
		focusable[focusable.length - 1].focus();
	}

	private _handleSentinelEndFocused() {
		const focusable = this._deepFocusableElements();
		if (!focusable.length) return;
		focusable[0].focus();
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
		//Stacking (see the .container comment): each open claims the next
		//z-index, so a dialog opened from inside another paints above it
		//regardless of where the two sit in their parent's template. The
		//counter only ever rises within a session; it would take ~9000
		//dialog opens to reach card-preview's 10001, and reload resets it.
		if (this.open) this.style.setProperty('--dialog-z', String(++nextDialogZ));
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
		if (!previous || !previous.isConnected) return;
		//ONLY hand focus back if nothing else has claimed it. Something that ran
		//while we were closing may have deliberately put focus somewhere else,
		//and stealing it back silently sends the user's next keystroke to the
		//wrong place.
		//
		//The case that proved it: Cmd-K (find-card-to-link) is
		//focusPolicy:'allow-text-fields' on purpose, so it fires from the Title
		//field too. Picking a card, or cancelling, runs restoreSelectionRange()
		//synchronously; Selection.addRange() into a contenteditable moves focus
		//to the card BODY, where the link is applied. One microtask later this
		//ran and pulled focus back to Title, so the next character the user
		//typed went into the card's title instead of its body.
		//
		//Two conditions, because "the dialog still has focus" alone is not the
		//test. shadowRoot.activeElement covers Escape and the X button. It does
		//NOT cover a backdrop click: mousedown on the non-focusable backdrop
		//blurs to <body> before @click fires, so by the time this runs the
		//dialog owns nothing and a single condition would silently drop
		//return-focus for every backdrop close. Body is the "nobody claimed it"
		//state, so it is safe to restore from — and it is NOT what the Cmd-K
		//flow leaves behind, which is the editor host.
		const shadowRoot = this.shadowRoot;
		const nobodyElseClaimedIt = document.activeElement === document.body;
		if (!nobodyElseClaimedIt && (!shadowRoot || !shadowRoot.activeElement)) return;
		previous.focus();
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'dialog-element': DialogElement;
	}
}
