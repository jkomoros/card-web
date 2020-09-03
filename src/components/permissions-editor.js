
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	selectAllPermissions,
	selectAuthors
} from '../selectors.js';

import {
	EDIT_ICON
} from './my-icons.js';

class PermissionsEditor extends connect(store)(LitElement) {
	render() {
		return html`
			<style>
				.container {
					color: var(--app-dark-text-color-subtle);
				}

				.editable {
					color: var(--app-dark-text-color);
				}

				.edit {
					cursor: pointer;
				}

				svg {
					height:1.3em;
					width:1.3em;
					fill: var(--app-dark-text-color-subtle);
				}

				svg:hover {
					fill: var(--app-dark-text-color);
				}
			</style>
			<div class="container ${this._editable ? 'editable' : ''}">
				<h4>${this._title}</h4>
				${this.description ? html`<p>${this.description}</p>` : ''}
				<pre>
					${JSON.stringify(this._effectivePermissions, null, 2)}
				</pre>
				${this._editable ? html`
					<strong>Notes</strong> ${this._effectivePermissions.notes} <span class='edit' @click=${this._handleEditNotes}>${EDIT_ICON}</span>` : '' }
			</div>
			`;
	}

	static get properties() {
		return {
			//If provided, will use this
			permissions: { type: Object },
			//If provided, will title it this
			title: { type: String },
			description: { type: String},
			//If provided, will show the permissions for the given user
			uid: { type: String },
			_allPermissions: { type: Object },
			_authors: { type: Object },
		};
	}

	get _editable() {
		return !this.permissions;
	}

	get _title() {
		if (this.title) return this.title;
		const authorInfo = this._authors[this.uid];
		if (authorInfo) {
			return authorInfo.displayName + ' (' + this.uid + ')';
		}
		return this.uid || 'Generic Permissions';
	}

	get _effectivePermissions() {
		return this.permissions || this._allPermissions[this.uid];
	}

	stateChanged(state) {
		this._allPermissions = selectAllPermissions(state);
		this._authors = selectAuthors(state);
	}

	_handleEditNotes() {
		const notes = prompt('What should notes be?', this._effectivePermissions.notes);
		//TODO: actually persist
		console.log(notes);
	}
}

window.customElements.define('permissions-editor', PermissionsEditor);
