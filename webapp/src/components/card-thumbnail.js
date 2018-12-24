import { LitElement, html } from '@polymer/lit-element';


// This is a reusable element. It is not connected to the store. You can
// imagine that it could just as well be a third-party element that you
// got from someone else.
class CardThumbnail extends LitElement {
  render() {
    return html`
      <style>

        div:hover h3 {
          color: var(--app-secondary-color);
        }

        h3 {
          color: var(--app-dark-text-color);
          text-align:center;
          font-size: 14px;
          font-family: var(--app-header-font-family);
        }

        div {
          cursor:pointer;
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

        div.section-head {
          background-color: var(--app-primary-color);
        }

        div.section-head h3 {
          color: var(--app-light-text-color);
        }

        div.section-head:hover h3 {
          color: var(--app-primary-color-light);
        }

        .empty {
          opacity:0.5;
        }

      </style>
      <div @click=${this._handleClick} class="${this.selected ? "selected" : ""} ${this.cardType}">
        <h3>${this.title ? this.title : html`<span class='empty'>[Untitled]</span>`}</h3>
      </div>
    `;
  }

  static get properties() { return {
    id: {type: String},
    name: { type:String },
    title: { type: String },
    selected: { type: Boolean },
    cardType: { type: String},
    _selectedViaClick: { type: Boolean },
  }};

  _handleClick(e) {
    e.stopPropagation();
    this._selectedViaClick = true;
    this.dispatchEvent(new CustomEvent("thumbnail-tapped", {composed:true}))
  }

  updated(changedProps) {
    if (changedProps.has('selected') && this.selected) {
      if (!this._selectedViaClick) {
        this.scrollIntoView({behavior:"auto", block:"center", });
      }
      this._selectedViaClick = false;
    }
  }

}

window.customElements.define('card-thumbnail', CardThumbnail);
