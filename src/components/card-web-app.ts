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
	closeSnackbar,
	turnMobileMode,
	ctrlKeyPressed,
	PAGE_BASIC_CARD,
} from '../actions/app.js';

// These are the elements needed by this element.
import './snack-bar.js';
import './corpus-ownership-gate.js';
import { pageRequiresMainView } from '../util.js';

import {
	collectionReceiptCanUndo,
	currentBrowserLocation,
} from '../collection-composer-receipt.js';

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

import {
	inFlightMutationCount
} from '../mutation-barrier.js';

const SERVICE_WORKER_UPDATE_CHANNEL = 'card-web-service-worker-update-v1';

@customElement('card-web-app')
class CardWebApp extends connect(store)(LitElement) {

	@state()
		_card: Card | null;

	@state()
		_page: string;

	@state()
		_snackbarOpened: boolean;

	@state()
		_snackbarMessage: string;

	@state()
		_snackbarAction: '' | 'back';

	@state()
		_snackbarExpectedLocation: string;

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

	@state()
	_saveIsMulti = false;

	@state()
	private _updateReloading = false;

	@state()
	private _updateActivated = false;

	//Drives .editor-open below. The editor's Save/Cancel row is fixed in the
	//same bottom-right corner these banners use.
	@state()
	private _editorOpen = false;

