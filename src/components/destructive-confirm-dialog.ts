//THE IN-APP ANSWER TO confirmDestructive (src/modal.ts, #708; HOUSE-STYLE
//§3.7 Tier 1). Until this element is mounted, confirmDestructive falls back to
//the native confirm() it replaces; mounting it installs the handler, so every
//call site that already goes through the seam gets this dialog with no edit.
//
//The first call site to need it is sign-in (#789): the question "switch to the
//account you have signed in with before, and leave this device's stars and
//reading list behind?" was a native confirm, and the embedded browsers that
//block the sign-in popup also suppress native dialogs, which answered the
//question "no" on the user's behalf. A modal is the right surface — the user
//has just acted, and the answer gates what happens next — so it has to be one
//the app owns.
//
//Role 'alertdialog': the whole content IS the message, announced on open.
//The verb is a TEXT primary button, not a round icon: §3.7's rule is that the
//action button repeats the verb ("Delete card", never "OK"), and an icon
//cannot. Cancel sits to its left, bottom-right, primary last (§3.3).

import { html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { connect } from 'pwa-helpers/connect-mixin.js';

import { store } from '../store.js';

import { DialogElement } from './dialog-element.js';

import {
	ButtonSharedStyles
} from './button-shared-styles.js';

import {
	installModalHandler,
	resolveModal,
	selectModalRequests,
	uninstallModalHandler
} from '../modal.js';

import {
	ModalRequest,
	State
} from '../types.js';

type DestructiveConfirmModalRequest = Extract<ModalRequest, {kind : 'destructive-confirm'}>;

//One phrasing for irreversibility, app-wide (HOUSE-STYLE §2.7).
export const IRREVERSIBLE_PHRASING = 'This can’t be undone.';

@customElement('destructive-confirm-dialog')
class DestructiveConfirmDialog extends connect(store)(DialogElement) {

	@state()
		_request : DestructiveConfirmModalRequest | null = null;

	static override styles = [
		...DialogElement.styles,
		ButtonSharedStyles,
		css`
			p {
				margin: 0 0 1em 0;
			}
			ul {
				margin: 0 0 1em 0;
			}
			.buttons button + button {
				margin-left: 0.5em;
			}
		`
	];

	constructor() {
		super();
		this.dialogRole = 'alertdialog';
	}

	override connectedCallback() {
		super.connectedCallback();
		installModalHandler('destructive-confirm');
	}

	override disconnectedCallback() {
		//Symmetric: a mounted-then-unmounted dialog must not leave the seam
		//believing something will answer.
		uninstallModalHandler('destructive-confirm');
		super.disconnectedCallback();
	}

	override innerRender() {
		const request = this._request;
		if (!request) return html``;
		return html`
			<p>${request.what}</p>
			${request.detail && request.detail.length ? html`<ul>${request.detail.map(line => html`<li>${line}</li>`)}</ul>` : ''}
			${request.survives ? html`<p>${request.survives}</p>` : ''}
			<p>${IRREVERSIBLE_PHRASING}</p>
			<div class='buttons'>
				<button @click=${this.cancel}>Cancel</button>
				<button class='primary' @click=${this._handleConfirmClicked}>${request.verb}</button>
			</div>
		`;
	}

	_handleConfirmClicked() {
		const request = this._request;
		if (!request) return;
		resolveModal(request.id, {confirmed: true});
	}

	//Backdrop, Escape and the X all answer "no" — identically (§3.3).
	override _shouldClose() {
		const request = this._request;
		if (!request) return;
		resolveModal(request.id, {});
	}

	override stateChanged(state : State) {
		//The LAST outstanding request of this kind is the live one: requests
		//are a stack, since in-app dialogs do not block (src/modal.ts).
		const requests = selectModalRequests(state).filter((request) : request is DestructiveConfirmModalRequest => request.kind === 'destructive-confirm');
		this._request = requests.length ? requests[requests.length - 1] : null;
		this.open = Boolean(this._request);
		this.title = this._request ? this._request.title : '';
		this.mobile = state.app ? state.app.mobileMode : false;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'destructive-confirm-dialog': DestructiveConfirmDialog;
	}
}
