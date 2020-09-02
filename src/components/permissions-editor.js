
import { LitElement, html } from '@polymer/lit-element';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	selectAllPermissions,
	selectAuthors
} from '../selectors.js';

class PermissionsEditor extends connect(store)(LitElement) {
	render() {
		return html`
			<h4>${this._title}</h4>
			<pre>
				${JSON.stringify(this._effectivePermissions, null, 2)}
			</pre>
			`;
	}

	static get properties() {
		return {
			//If provided, will use this
			permissions: { type: Object },
			//If provided, will title it this
			title: { type: String },
			//If provided, will show the permissions for the given user
			uid: { type: String },
			_allPermissions: { type: Object },
			_authors: { type: Object },
		};
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
}

window.customElements.define('permissions-editor', PermissionsEditor);
