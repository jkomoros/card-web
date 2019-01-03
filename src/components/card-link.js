
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store so it can render visited links
import { store } from '../store.js';

class CardLink extends connect(store)(LitElement) {
  render() {
    return html`
      <style>
        :host {
          display:inline;
        }

        a {
          color: var(--app-primary-color);
        }

        a:visited {
          color: var(--app-primary-color-light);
        }

        a.card {
          color: var(--app-secondary-color);
        }

        a.card:visited, a.card.read {
          color: var(--app-secondary-color-light);
        }

        a {
          cursor: var(--card-link-cursor, pointer);
        }
      </style>
      <a class='${this.card ? 'card' : ''} ${this._read ? 'read' : ''}' href='${this._computedHref}' target='${this._computedTarget}'><slot></slot></a>`;
  }

  static get properties() {
    return {
      card: { type: String },
      href: { type: String},
      _reads: {type: Object},
    }
  }

  stateChanged(state) {
    this._reads = state.user.reads;
  }

  get _read() {
    if (!this.card) return false;
    if (!this._reads) return false;
    return this._reads[this.card] || false;
  }

  get _computedHref() {
    return this.card ? '/c/' + this.card : this.href;
  }

  get _computedTarget() {
    return this.card ? '' : '_blank';
  }

}

window.customElements.define('card-link', CardLink);
