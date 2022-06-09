import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import './author-chip.js';

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	EDIT_ICON,
	DELETE_FOREVER_ICON,
	BASELINK_LINK_ICON,
} from './my-icons.js';

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
	makeCommentEditMessageEvent
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
						<button class='small' @click=${this._handleEditClicked}>${EDIT_ICON}</button>
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
		prompt('Share the following URL to deep link to this comment: ', url);
	}

	_handleEditClicked() {
		this.dispatchEvent(makeCommentEditMessageEvent(this.message));
	}

	_handleDeleteClicked() {
		if (!confirm('Delete this message forever? This action cannot be undone.')) {
			return;
		}
		this.dispatchEvent(new CustomEvent('delete-message', {composed: true, detail: {message: this.message}}));
	}

}

declare global {
	interface HTMLElementTagNameMap {
	  'comment-message': CommentMessage;
	}
}
