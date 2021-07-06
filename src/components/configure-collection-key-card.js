import { LitElement, html } from '@polymer/lit-element';

// This element is *not* connected to the Redux store.
class ConfigureCollectionKeyCard extends LitElement {
	render() {
		return html`
			<input type='text' @change=${this._handleValueChanged} .value=${this.value}>
		`;
	}

	_handleValueChanged(e) {
		const ele = e.composedPath()[0];
		this.dispatchEvent(new CustomEvent('change-complex', {composed: true, detail: {value: ele.value}}));
	}

	static get properties() {
		return {
			value: { type: String },
		};
	}
}

window.customElements.define('configure-collection-key-card', ConfigureCollectionKeyCard);
