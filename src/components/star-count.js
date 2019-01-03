import { LitElement, html } from '@polymer/lit-element';

import {
  starIcon,
} from './my-icons.js';

import { SharedStyles } from './shared-styles.js';

class StarCount extends LitElement {
  render() {
    return html`
    ${SharedStyles}
    <style>
      :host {
        display:block;
        font-size:0.8em;
      }

      div {
        display:flex;
        flex-direction:row;
        align-items:center;
        color: var(--app-dark-text-color-light);
      }

      div.highlighted {
        color: var(--app-primary-color-light);
      }

      svg {
        height: 1em;
        width: 1em;
        fill: var(--app-dark-text-color-light);
      }
    </style>
    <div ?hidden='${!this.hasStars}' class='stars ${this.highlight ? 'highlighted' : ''}'>${starIcon} <span>${this.count}</span></div>
    `;
  }

  get hasStars() {
    return this.count && this.count > 0;
  }

  static get properties() {
    return {
      count: { type: Number },
      highlight: { type: Boolean}
    }
  }
}

window.customElements.define('star-count', StarCount);
