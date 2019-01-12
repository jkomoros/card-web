import { LitElement, html } from '@polymer/lit-element';
import { repeat } from 'lit-html/directives/repeat';

import './comment-message.js';

import { ButtonSharedStyles } from './button-shared-styles.js';
import { 
  replyIcon,
  arrowRightIcon,
  arrowDownIcon,
  checkCircleOutlineIcon
} from './my-icons.js';

import {
  userMayResolveThread
} from '../selectors.js';

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
            <button class='small' @click=${this._handleZippyClicked}>${this._expanded ? arrowDownIcon : arrowRightIcon}</button>
          </div>
          <button class='small' title='${userMayResolveThread(this.user, this.thread) ? 'Resolve comment thread' : 'You may only resolve comment threads you started'}' ?disabled='${!userMayResolveThread(this.user, this.thread)}' @click=${this._handleResolveClicked}>${checkCircleOutlineIcon}</button>
        </div>
        <div class='content ${this._expanded ? 'expanded' :''}'>
          ${repeat(this.thread.messages, (message) => message.id, (item, index) => html`
          <comment-message .message=${item} .user=${this.user}></comment-message>`)}
          <div class='buttons'>
            <button class='small ${this.userMayComment ? '' : 'need-signin'}' title='${this.userMayComment ? 'Reply' : 'Sign in to reply'}' @click=${this._handleAddMessage}>${replyIcon}</button>
          </div>
        </div>
      </div>
    `;
  }

  static get properties() {
    return {
      thread: { type: Object },
      userMayComment: {type:Boolean},
      user: { type: String },
      _expanded: {type: Boolean}
    }
  }

  firstUpdated() {
    this._expanded = true;
  }

  _handleZippyClicked(e) {
    this._expanded = !this._expanded;
  }

  _handleResolveClicked(e) {
    this.dispatchEvent(new CustomEvent('resolve-thread', {composed: true, detail:{thread: this.thread}}));
  }

  _handleAddMessage(e) {
    if (!this.userMayComment) {
      this.dispatchEvent(new CustomEvent('show-need-signin'));
      return;
    }
    this.dispatchEvent(new CustomEvent('add-message', {composed:true, detail: {thread: this.thread}}));
  }
}

window.customElements.define('comment-thread', CommentThread);
