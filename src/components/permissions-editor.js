
import { LitElement, html } from '@polymer/lit-element';

class PermissionsEditor extends LitElement {
	render() {
		return html`
			<pre>
				${JSON.stringify(this.permissions, null, 2)}
			</pre>
			`;
	}

	static get properties() {
		return {
			permissions: { type: Object },
		};
	}
}

window.customElements.define('permissions-editor', PermissionsEditor);
