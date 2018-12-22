import { LitElement, html } from '@polymer/lit-element';


// This is a reusable element. It is not connected to the store. You can
// imagine that it could just as well be a third-party element that you
// got from someone else.
class CardThumbnail extends LitElement {
  render() {
    return html`
      <style>
        h3 {
          color: var(--app-dark-text-color);
          text-align:center;
          font-size: 14px;
        }
        div {
          padding: 0.5em;
          height: 6em;
          width: 12em;
          overflow:hidden;
          display:flex;
          align-items:center;
          justify-content:center;
          background-color: var(--card-color);
          box-shadow: var(--card-shadow);
          margin:0.5em;
        }
        .selected h3 {
          color: var(--app-primary-color);
        }
      </style>
      <div class="${this.selected ? "selected" : ""}">
        <h3>${this.title}</h3>
      </div>
    `;
  }

  static get properties() { return {
    /* The total number of clicks you've done. */
    title: { type: String },
    selected: { type: Boolean }
  }};

  updated(changedProps) {
    if (changedProps.has('selected') && this.selected) {
      this.scrollIntoView({behavior:"auto", block:"center"});
    }
  }

}

window.customElements.define('card-thumbnail', CardThumbnail);