	private _lastDraftUid = '';
	private _updateActivationTimeout : number | undefined;
	private _updateChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SERVICE_WORKER_UPDATE_CHANNEL);
	private _updateEventHandler = (event : Event) => {
		const registration = (event as CustomEvent<ServiceWorkerRegistration>).detail;
		if (registration) {
			this._updateActivated = false;
			this._updateRegistration = registration;
		}
	};
	private _currentUnsafeExitReason = () => this._unsafeExitReason ||
		(inFlightMutationCount() > 0 ? 'wait for the current change to finish' : '');
	private _beforeUnloadHandler = (event : BeforeUnloadEvent) => {
		if (!this._currentUnsafeExitReason()) return;
		event.preventDefault();
		event.returnValue = '';
	};
	private _draftEventHandler = () => { void this._refreshDraftAvailability(); };
	private _durableStorageHandler = (event : StorageEvent) => {
		if (event.key === 'card-web-pending-multi-edit-v1' || event.key === 'card-web-pending-bulk-tag-operation-v1') {
			this.stateChanged(store.getState() as State);
		}
	};
	private _updateChannelHandler = (event : MessageEvent) => {
		if (event.data?.type !== 'activating') return;
		this._updateActivated = true;
		this._waitForUpdatedController();
	};
	private _controllerChangeHandler = () => {
		if (this._updateActivationTimeout !== undefined) window.clearTimeout(this._updateActivationTimeout);
		this._updateActivationTimeout = undefined;
		this._updateActivated = true;
		this._updateReloading = false;
		//Activation affects the entire origin. Reload this client only when its
		//own dirty/pending checks still pass; otherwise retain the banner until
		//the user finishes the protected work.
		if (!this._currentUnsafeExitReason()) window.location.reload();
	};

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
				/* Between the live teal and the warning red: "your change has
				not reached the server yet". Used by the corpus status
				indicator's pending layer. 4.6:1 on white. */
				--app-pending-color: #b26a00;

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
				/* Clears the comments panel's round add-comment button, which
				   lives in exactly this corner (44px wide at right:1em) and
				   was sitting underneath these banners. */
				right: 4.5rem;
				bottom: 0.75rem;
				z-index: 950;
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				max-width: calc(100vw - 5.5rem);
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
			/* The card editor's Save and Cancel row is position:fixed in this
			   same corner while editing, and these banners sat directly on top
			   of it — elementFromPoint at the centre of both buttons returned
			   the banner, so clicks never reached them. That is worse than a
			   cosmetic overlap: the update banner's own text is "save or cancel
			   your draft first", so it told the user to press exactly the two
			   controls it was blocking, with no way to comply. Same class of
			   bug as the two corner clearances noted above; the editor's row
			   was the case that got missed. */
			.update-ready.editor-open { bottom: 4.25rem; }
			.draft-recovery { bottom: 4.25rem; }
			/* Keep the two banners from stacking on each other once the update
			   banner has moved up. */
			.draft-recovery.editor-open { bottom: 7.75rem; }
			.draft-recovery .discard { background: transparent; color: inherit; text-decoration: underline; }
			.draft-error { color: var(--app-warning-color-light); }
			.save-status {
				position: fixed;
				left: 0.75rem;
				/* Clears the card drawer's floating create-card buttons, which
				   occupy this same corner (two 44px rounds at bottom:1em) and
				   were being covered by this pill. */
				bottom: 4.75rem;
				z-index: 940;
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				max-width: calc(100vw - 1.5rem);
				gap: 0.4rem;
				padding: 0.25rem 0.45rem;
				border-radius: 1rem;
				background: rgba(255, 255, 255, 0.94);
				box-shadow: 0 1px 5px rgba(0, 0, 0, 0.18);
				font: 0.78rem var(--app-default-font-family);
				color: var(--app-dark-text-color);
			}
			.save-dot { width: 0.5rem; height: 0.5rem; flex-shrink: 0; border-radius: 50%; background: var(--app-secondary-color); }
			/* The reason is supporting detail, not a second headline: it ran
			   together with the status label at identical weight and colour. */
			.save-reason { color: var(--app-dark-text-color-light); }
			.save-status.paused .save-dot { background: var(--app-warning-color); }
			/* The most destructive control on screen was pixel-identical to the safe
		   one next to it, and named five different things across the app
		   ("Discard", "Stop retrying", "Stop", "Stop this operation?"). One
		   name, and a visibly subordinate destructive treatment. */
		.save-status button.stop {
			color: var(--app-warning-color);
			text-decoration: none;
			box-shadow: inset 0 0 0 1px currentColor;
			border-radius: 0.3rem;
			padding: 0 0.4em;
		}

		.save-status button { border: 0; background: transparent; color: var(--app-primary-color); text-decoration: underline; cursor: pointer; font: inherit; }

			.snackbar-content {
				display: flex;
				align-items: center;
				gap: 1em;
				justify-content: center;
			}

			.snackbar-content span {
				min-width: 0;
			}

			.snackbar-content button {
				background: transparent;
				border: 0;
				color: white;
				cursor: pointer;
				font: inherit;
				font-weight: bold;
				padding: 0.25em;
				text-decoration: underline;
				text-underline-offset: 0.2em;
			}

			.snackbar-content button:focus-visible {
				outline: 2px solid white;
				outline-offset: 2px;
			}
		`
	];

	override render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<main-view .active=${pageRequiresMainView(this._page)}></main-view>
		<basic-card-view .active=${this._page == PAGE_BASIC_CARD}></basic-card-view>
		<snack-bar .active="${this._snackbarOpened}">
			<div class='snackbar-content'>
				<span role='status' aria-live='polite'>${this._snackbarMessage || `You are now ${this._offline ? 'offline' : 'online'}.`}</span>
				${this._snackbarAction === 'back' ? html`<button @click=${this._handleSnackbarUndo}>Undo</button>` : ''}
			</div>
		</snack-bar>
		${this._updateRegistration || this._updateActivated ? html`
			<div class='update-ready ${this._editorOpen ? 'editor-open' : ''}' role='status' aria-live='polite'>
				<span>${this._currentUnsafeExitReason() ? `Update ready — ${this._currentUnsafeExitReason()}` : this._updateActivated ? 'Update active — reload to finish' : 'Update ready'}</span>
				<button ?disabled=${Boolean(this._currentUnsafeExitReason()) || this._updateReloading} @click=${this._activateUpdate}>Reload</button>
			</div>` : ''}
		${this._draftAvailable ? html`
			<div class='update-ready draft-recovery ${this._editorOpen ? 'editor-open' : ''}' role='alert' aria-live='assertive'>
				<span>${this._draftError || 'An unsaved card draft is available.'}</span>
				<button ?disabled=${this._draftBusy} @click=${this._recoverDraft}>Recover</button>
				<button class='discard' ?disabled=${this._draftBusy} @click=${this._discardDraft}>Discard</button>
			</div>` : ''}
		${this._saveStatus !== 'idle' ? html`
			<div class='save-status ${this._saveStatus}' data-corpus-gate-keep-interactive role='status' aria-live='polite' title=${this._saveError}>
				<span class='save-dot' aria-hidden='true'></span>
				<span>${this._saveStatus === 'saving'
					? this._saveIsMulti ? 'Saving cards…' : 'Saving card…'
					: this._saveIsMulti ? 'Multi-edit paused' : 'Save paused'}</span>
				<!-- The reason was only in the title attribute, i.e. hover-only
				and unreachable on touch, while the visible text was a fixed
				string. Show it. -->
				${this._saveStatus === 'paused' && this._saveError ? html`<span class='save-reason'>${this._saveError}</span>` : ''}
				<!-- Retry/Stop render for BOTH states. A durable intent is
				persisted BEFORE the first attempt, so a crash in exactly the
				window the intent exists to protect leaves a record with no
				lastError -- which rendered as a buttonless "Saving card…"
				forever, while durableCardMutationPending() disabled Edit on
				every card, refused editingStart with only a console.warn,
				disabled the service-worker Reload button, and armed a
				beforeunload prompt. Same terminal state after a sign-out or
				account switch, where resume returns silently on uid mismatch.
				There was no in-app exit at all: DevTools or nothing. -->
				<button @click=${this._retrySave}>Retry</button>
				<button class='stop' @click=${this._stopRetryingSave}>Stop</button>
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

	private _waitForUpdatedController = () => {
		if (this._updateReloading) return;
		this._updateReloading = true;
		navigator.serviceWorker.addEventListener('controllerchange', this._controllerChangeHandler, {once: true});
		if (this._updateActivationTimeout !== undefined) window.clearTimeout(this._updateActivationTimeout);
		this._updateActivationTimeout = window.setTimeout(() => {
			this._updateActivationTimeout = undefined;
			this._updateReloading = false;
		}, 15000);
	};

	private _activateUpdate = () => {
		if (this._currentUnsafeExitReason() || this._updateReloading) return;
		const waiting = this._updateRegistration?.waiting;
		if (!waiting) {
			//Reload unconditionally. Previously this returned silently unless
			//_updateActivated was set, so after the 15s activation timeout —
			//waiting null, not activated — every click did nothing at all. A
			//reload is always a reasonable answer to "Reload".
			window.location.reload();
			return;
		}
		this._waitForUpdatedController();
		this._updateChannel?.postMessage({type: 'activating'});
		try {
			waiting.postMessage({type: 'SKIP_WAITING'});
		} catch (error) {
			if (this._updateActivationTimeout !== undefined) window.clearTimeout(this._updateActivationTimeout);
			this._updateActivationTimeout = undefined;
			this._updateReloading = false;
			console.warn('Service worker activation failed', error);
		}
	};

	private _refreshDraftAvailability = async () => {
		const {readEditDraft} = await import('../edit-draft.js');
		const {durableCardMutationPending} = await import('../actions/data.js');
		const draft = readEditDraft();
		const state = store.getState() as State;
		//A draft carrying an operationID belongs to a save that was ATTEMPTED,
		//not to an orphaned editing session. stampDraftForSave writes it
		//synchronously and announces, but this refresh is async and therefore
		//read state AFTER the editingFinish() on the next line — editing false,
		//draft present, uid matching — so EVERY successful save popped an
		//assertive "An unsaved card draft is available" alert whose Recover
		//button could not work (editingStart refuses while a durable mutation
		//is pending) and whose Discard removed the recovery record mid-flight.
		//While a save is in flight or paused the save pill owns the UX and
		//offers Retry/Stop; this banner is for drafts found orphaned at boot.
		const belongsToLiveSave = Boolean(draft?.operationID) && durableCardMutationPending();
		this._draftAvailable = Boolean(draft && draft.uid === selectUid(state) && !state.editor?.editing && !belongsToLiveSave);
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

	_handleSnackbarUndo() {
		store.dispatch(closeSnackbar());
		if (collectionReceiptCanUndo(
			this._snackbarExpectedLocation,
			currentBrowserLocation(),
			[this._card?.id || '', this._card?.name || '', ...(this._card?.slugs || [])]
		)) window.history.back();
	}

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
		window.addEventListener('storage', this._durableStorageHandler);
		this._updateChannel?.addEventListener('message', this._updateChannelHandler);
		if (window.CARD_WEB_SW_UPDATE_REGISTRATION) this._updateRegistration = window.CARD_WEB_SW_UPDATE_REGISTRATION;
	}

	override disconnectedCallback() {
		window.removeEventListener('card-web-service-worker-update', this._updateEventHandler);
		window.removeEventListener('beforeunload', this._beforeUnloadHandler);
		window.removeEventListener('card-web-edit-draft-changed', this._draftEventHandler);
		window.removeEventListener('storage', this._durableStorageHandler);
		this._updateChannel?.removeEventListener('message', this._updateChannelHandler);
		if (this._updateActivationTimeout !== undefined) window.clearTimeout(this._updateActivationTimeout);
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
		this._editorOpen = Boolean(state.editor?.editing);
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
		let durableError = '';
		try {
			const genericIntent = localStorage.getItem('card-web-pending-multi-edit-v1');
			if (genericIntent) {
				try {
					const parsed = JSON.parse(genericIntent);
					hasDurableSingleIntent = parsed.kind === 'single';
					durableError = typeof parsed.lastError === 'string' ? parsed.lastError : '';
				} catch {
					//An unparseable record would otherwise show a buttonless
					//'Saving…' forever if resume never runs (e.g. data never
					//fully loads). Surface it as paused so Stop is reachable.
					durableError = 'The saved edit record is corrupt. Use Stop to discard it.';
				}
			}
			const bulkIntent = localStorage.getItem('card-web-pending-bulk-tag-operation-v1');
			if (bulkIntent && !durableError) {
				try {
					const parsed = JSON.parse(bulkIntent);
					durableError = typeof parsed.lastError === 'string' ? parsed.lastError : '';
				} catch {
					durableError = 'The saved bulk-label record is corrupt. Use Stop to discard it.';
				}
			}
			hasDurableBulkIntent = Boolean(
				bulkIntent ||
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
		this._saveIsMulti = hasDurableBulkIntent && !hasDurableSingleIntent;
		this._saveStatus = hasDurableBulkIntent
			? saveError || durableError ? 'paused' : 'saving'
			: 'idle';
		this._saveError = saveError?.message || durableError;
		this._snackbarMessage = state.app.snackbarMessage;
		this._snackbarAction = state.app.snackbarAction;
		this._snackbarExpectedLocation = state.app.snackbarExpectedLocation;
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
