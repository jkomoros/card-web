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
      </style>
    	<div class='background'>
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

  static get properties() {
  	return {
  		open: {type:Boolean},
      title: {type:String},
  	}
  }

}

window.customElements.define('dialog-element', DialogElement);
