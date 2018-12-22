import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
class BaseCard extends LitElement {
  render() {
    return html`
      <style>

        @import url('https://fonts.googleapis.com/css?family=Raleway:400,700');
        @import url('https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700');

        :host {
          display:block;
          background-color: #FCFCFC;
          height: 540px;
          width: 960px;
          box-shadow: 0 1px 6px #CCC;
          box-sizing: border-box;
          padding: 23px 33px;
          margin:2em auto;
        }

        .container {
          height:100%;
          width:100%;

        }

        ::slotted(h1) {
          font-family: 'Raleway', sans-serif;
          font-weight:bold;
          color: var(--app-primary-color);
          margin-top:0;
        }

        ::slotted(section) {
          font-family: 'Source Sans Pro', sans-serif;
          font-size: 22px;
          color: var(--app-dark-text-color);
          background-color:transparent;
        }

        ::slotted(* a) {
          color: var(--app-secondary-color);
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
