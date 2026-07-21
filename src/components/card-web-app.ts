import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { setPassiveTouchGestures } from '@polymer/polymer/lib/utils/settings.js';
import { connect } from 'pwa-helpers/connect-mixin.js';
import { installOfflineWatcher } from 'pwa-helpers/network.js';
import { installMediaQueryWatcher } from 'pwa-helpers/media-query.js';
import { installRouter } from 'pwa-helpers/router.js';
import { updateMetadata } from 'pwa-helpers/metadata.js';

import { APP_TITLE } from '../config.GENERATED.SECRET.js';

// This element is connected to the Redux store.
import { store } from '../store.js';

// These are the actions needed by this element.
import {
	navigated,
	updateOffline,
	turnMobileMode,
	ctrlKeyPressed,
	PAGE_BASIC_CARD,
} from '../actions/app.js';

// These are the elements needed by this element.
import './snack-bar.js';
import './corpus-ownership-gate.js';
import { pageRequiresMainView } from '../util.js';

import {
	selectActiveCard,
	selectCardModificationError,
	selectEditingCardHasUnsavedChanges,
	selectPendingDeletions,
	selectPendingModificationCount,
	selectUid,
} from '../selectors.js';

import {
	Card,
	State
} from '../types.js';

@customElement('card-web-app')
class CardWebApp extends connect(store)(LitElement) {

	@state()
		_card: Card | null;

	@state()
		_page: string;

	@state()
		_snackbarOpened: boolean;

	@state()
		_offline: boolean;

	@state()
		_updateRegistration : ServiceWorkerRegistration | null = null;

	@state()
	_unsafeExitReason = '';

	@state()
	_draftAvailable = false;

	@state()
	_draftBusy = false;

	@state()
	_draftError = '';

	@state()
	_saveStatus : 'idle' | 'saving' | 'paused' = 'idle';

	@state()
	_saveError = '';

	private _updateReloading = false;
	private _lastDraftUid = '';
	private _updateEventHandler = (event : Event) => {
		const registration = (event as CustomEvent<ServiceWorkerRegistration>).detail;
		if (registration) this._updateRegistration = registration;
	};
	private _beforeUnloadHandler = (event : BeforeUnloadEvent) => {
		if (!this._unsafeExitReason) return;
		event.preventDefault();
		event.returnValue = '';
	};
	private _draftEventHandler = () => { void this._refreshDraftAvailability(); };

	static override styles = [
		css`
			:host {
				--app-drawer-width: 256px;
				display: block;

				--app-primary-color: #5e2b97;
				--app-primary-color-light: #bc9ae2;
				--app-primary-color-subtle: #7e57c2;
				--app-primary-color-light-transparent: #bc9ae266;
				--app-primary-color-light-somewhat-transparent: hsla(268, 55%, 75%, 0.5);
				--app-primary-color-light-very-transparent: hsla(268, 55%, 75%, 0.15);
				--app-secondary-color: hsl(174, 100%, 29%);
				--app-secondary-color-light: hsl(174, 100%, 43%);
				--app-secondary-color-light-somewhat-transparent: hsla(174, 100%, 43%, 0.5);
				--app-secondary-color-light-very-transparent: hsla(174, 100%, 43%, 0.15);
				--app-warning-color: #CC0000;
				--app-warning-color-light: #EE0000;

				/* note: this is also replicated in index.TEMPLATE.html */
				--app-dark-text-color: #7f7f7f;
				--app-light-text-color: white;
				--app-section-even-color: #f7f7f7;
				--app-section-odd-color: white;

				--app-dark-text-color-light: #AAA;
				--app-dark-text-color-subtle: #CCC;
				--app-divider-color: #eee;

				--app-header-font-family: 'Raleway';
				--app-default-font-family: 'Source Sans Pro';

				/* these are where you change the color for card.
				card-renderer's overflow scrolling expects these to be set */
				--card-color-rgb-inner: 252, 252, 252;
				--unpublished-card-color-rgb-inner: 238, 238, 238;
				--card-overflow-shadow-rgb-inner: 0, 0, 0;

				/* change the *-rgb-inner instead of these directly */
				--card-color: rgb(var(--card-color-rgb-inner));
				--unpublished-card-color: rgb(var(--unpublished-card-color-rgb-inner));

				--shadow-color: #CCC;
				--card-shadow-first-part: 0 2px 6px;
				--card-shadow: var(--card-shadow-first-part) var(--shadow-color);

				--canvas-color: var(--app-divider-color);

				--app-header-background-color: white;
				--app-header-text-color: var(--app-dark-text-color);
				--app-header-selected-color: var(--app-primary-color);

				--app-drawer-background-color: var(--app-secondary-color);
				--app-drawer-text-color: var(--app-light-text-color);
				--app-drawer-selected-color: #78909C;

				--transition-fade: 0.25s linear;
			}
			.update-ready {
				position: fixed;
				right: 0.75rem;
				bottom: 0.75rem;
				z-index: 950;
				display: flex;
				align-items: center;
				gap: 0.65rem;
				padding: 0.55rem 0.7rem;
				border-radius: 0.45rem;
				background: white;
				box-shadow: 0 2px 12px rgb(0 0 0 / 20%);
				font: 0.85rem var(--app-default-font-family, sans-serif);
			}
			.update-ready button {
				border: 0;
				border-radius: 0.3rem;
				padding: 0.4rem 0.6rem;
				background: var(--app-primary-color);
				color: white;
				font: inherit;
				font-weight: 600;
				cursor: pointer;
			}
			.update-ready button[disabled] { opacity: 0.55; cursor: not-allowed; }
			.draft-recovery { bottom: 4.25rem; }
			.draft-recovery .discard { background: transparent; color: inherit; text-decoration: underline; }
			.draft-error { color: var(--app-warning-color-light); }
			.save-status {
				position: fixed;
				left: 0.75rem;
				bottom: 0.75rem;
				z-index: 940;
				display: flex;
				align-items: center;
				gap: 0.4rem;
				padding: 0.25rem 0.45rem;
				border-radius: 1rem;
				background: rgba(255, 255, 255, 0.94);
				box-shadow: 0 1px 5px rgba(0, 0, 0, 0.18);
				font: 0.78rem var(--app-default-font-family);
				color: var(--app-dark-text-color);
			}
			.save-dot { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--app-secondary-color); }
			.save-status.paused .save-dot { background: var(--app-warning-color); }
			.save-status button { border: 0; background: transparent; color: var(--app-primary-color); text-decoration: underline; cursor: pointer; font: inherit; }
		`
	];

