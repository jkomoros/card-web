import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
class BaseCard extends LitElement {
  render() {
    return html`
      <style>
        :host {
          display:block;
          background-color: #FCFCFC;
          height: 540px;
          width: 960px;
          box-shadow: 0 2px 6px #CCC;
          box-sizing: border-box;
          padding: 23px 33px;
          margin:2em auto;
        }

        .container {
          height:100%;
          width:100%;

        }
      </style>
      <div class="container">
        <slot></slot>
      </div>
    `;
  }

  static get properties() {
    return {
      title: { type: String }
    }
  }
}

window.customElements.define('base-card', BaseCard);
