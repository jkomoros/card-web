
import { LitElement, html } from '@polymer/lit-element';

class TagChip  extends LitElement {
	render() {
		return html`
			<style>
				:host {
					background-color: blue;
					border-radius: 0.3em;
					font-size: 0.7em;
					padding: 0.2em;
					display: inline-block;
					color: var(--app-light-text-color);
				}
				span a {
					display:none;
				}
				span.editing a {
					display:inline;
				}
			</style>
			<span class='${this.editing ? 'editing' : ''} ${this.addition ? 'addition' : ''} ${this.deletion ? 'deletion' : ''}'>${this._displayName}<a href='#' @click=${this._handleXClicked}>X</a></span>
			`;
	}

	_handleXClicked() {
		this.dispatchEvent(new CustomEvent('remove-tag', {composed: true, detail: {tag: this.tag}}));
	}

	get _displayName() {
		if (!this.tagInfos) return this.tagName;
		let info = this.tagInfos[this.tagName];
		if (!info) return this.tagName;
		return info.title || this.tagName;
	}

	static get properties() {
		return {
			addition: {type:Boolean},
			deletion: {type:Boolean},
			tagName: { type: String },
			editing: { type: Boolean},
			tagInfos: {type:Object},
		};
	}
}

window.customElements.define('tag-chip', TagChip);
