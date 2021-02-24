import { LitElement, html } from '@polymer/lit-element';

import { SharedStyles } from './shared-styles.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	CANCEL_ICON
} from './my-icons.js';

export class DialogElement extends LitElement {
	render() {
		return html`
			${SharedStyles}
			${ButtonSharedStyles}
			<style>
				:host {
					position:absolute;
					height:100%;
					width:100%;
					top:0;
					left:0;
					/* Note that card-preview has a z-index higher than this to
					show up above it */
					z-index:1000;
					display: ${this.open ? 'block' : 'none'}
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

				#inner {
					flex-grow:1;
					display:flex;
					flex-direction:column;
					overflow:scroll;
				}


			</style>
			<div class='background ${this.mobileMode ? 'mobile': ''}' @click=${this._handleBackgroundClicked}>
				<div class='content'>
					<button class='small' id='close' @click=${this.cancel}>${CANCEL_ICON}</button>
					<h2>${this.title || ''}</h2>
					<div id='inner'>
					${this.innerRender()}
					</div>
				</div>
			</div>
	`;
	}

	innerRender() {
		//You can subclass this and return somethingelse for innerRender or use it directly with content inside.
		return html`<slot></slot>`;
	}

	firstUpdated() {
		window.addEventListener('keydown', e => this._handleKeyDown(e));
	}

	_handleKeyDown(e) {
		if (!this.open) return;
		if (e.key == 'Escape') {
			this.cancel();
			return true;
		}
	}

	_handleBackgroundClicked(e) {
		let background = this.shadowRoot.querySelector('.background');
		//If the click wasn't actualy directly on the background then ignore it.
		if (e.composedPath()[0] != background) return;
		this._shouldClose();
	}

	cancel() {
		this._shouldClose(true);
	}

	//Will be called with a single argument of true if cancelled
	_shouldClose() {
		//Override point for sub classes
		this.dispatchEvent(new CustomEvent('dialog-should-close'));
	}

	_focusInputOnOpen() {
		//Override point for sub classes

		//Make sure if there's a text field it's focused.

		let input = this.shadowRoot.querySelector('input[type=text]');
		if (!input) input = this.shadowRoot.querySelector('input[type=search]');
		if (!input) input = this.shadowRoot.querySelector('textarea');
		if (!input) return;
		input.focus();
	}

	static get properties() {
		return {
			open: {type:Boolean},
			title: {type:String},
			mobile: {type:Boolean},
		};
	}

	updated(changedProps) {
		if (changedProps.has('open') && this.open) {
			this._focusInputOnOpen();
		}
	}

}

window.customElements.define('dialog-element', DialogElement);
