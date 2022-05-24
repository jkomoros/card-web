import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import './comment-message.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { 
	REPLY_ICON,
	ARROW_RIGHT_ICON,
	ARROW_DOWN_ICON,
	CHECK_CIRCLE_OUTLINE_ICON
} from './my-icons.js';

// This element is *not* connected to the Redux store.
class CommentThread extends LitElement {
	render() {
		return html`
      ${ButtonSharedStyles}
      <style>
        .container {
          padding: 0.5em;
          width: 12em;
          overflow:hidden;
          display:flex;
          flex-direction:column;
          align-items:center;
          justify-content:center;
          background-color: var(--card-color);
          box-shadow: var(--card-shadow);
          margin:0.5em;
          box-sizing:border-box;
        }
        .buttons {
          display:flex;
          flex-direction:row;
          justify-content:flex-end;
          width:100%;
        }
        .buttons.left {
          justify-content:flex-start;
        }
        .content {
          display:none;
          width:100%;
        }
        .content.expanded {
          display:block;
        }
        .flex {
          flex-grow:1;
        }
      </style>
      <div class='container'>
        <div class='buttons'>
          <div class='flex'>
            <button class='small' @click=${this._handleZippyClicked}>${this._expanded ? ARROW_DOWN_ICON : ARROW_RIGHT_ICON}</button>
          </div>
          <button class='small' title='${this.thread.mayResolve ? 'Resolve comment thread' : 'You may only resolve comment threads you started'}' ?disabled='${!this.thread.mayResolve}' @click=${this._handleResolveClicked}>${CHECK_CIRCLE_OUTLINE_ICON}</button>
        </div>
        <div class='content ${this._expanded ? 'expanded' :''}'>
          ${repeat(this.thread.messages, (message) => message.id, (item) => html`
          <comment-message .message=${item}></comment-message>`)}
          <div class='buttons'>
            <button class='small ${this.userMayComment ? '' : 'need-signin'}' title='${this.userMayComment ? 'Reply' : 'Sign in to reply'}' @click=${this._handleAddMessage}>${REPLY_ICON}</button>
          </div>
        </div>
      </div>
    `;
	}

	static get properties() {
		return {
			thread: { type: Object },
			userMayComment: {type:Boolean},
			_expanded: {type: Boolean}
		};
	}

	firstUpdated() {
		this._expanded = true;
	}

	_handleZippyClicked() {
		this._expanded = !this._expanded;
	}

	_handleResolveClicked() {
		this.dispatchEvent(new CustomEvent('resolve-thread', {composed: true, detail:{thread: this.thread}}));
	}

	_handleAddMessage() {
		if (!this.userMayComment) {
			this.dispatchEvent(new CustomEvent('show-need-signin'));
			return;
		}
		this.dispatchEvent(new CustomEvent('add-message', {composed:true, detail: {thread: this.thread}}));
	}
}

window.customElements.define('comment-thread', CommentThread);
