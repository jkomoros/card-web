import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
class BaseCard extends LitElement {
  render() {
    return html`
      <style>
        :host {
          display:block;
          color:red;
          background-color: #F3F3F3;
          height: 540px;
          width: 960px;
          box-shadow: 0 2px 5px #CCC;
          
        }

        .container {
          height:100%;
          width:100%;
          box-sizing: border-box;
          margin: 23px 33px;
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
