import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CANCEL_ICON
} from '../../shared/icons.js';

import {
	makeDialogShouldCloseEvent
} from '../events.js';

import {
	deepActiveElement
} from '../util.js';

@customElement('dialog-element')
export class DialogElement extends LitElement {
	_invoker: HTMLElement | null = null;
	_inertedElements: Array<{element: HTMLElement, wasInert: boolean}> = [];
	_boundHandleKeyDown = (e : KeyboardEvent) => this._handleKeyDown(e);

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
				position: fixed;
				height: 100vh;
				height: 100dvh;
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

			.container[hidden] {
				display: none;
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
				padding-bottom:max(1em, env(safe-area-inset-bottom));
			}

			h2 {
				font-weight: normal;
				font-size:1.5em;
				text-align:left;
				margin:0;
			}

			#close {
				position: absolute;
				top: 0.25em;
				right: 0.25em;
				height: 44px;
				width: 44px;
				display: grid;
				place-items: center;
				z-index: 1;
			}

			#inner {
				flex-grow:1;
				display:flex;
				flex-direction:column;
				overflow:scroll;
			}
		`
	];

	override render() {
		return html`
			<div class='container ${this.open ? 'open' : 'closed'}' ?hidden=${!this.open} aria-hidden=${!this.open}>
				<div class='background ${this.mobile ? 'mobile': ''}' @click=${this._handleBackgroundClicked}>
					<div class='content' role='dialog' aria-modal='true' aria-labelledby='dialog-title' tabindex='-1'>
						<button class='small' id='close' aria-label=${`Close ${this.title || 'dialog'}`} @click=${this.cancel}>${CANCEL_ICON}</button>
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

	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener('keydown', this._boundHandleKeyDown);
	}

	override disconnectedCallback() {
		this._setSurroundingsInert(false);
		window.removeEventListener('keydown', this._boundHandleKeyDown);
		super.disconnectedCallback();
	}

	_handleKeyDown(e : KeyboardEvent) {
		if (!this.open || e.defaultPrevented) return;
		if (e.key == 'Escape') {
			if (e.isComposing || e.keyCode === 229) return;
			e.preventDefault();
			e.stopPropagation();
			this.cancel();
			return;
		}
		if (e.key !== 'Tab') return;
		const focusable = this._focusableElements();
		if (!focusable.length) {
			e.preventDefault();
			this._dialogElement()?.focus();
			return;
		}
		const active = deepActiveElement();
		const currentIndex = focusable.indexOf(active as HTMLElement);
		if (e.shiftKey && (currentIndex <= 0)) {
			e.preventDefault();
			focusable[focusable.length - 1].focus();
		} else if (!e.shiftKey && currentIndex === focusable.length - 1) {
			e.preventDefault();
			focusable[0].focus();
		}
	}

	_dialogElement() : HTMLElement | null {
		return this.shadowRoot?.querySelector<HTMLElement>('[role="dialog"]') || null;
	}

	_focusableElements() : HTMLElement[] {
		if (!this.shadowRoot) return [];
		const selector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
		const result : HTMLElement[] = [];
		const visitElement = (child : HTMLElement) => {
			if (child.matches(selector) && !child.hidden && child.getAttribute('aria-hidden') !== 'true') result.push(child);
			if (child.shadowRoot) visit(child.shadowRoot);
			visit(child);
		};
		const visit = (root : ParentNode) => {
			for (const child of Array.from(root.children)) {
				if (!(child instanceof HTMLElement)) continue;
				if (child instanceof HTMLSlotElement) {
					for (const assigned of child.assignedElements({flatten: true})) {
						if (assigned instanceof HTMLElement) visitElement(assigned);
					}
				} else {
					visitElement(child);
				}
			}
		};
		visit(this.shadowRoot);
		return result;
	}

	_setSurroundingsInert(inert : boolean) {
		if (!inert) {
			for (const {element, wasInert} of this._inertedElements) {
				if (element.isConnected) element.inert = wasInert;
			}
			this._inertedElements = [];
			return;
		}
		this._inertedElements = [];
		let current : Node = this;
		while (current.parentNode) {
			const parent = current.parentNode;
			for (const sibling of Array.from(parent.children || [])) {
				if (sibling === current || !(sibling instanceof HTMLElement)) continue;
				this._inertedElements.push({element: sibling, wasInert: sibling.inert});
				sibling.inert = true;
			}
			current = parent instanceof ShadowRoot ? parent.host : parent;
			if (current === document.documentElement) break;
		}
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

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('open')) {
			if (this.open) {
				const active = deepActiveElement();
				this._invoker = active instanceof HTMLElement ? active : null;
				this._setSurroundingsInert(true);
				this._focusInputOnOpen();
				if (!this.shadowRoot?.activeElement) this._dialogElement()?.focus();
			} else {
				this._setSurroundingsInert(false);
				if (!this._invoker) return;
				const invoker = this._invoker;
				this._invoker = null;
				if (invoker.isConnected) invoker.focus();
			}
		}
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'dialog-element': DialogElement;
	}
}
