import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { connect } from 'pwa-helpers/connect-mixin.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

import {
	selectAllPermissions,
	selectAuthors,
	selectUserPermissionsForCardsMap,
	selectTagInfosForCards
} from '../selectors.js';

import {
	EDIT_ICON,
	DELETE_FOREVER_ICON
} from './my-icons.js';

import {
	updateUserNote,
	addEnabledPermission,
	clearPermission,
	deletePermissionsObjectForUser,
	removeUserPermissionFromCard,
	selectCardToAddPermissionTo
} from '../actions/permissions.js';

import {
	PERMISSIONS_INFO,
	PERMISSIONS_LEGAL_ON_CARD_INFO
} from '../permissions.js';

import './tag-list.js';

import {
	State,
	Uid,
	UserPermissions,
	UserPermissionsMap,
	UserPermissionsForCards,
	AuthorsMap,
	TagInfos
} from '../types.js';

import {
	TagEvent
} from '../events.js';

import {
	TypedObject
} from '../typed_object.js';

const ALL_PERMISSIONS = Object.fromEntries(Object.entries(PERMISSIONS_INFO).map(entry => [entry[0], {...entry[1], id: entry[0], title:entry[1].displayName, suppressLink:true}]));
const MODIFIABLE_PERMISSIONS = Object.fromEntries(Object.entries(ALL_PERMISSIONS).filter(entry => !entry[1].locked));
const LOCKED_PERMISSIONS = Object.fromEntries(Object.entries(ALL_PERMISSIONS).filter(entry => entry[1].locked));

@customElement('permissions-editor')
class PermissionsEditor extends connect(store)(LitElement) {

	@property({ type : Object })
		permissions: UserPermissions;
	
	//If provided, will title it this
	@property({ type : String })
	override title: string;

	@property({ type : String })
		description: string;

	//If provided, will show the permissions for the given user
	@property({ type : String })
		uid: Uid;

	@state()
		_allPermissions: UserPermissionsMap;

	@state()
		_userPermissionsForCardsMap: UserPermissionsForCards;

	@state()
		_authors: AuthorsMap;

	@state()
		_tagInfosForCards: TagInfos;

	static override styles = [
		css`
			:host {
				display: block;
				margin-top: 1em;
			}

			p {
				margin: 0;
			}

			.container {
				color: var(--app-dark-text-color-subtle);
			}

			.editable {
				color: var(--app-dark-text-color);
			}

			.edit {
				cursor: pointer;
			}

			[hidden] {
				display: none;
			}

			div {
				margin-left: 1em;
			}

			svg {
				height:1.3em;
				width:1.3em;
				fill: var(--app-dark-text-color-subtle);
			}

			svg:hover {
				fill: var(--app-dark-text-color);
			}

			tag-list {
				display: inline-block;
			}
		`
	];

	override render() {
		const lockedPermissionColor = '#7f7f7f';
		const enabledPermissionColor = '#006400'; //darkgreen

		return html`
			<div class="container ${this._editable ? 'editable' : ''}">
				<p><strong>${this._title}</strong> ${this.description ? html`<em>${this.description}</em>` : ''}&nbsp;&nbsp;&nbsp;<strong>Notes</strong> ${this._effectivePermissions.notes || html`<em>No notes</em>`} <span class='edit' ?hidden=${!this._editable} @click=${this._handleEditNotes}>${EDIT_ICON}</span><span class='edit' ?hidden=${!this._editable} @click=${this._handleDelete}>${DELETE_FOREVER_ICON}</span></p>
				<tag-list .tags=${this._enabledLockedPermissions} .tagInfos=${LOCKED_PERMISSIONS} .overrideTypeName=${'Permission'} .defaultColor=${lockedPermissionColor} .hideOnEmpty=${true}></tag-list>
				<tag-list .tags=${this._enabledModifiablePermissions} .tagInfos=${MODIFIABLE_PERMISSIONS} .editing=${this._editable} .disableNew=${true} @tag-added=${this._handleAddEnabled} @tag-removed=${this._handleRemove} .overrideTypeName=${'Permission'} .defaultColor=${enabledPermissionColor}></tag-list>
				<div>
					<p><strong>Cards</strong> <em>These are permissions that are specific to an individual card.</em></p>
		${Object.entries(this._effectivePermissionsForCards).map(entry => 
		html`<span>${entry[0]}</span> <tag-list data-permission=${entry[0]} .tags=${entry[1]} .tagInfos=${this._tagInfosForCards} .tapEvents=${true} .editing=${true} .disableAdd=${true} @tag-removed=${this._handleRemoveCardPermission}></tag-list> <button @click=${this._handleAddCardPermission} data-permission=${entry[0]}>+</button>`)}
				${this._unusedCardPermissions.length && this.uid ? 
		html`<select @change=${this._handleAddPermissionType}>
						<option value=''><em>Add a cards permission type...</option>
						${this._unusedCardPermissions.map(item => html`<option value=${item}>${item}</option>`)}
					</select>` : ''}
				</div>
			</div>
			`;
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
		return this.permissions || this._allPermissions[this.uid] || {};
	}

