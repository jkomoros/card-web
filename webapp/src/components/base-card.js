import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
class BaseCard extends LitElement {
  render() {
    return html`
      <style>

        @import url('https://fonts.googleapis.com/css?family=Raleway:400,700');

        :host {
          display:block;
          color:red;
          background-color: #FCFCFC;
          height: 540px;
          width: 960px;
          box-shadow: 0 1px 6px #CCC;
          
        }

        .container {
          height:100%;
          width:100%;
          box-sizing: border-box;
          margin: 23px 33px;
        }

        ::slotted(h1) {
          font-family: 'Raleway', sans-serif;
          font-weight:bold;
          color: #5e2b97;
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
