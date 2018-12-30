import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import './comment-message.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { 
  replyIcon,
  arrowRightIcon,
  arrowDownIcon
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
        comment-message {
          border-bottom:1px solid var(--app-divider-color);
          width:100%;
          padding-bottom:0.5em;
          margin-bottom:0.5em;
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
        }
        .content.expanded {
          display:block;
        }
      </style>
      <div class='container'>
        <div class='buttons left'>
          <button class='small' @click=${this._handleZippyClicked}>${this._expanded ? arrowDownIcon : arrowRightIcon}</button>
        </div>
        <div class='content ${this._expanded ? 'expanded' :''}'>
          ${repeat(this.thread.messages, (message) => message.id, (item, index) => html`
          <comment-message .message=${item}></comment-message>`)}
          <div class='buttons'>
            <button class='small' ?disabled='${!this.userMayComment}' title='${this.userMayComment ? 'Reply' : 'Sign in to reply'}' @click=${this._handleAddMessage}>${replyIcon}</button>
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
    }
  }

  firstUpdated() {
    this._expanded = true;
  }

  _handleZippyClicked(e) {
    this._expanded = !this._expanded;
  }

  _handleAddMessage(e) {
    let message = prompt("What is your reply?");
    if (!message) return;
    this.dispatchEvent(new CustomEvent('add-message', {composed:true, detail: {message: message, thread: this.thread}}));
  }
}

window.customElements.define('comment-thread', CommentThread);
