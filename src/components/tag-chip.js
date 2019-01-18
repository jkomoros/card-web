
import { LitElement, html } from '@polymer/lit-element';
import { urlForTag } from '../actions/app';

class TagChip  extends LitElement {
	render() {
		return html`
			<style>
				:host {
					background-color: ${this._color};
					border-radius: 0.3em;
					font-size: 0.7em;
					padding: 0.2em;
					margin: 0 0.2em;
					display: inline-block;
					color: var(--app-light-text-color);
					font-weight:bold;
				}
				a.primary {
					color: var(--app-light-text-color);
					text-decoration:none;
				}
				span.editing a.primary {
					/* We'll cancel navigation, so don't make it look clikable */
					cursor:default;
				}
				span.deletion {
					font-style: italic;
					text-decoration-line:line-through;
				}
				span.addition {
					font-style:italic;
				}
				span a.delete {
					display:none;
					color: var(--app-light-text-color);
					padding: 0 0.3em;
				}
				span.editing a.delete {
					display:inline;
				}
			</style>
			<span class='${this.editing ? 'editing' : ''} ${this.addition ? 'addition' : ''} ${this.deletion ? 'deletion' : ''}'><a class='primary' href='${urlForTag(this.tagName)}' @click=${this._handleTagClicked}>${this._displayName}</a><a class='delete' href='#' @click=${this._handleXClicked}>X</a></span>
			`;
	}

	_handleTagClicked(e) {
		if (this.editing) {
			e.preventDefault();
			return false;
		}
		//Allow it go on and navigate
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

	get _color() {
		const defaultColor = '#CD5C5C';
		if (!this.tagInfos) return defaultColor;
		let info = this.tagInfos[this.tagName];
		if (!info) return defaultColor;
		return info.color || defaultColor;
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
