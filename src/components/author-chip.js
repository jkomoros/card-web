
import { LitElement, html } from '@polymer/lit-element';

import {
  authorForId
} from '../reducers/data.js';

class AuthorChip extends LitElement {
  render() {
    return html`
      <style>
        div {
          display:flex;
          align-items:center;
        }
        img {
          --user-image-size: 20px;
          height:var(--user-image-size);
          width: var(--user-image-size);
          border-radius:calc(var(--user-image-size) / 2);
          margin: calc(var(--user-image-size) / 4);
          cursor:pointer;
        }
        span {
          color: var(--app-dark-text-color-light);
        }
      </style>
      <div>
        <img src='${this.author.photoURL}'>
        <span>${this.author.displayName}</span>
      </div>
      `;
  }

  static get properties() {
    return {
      author: { type: Object },
    }
  }



}

window.customElements.define('author-chip', AuthorChip);
