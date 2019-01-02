import { LitElement, html } from '@polymer/lit-element';

import { SharedStyles } from './shared-styles.js';

// This element is *not* connected to the Redux store.
export class BaseCard extends LitElement {
  render() {
    return html`
      ${SharedStyles}
      <style>
        :host {
          display:block;
          background-color: var(--card-color);
          
          /* These 3 values are duplicated in card-view _resizeCard calculation */
          width: 43.63em;
          height: 24.54em;
          padding: 1em 1.45em;

          box-shadow: var(--card-shadow);
          box-sizing: border-box;
          line-height:1.4;
          position:relative;
        }

        .container {
          height:100%;
          width:100%;
        }

        .container.editing > *{
          opacity:0.7;
        }

        .container.editing card-link[card] {
          --card-link-cursor:not-allowed;
        }

        h1, h2, h3{
          font-family: 'Raleway', sans-serif;
          font-weight:bold;
          margin-top:0;
        }

        h1 {
          color: var(--app-primary-color);
          font-size: 1.45em;
        }

        h2 {
          color: var(--app-dark-text-color);
          font-size: 1.25em;
        }

        h3 {
          color: var(--app-dark-text-color);
          font-size: 1.1em;
        }

        h1 strong, h2 strong, h3 strong {
          color: var(--app-primary-color);
        }

        section {
          font-family: 'Source Sans Pro', sans-serif;
          font-size: 1em;
          color: var(--app-dark-text-color);
          background-color:transparent;
        }

        section.full-bleed {
          top:0;
          left:0;
          height:100%;
          width:100%;
          position:absolute;
          display:flex;
          flex-direction:column;
          justify-content:center;
          align-items:center;
        }

        .small {
          font-size:0.72em;
        }
        .loading {
          font-style:italic;
          opacity: 0.5;
        }

      </style>
      <div class="container ${this.editing ? 'editing' : ''}">
        ${this.innerRender()}
      </div>
    `;
  }

  innerRender() {
    //Subclasess override this
    return "";
  }

  static get properties() {
    return {
      editing : { type:Boolean }
    }
  }

  _handleClick(e) {
    //We only cancel link following if editing is true
    if (!this.editing) return;
    let ele = e.composedPath()[0];
    if (ele.localName != 'a') return;
    //Links that will open a new tab are fine
    if (ele.target == "_blank") return;
    e.preventDefault();

  }

  firstUpdated(changedProps) {
    this.addEventListener('click', e => this._handleClick(e))
  }

}

window.customElements.define('base-card', BaseCard);
