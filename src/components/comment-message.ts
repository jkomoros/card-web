import { LitElement, html, css } from 'lit';

import { store } from '../store.js';

import {
	showSnackbar
} from '../actions/app.js';
import { customElement, property } from 'lit/decorators.js';

import './author-chip.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	EDIT_ICON,
	DELETE_FOREVER_ICON,
	BASELINK_LINK_ICON,
} from '../../shared/icons.js';

import {
	prettyTime,
	markdownElement,
} from '../util.js';

import { 
	PAGE_COMMENT
} from '../actions/app.js';

import {
	ComposedCommentMessage
} from '../types.js';

import {
	makeCommentEditMessageEvent,
	makeCommentDeleteMessageEvent
} from '../events.js';

@customElement('comment-message')
class CommentMessage extends LitElement {
	
	@property({ type : Object })
		message: ComposedCommentMessage;

	static override styles = [
		ButtonSharedStyles,
		css`
			:host {
				font-size: 0.85em;
				display:block;
				border-bottom:1px solid var(--app-divider-color);
				width:100%;
				padding-bottom:0.25em;
				margin-bottom:0.25em;
			}

			.container {
				width:100%;
			}
			span {
				color: var(--app-dark-text-color-light);
			}
			.row {
				display:flex;
				flex-direction:row;
				align-items:center;
				width:100%;
			}

			.row author-chip {
				flex-grow:1;
			}
		`
	];

	override render() {
		return html`
			<div class='container'>
				<div class='row'>
					<author-chip .author=${this.message.expandedAuthor}></author-chip>
					<div ?hidden=${!this.message.mayEdit}>
						<button class='small' ?hidden=${this.message.deleted} @click=${this._handleDeleteClicked}>${DELETE_FOREVER_ICON}</button>
						<button class='small' title='Edit message' aria-label='Edit message' @click=${this._handleEditClicked}>${EDIT_ICON}</button>
					</div>
					<button class='small' @click=${this._handleLinkClicked}>${BASELINK_LINK_ICON}</button>
				</div>
				<span>${prettyTime(this.message.updated)}</span>
				<div>
					${this.message.deleted ? html`<em>This message has been deleted.</em>` : markdownElement(this.message ? this.message.message : '')}
				</div>
			</div>
		`;
	}

	_handleLinkClicked() {
		if (!this.message) return;
		const url = window.location.origin + '/' + PAGE_COMMENT + '/' + this.message.id;
		//B2: prompt() was being used as a COPY AFFORDANCE — a modal input box
		//whose only purpose was to let the user select text. navigator.clipboard
		//is already used elsewhere in this app for exactly this.
		navigator.clipboard.writeText(url).then(
			() => store.dispatch(showSnackbar('Link to this comment copied.', {kind: 'committed'})),
			//A denied permission or an insecure context is a real refusal, and
			//an unhandled rejection is how the sibling clipboard call currently
			//fails.
			() => store.dispatch(showSnackbar('That link couldn\u2019t be copied. You can copy it from the address bar after opening the comment.', {kind: 'refused'}))
		);
	}

	_handleEditClicked() {
		this.dispatchEvent(makeCommentEditMessageEvent(this.message));
	}

	_handleDeleteClicked() {
		if (!confirm('Delete this message forever? This action cannot be undone.')) {
			return;
		}
		this.dispatchEvent(makeCommentDeleteMessageEvent(this.message));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'comment-message': CommentMessage;
	}
}
