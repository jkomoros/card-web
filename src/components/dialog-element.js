import { LitElement, html } from '@polymer/lit-element';


class DialogElement extends LitElement {
  render() {
    return html`
    	<div class='background' ?hidden=${this.open}>
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
