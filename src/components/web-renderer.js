import { html, LitElement } from '@polymer/lit-element';

export class WebRenderer extends LitElement {
	render() {
		return html`
			<pre>
				${JSON.stringify(this.webInfo,'', 2)}
			</pre>
	`;
	}

	static get properties() {
		return {
			//as returned from e.g. collection.webInfo
			webInfo: {type:Object},
		};
	}

}

window.customElements.define('web-renderer', WebRenderer);