	override render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<main-view .active=${pageRequiresMainView(this._page)}></main-view>
		<basic-card-view .active=${this._page == PAGE_BASIC_CARD}></basic-card-view>
		<snack-bar .active="${this._snackbarOpened}">
				You are now ${this._offline ? 'offline' : 'online'}.</snack-bar>
		${this._updateRegistration ? html`
			<div class='update-ready' role='status' aria-live='polite'>
				<span>${this._unsafeExitReason ? `Update ready — ${this._unsafeExitReason}` : 'Update ready'}</span>
				<button ?disabled=${Boolean(this._unsafeExitReason) || this._updateReloading} @click=${this._activateUpdate}>Reload</button>
			</div>` : ''}
		${this._draftAvailable ? html`
			<div class='update-ready draft-recovery' role='alert' aria-live='assertive'>
				<span>${this._draftError || 'An unsaved card draft is available.'}</span>
				<button ?disabled=${this._draftBusy} @click=${this._recoverDraft}>Recover</button>
				<button class='discard' ?disabled=${this._draftBusy} @click=${this._discardDraft}>Discard</button>
			</div>` : ''}
		${this._saveStatus !== 'idle' ? html`
			<div class='save-status ${this._saveStatus}' role='status' aria-live='polite' title=${this._saveError}>
				<span class='save-dot' aria-hidden='true'></span>
				<span>${this._saveStatus === 'saving' ? 'Saving card…' : 'Save paused'}</span>
				${this._saveStatus === 'paused' ? html`
					<button @click=${this._retrySave}>Retry</button>
					<button @click=${this._stopRetryingSave}>Stop retrying</button>
				` : ''}
			</div>` : ''}
		<corpus-ownership-gate></corpus-ownership-gate>
		`;
	}

	get appTitle() {
		return APP_TITLE;
	}

	constructor() {
		super();
		// To force all event listeners for gestures to be passive.
		// See https://www.polymer-project.org/3.0/docs/devguide/settings#setting-passive-touch-gestures
		setPassiveTouchGestures(true);
	}

	_handleKeyDown(e : KeyboardEvent) {
		if (e.key == 'Meta' || e.key == 'Control') {
			store.dispatch(ctrlKeyPressed(true));
		}
	}

	_handleKeyUp(e : KeyboardEvent) {
		if (e.key == 'Meta' || e.key == 'Control') {
			store.dispatch(ctrlKeyPressed(false));
		}
	}

	_handleBlur() {
		//system-wide key combionations like Cmd-Tab will make the window lose
		//focus. So we'll see a keydown for Ctrl, but never a key up, which
		//would mean that we'd just still think Ctrl was pressed. If we lose
		//focus, make sure we know that Ctrl isn't pressed. It's OK to send this
		//because it won't have a state modification unless it needs one.
		store.dispatch(ctrlKeyPressed(false));
	}

	private _activateUpdate = () => {
		if (!this._updateRegistration?.waiting || this._unsafeExitReason || this._updateReloading) return;
		this._updateReloading = true;
		let reloaded = false;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (reloaded) return;
			reloaded = true;
			window.location.reload();
		}, {once: true});
		this._updateRegistration.waiting.postMessage({type: 'SKIP_WAITING'});
	};

	private _refreshDraftAvailability = async () => {
		const {readEditDraft} = await import('../edit-draft.js');
		const draft = readEditDraft();
		const state = store.getState() as State;
		this._draftAvailable = Boolean(draft && draft.uid === selectUid(state) && !state.editor?.editing);
		if (!this._draftAvailable) this._draftError = '';
	};

	private _recoverDraft = async () => {
		this._draftBusy = true;
		this._draftError = '';
		try {
			const {recoverEditDraft} = await import('../edit-draft.js');
			await recoverEditDraft();
		} catch (error) {
			this._draftError = error instanceof Error ? error.message : String(error);
		} finally {
			this._draftBusy = false;
			await this._refreshDraftAvailability();
		}
	};

	private _discardDraft = async () => {
		if (!confirm('Permanently discard this unsaved draft?')) return;
		const {clearEditDraft} = await import('../edit-draft.js');
		clearEditDraft();
	};

	private _retrySave = async () => {
		const {retryPendingBulkTagOperation} = await import('../actions/data.js');
		store.dispatch(retryPendingBulkTagOperation());
	};

	private _stopRetryingSave = async () => {
		const {abandonPendingBulkTagOperation} = await import('../actions/data.js');
		store.dispatch(abandonPendingBulkTagOperation());
		//The original draft deliberately survives until a server-confirmed save.
		//Once the durable retry is stopped, surface that draft so the user can
		//recover it, change the now-invalid edit, and try again.
		await this._refreshDraftAvailability();
	};

	override firstUpdated() {
		// Install recovery only after the root module graph has initialized.
		// Running actions/data's watcher during store construction would execute
		// a circular module before all of its bindings exist.
		void import('../actions/data.js').then(module => module.installBulkTagResumeWatcher());
		void import('../edit-draft.js').then(module => {
			module.installEditDraftWatcher();
			void this._refreshDraftAvailability();
		});
		installRouter((location) => store.dispatch(navigated(location.pathname, location.search)));
		installOfflineWatcher((offline) => store.dispatch(updateOffline(offline)));
		installMediaQueryWatcher('(max-width: 900px)',(isMobile) => {
			store.dispatch(turnMobileMode(isMobile));
		});
		document.addEventListener('keydown', this._handleKeyDown.bind(this));
		document.addEventListener('keyup', this._handleKeyUp.bind(this));
		window.addEventListener('blur', this._handleBlur.bind(this));
		window.addEventListener('card-web-service-worker-update', this._updateEventHandler);
		window.addEventListener('beforeunload', this._beforeUnloadHandler);
		window.addEventListener('card-web-edit-draft-changed', this._draftEventHandler);
		if (window.CARD_WEB_SW_UPDATE_REGISTRATION) this._updateRegistration = window.CARD_WEB_SW_UPDATE_REGISTRATION;
	}

	override disconnectedCallback() {
		window.removeEventListener('card-web-service-worker-update', this._updateEventHandler);
		window.removeEventListener('beforeunload', this._beforeUnloadHandler);
		window.removeEventListener('card-web-edit-draft-changed', this._draftEventHandler);
		super.disconnectedCallback();
	}

	override updated(changedProps : PropertyValues<this>) {
		if (changedProps.has('_card') && this._card) {
			const pageTitle = (this._card.title ? this._card.title + ' - ' : '') + this.appTitle ;
			updateMetadata({
				title: pageTitle,
				description: pageTitle
				// This object also takes an image property, that points to an img src.
			});
		}
	}

	override stateChanged(state : State) {
		this._card = selectActiveCard(state);
		this._page = state.app.page;
		this._offline = state.app.offline;
		this._snackbarOpened = state.app.snackbarOpened;
		const uid = selectUid(state);
		if (uid !== this._lastDraftUid) {
			this._lastDraftUid = uid;
			void this._refreshDraftAvailability();
		}
		let hasDurableBulkIntent = false;
		let hasDurableSingleIntent = false;
		try {
			const genericIntent = localStorage.getItem('card-web-pending-multi-edit-v1');
			if (genericIntent) {
				try { hasDurableSingleIntent = JSON.parse(genericIntent).kind === 'single'; } catch { /* surfaced by resume */ }
			}
			hasDurableBulkIntent = Boolean(
				localStorage.getItem('card-web-pending-bulk-tag-operation-v1') ||
				genericIntent
			);
		} catch {
			//A browser that denies durable storage is already rejected when a bulk
			//operation tries to persist. Do not make ordinary rendering fail too.
		}
		this._unsafeExitReason = selectEditingCardHasUnsavedChanges(state)
			? 'save or cancel your draft first'
			: selectPendingModificationCount(state) > 0 || state.data?.pendingReorder || Object.values(selectPendingDeletions(state)).some(Boolean) || hasDurableBulkIntent
				? 'wait for pending changes to finish'
				: '';
		const saveError = selectCardModificationError(state);
		this._saveStatus = hasDurableSingleIntent
			? saveError ? 'paused' : 'saving'
			: 'idle';
		this._saveError = saveError?.message || '';
	}
}

declare global {
	interface Window {
		CARD_WEB_SW_UPDATE_REGISTRATION? : ServiceWorkerRegistration;
	}
	interface HTMLElementTagNameMap {
		'card-web-app': CardWebApp;
	}
}
