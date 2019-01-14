
import { LitElement, html } from '@polymer/lit-element';

class TagChip  extends LitElement {
	render() {
		return html`
			<style>
				:host {
					background-color:blue;
					border-radius:0.1em;
					color:var(--app-light-text-color);
				}
				span a {
					display:none;
				}
				span.editing a {
					display:inline;
				}
			</style>
			<span class='${this.editing ? 'editing' : ''} ${this.addition ? 'addition' : ''} ${this.deletion ? 'deletion' : ''}'>${this.tagName}<a href='#' @click=${this._handleXClicked}>X</a></span>
			`;
	}

	_handleXClicked() {
		this.dispatchEvent(new CustomEvent('remove-tag', {composed: true, detail: {tag: this.tag}}));
	}

	static get properties() {
		return {
			addition: {type:Boolean},
			deletion: {type:Boolean},
			tagName: { type: String },
			editing: { type: Boolean},
		};
	}
}

window.customElements.define('tag-chip', TagChip);
