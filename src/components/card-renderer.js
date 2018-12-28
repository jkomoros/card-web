import { LitElement, html } from '@polymer/lit-element';

import './content-card.js';
import './section-head-card.js';

// This element is *not* connected to the Redux store.
export class CardRenderer extends LitElement {
  render() {
    return html`
      <style>
        [hidden] {
          display:none;
        }
      </style>
      <section-head-card ?hidden=${this._cardType != 'section-head'} .title=${this._title} .subtitle=${this._subtitle}></section-head-card>
      <content-card ?hidden=${this._cardType != 'content'} .editing=${this.editing} .id=${this._cardId} title="${this._title}" body="${this._body}"></content-card>
    `;
  }

  static get properties() {
    return {
      editing : { type:Boolean },
      card: { type: Object },
      _title: { type:String },
      _body: { type:String },
      _subtitle: { type:String },
      _cardType: {type:String},
      _cardId: {type: String},
    }
  }

  _normalizeCardType(cardType) {
    switch (cardType){
      case "section-head":
        return "section-head";
      case "content":
      default:
        return "content";
    }
  }

  update(changedProps) {
    if (changedProps.has('card')) {
      if (this.card) {
        this._cardType = this._normalizeCardType(this.card.card_type);
        this._title = this.card.title || '';
        this._body = this.card.body || '';
        this._subtitle = this.card.subtitle || '';
        this._cardId = this.card.id;
      } else {
        this._cardType = '';
        this._title = '';
        this._body = '';
        this._subtitle = '';
        this._cardId = '';
      }
      
    }
    super.update(changedProps);
  }

}

window.customElements.define('card-renderer', CardRenderer);
