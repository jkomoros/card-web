import { LitElement, html } from '@polymer/lit-element';

import { SharedStyles } from './shared-styles.js';

export class DialogElement extends LitElement {
  render() {
    return html`
      ${SharedStyles}
      <style>
        :host {
          position:absolute;
          height:100%;
          width:100%;
          top:0;
          left:0;
          z-index:1000;
          display: ${this.open ? 'block' : 'none'}
        }

        .background {
          position:absolute;
          height:100%;
          width:100%;
          top:0;
          left:0;
          background-color:#FFFFFFCC;
          display:flex;
          flex-direction:column;
          align-items: center;
          justify-content:center;
        }

        .content {
          background-color:white;
          min-height: 40%;
          min-width: 40%;
          padding:1em;
          box-shadow: var(--card-shadow);
        }

        h2 {
          font-weight: normal;
          font-size:1.5em;
          text-align:left;
          margin:0;
        }
      </style>
    	<div class='background' @click=${this._handleBackgroundClicked}>
    		<div class='content'>
          <h2>${this.title || ""}</h2>
    			${this.innerRender()}
    		</div>
    	</div>
	`;
  }

  innerRender() {
  	//You can subclass this and return somethingelse for innerRender or use it directly with content inside.
  	return html`<slot></slot>`;
  }

  _handleBackgroundClicked(e) {
    let background = this.shadowRoot.querySelector('.background');
    //If the click wasn't actualy directly on the background then ignore it.
    if (e.composedPath()[0] != background) return;
    this._shouldClose();
  }

  _shouldClose() {
    //Override point for base classes
    this.dispatchEvent(new CustomEvent('dialog-should-close'));
  }

  static get properties() {
  	return {
  		open: {type:Boolean},
      title: {type:String},
  	}
  }

}

window.customElements.define('dialog-element', DialogElement);