	get _effectivePermissionsForCards() {
		return this._userPermissionsForCardsMap[this.uid] || {};
	}

	get _unusedCardPermissions() {
		//the card permissions that aren't currently showing for this uid but could be
		const effectivePerms = this._effectivePermissionsForCards;
		return TypedObject.keys(PERMISSIONS_LEGAL_ON_CARD_INFO).filter(key => !effectivePerms[key]);
	}

	get _enabledModifiablePermissions() {
		return Object.entries(this._effectivePermissions).filter(entry => entry[1]).map(entry => entry[0]).filter(item => MODIFIABLE_PERMISSIONS[item]);
	}

	get _enabledLockedPermissions() {
		return Object.entries(this._effectivePermissions).filter(entry => entry[1]).map(entry => entry[0]).filter(item => LOCKED_PERMISSIONS[item]);
	}

	override stateChanged(state : State) {
		this._allPermissions = selectAllPermissions(state);
		this._authors = selectAuthors(state);
		this._userPermissionsForCardsMap = selectUserPermissionsForCardsMap(state);
		this._tagInfosForCards = selectTagInfosForCards(state);
	}

	_handleAddPermissionType(e : Event) {
		const ele = e.composedPath()[0];
		if (!(ele instanceof HTMLSelectElement)) throw new Error('not select element');
		if (!ele.value) return;
		const value = ele.value;
		//Set it back to default
		ele.value = '';
		store.dispatch(selectCardToAddPermissionTo(value, this.uid));
	}

	_handleEditNotes() {
		if (!this._editable) return;
		const notes = prompt('What should notes be?', this._effectivePermissions.notes);
		store.dispatch(updateUserNote(this.uid, notes));
	}

	_handleAddEnabled(e : TagEvent){
		store.dispatch(addEnabledPermission(this.uid, e.detail.tag));
	}

	_handleRemove(e : TagEvent){
		store.dispatch(clearPermission(this.uid, e.detail.tag));
	}

	_handleDelete() {
		if (Object.keys(this._effectivePermissions).length > 0) {
			if (!confirm('There are some permissions in this user still. Do you want to delete?')) return;
		}
		store.dispatch(deletePermissionsObjectForUser(this.uid));
	}

	_handleAddCardPermission(e : MouseEvent) {
		const button = e.composedPath()[0];
		if (!(button instanceof HTMLButtonElement)) throw new Error('not button element');
		store.dispatch(selectCardToAddPermissionTo(button.dataset.permission, this.uid));
	}

	_handleRemoveCardPermission(e : TagEvent) {
		let tagList = null;
		for (const ele of e.composedPath()) {
			if (!(ele instanceof HTMLElement)) continue;
			if (ele.localName == 'tag-list') {
				tagList = ele;
				break;
			}
		}
		if (!tagList) {
			console.warn('Couldn\'t find tag list');
			return;
		}
		store.dispatch(removeUserPermissionFromCard(e.detail.tag, tagList.dataset.permission, this.uid));
	}

}

declare global {
	interface HTMLElementTagNameMap {
		'permissions-editor': PermissionsEditor;
	}
}
