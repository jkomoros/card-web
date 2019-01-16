
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
				span.deletion {
					font-style: italic;
					text-decoration-line:line-through;
				}
				span.addition {
					font-style:italic;
				}
				span a {
					display:none;
					color: var(--app-light-text-color);
					padding: 0 0.3em;
				}
				span.editing a {
					display:inline;
				}
			</style>
			<span class='${this.editing ? 'editing' : ''} ${this.addition ? 'addition' : ''} ${this.deletion ? 'deletion' : ''}'>${this._displayName}<a href='#' @click=${this._handleXClicked}>X</a></span>
			`;
	}

	_handleXClicked(e) {
		e.preventDefault();
		if (this.deletion) {
			//In this (special) case, the user has removed us previously and so
			//now clicking again should UN-delete us, by firing an add-tag.
			this.dispatchEvent(new CustomEvent('add-tag', {composed: true, detail: {tag: this.tagName}}));
		} else {
			//the dfeault case, this will fire a remove-tag
			this.dispatchEvent(new CustomEvent('remove-tag', {composed: true, detail: {tag: this.tagName}}));
		}
		
		return false;
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
