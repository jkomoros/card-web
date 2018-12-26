import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
export class BaseCard extends LitElement {
  render() {
    return html`
      <style>
        :host {
          display:block;
          background-color: var(--card-color);
          height: 24.54em;
          width: 43.63em;
          box-shadow: var(--card-shadow);
          box-sizing: border-box;
          padding: 1em 1.45em;
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

        .container.editing a {
          cursor:not-allowed;
        }

        .container.editing a[target=_blank] {
          cursor:pointer;
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
