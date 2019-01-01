
import { LitElement, html } from '@polymer/lit-element';


class CardLink extends LitElement {
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

        a.card:visited {
          color: var(--app-secondary-color-light);
        }

        a {
          cursor: var(--card-link-cursor, pointer);
        }
      </style>
      <a class='${this.card ? 'card' : ''}' href='${this._computedHref}' target='${this._computedTarget}'><slot></slot></a>`;
  }

  static get properties() {
    return {
      card: { type: String },
      href: { type: String}
    }
  }

  get _computedHref() {
    return this.card ? '/c/' + this.card : this.href;
  }

  get _computedTarget() {
    return this.card ? '' : '_blank';
  }

}

window.customElements.define('card-link', CardLink);
