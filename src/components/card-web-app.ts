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

import { ButtonSharedStyles } from './button-shared-styles.js';

import {
	REPLAY_ICON,
	CANCEL_ICON,
} from '../../shared/icons.js';

//Static on purpose: the controllerchange handler must clear the
//auto-activation clock BEFORE it reloads the page, and a dynamic import
//would lose that race (#756).
import {
	UPDATE_AUTO_ACTIVATE_RECHECK_MS,
	shouldAutoActivateUpdate,
	readUpdateFirstSeen,
	recordUpdateFirstSeen,
	clearUpdateFirstSeen,
} from '../service-worker-update.js';

import {
	selectActiveCard,
	selectCardModificationError,
	selectChatComposingMessage,
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
		_offline: boolean;

	@state()
		_snackbarMessage: string;

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
	private _updateBackstopInterval : number | undefined;
	private _updateChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SERVICE_WORKER_UPDATE_CHANNEL);
	private _updateEventHandler = (event : Event) => {
		const registration = (event as CustomEvent<ServiceWorkerRegistration>).detail;
		if (registration) {
			this._updateActivated = false;
			this._updateRegistration = registration;
			void this._checkUpdateBackstop();
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
		//The waiting worker activated; the auto-activation clock (#756)
		//restarts for whatever update comes next. Synchronous on purpose:
		//the reload below would win a race against any deferred clear,
		//leaving a stale record that could instant-fire on the NEXT update.
		clearUpdateFirstSeen();
		//Activation affects the entire origin. Reload this client only when its
		//own dirty/pending checks still pass; otherwise retain the banner until
		//the user finishes the protected work.
		if (!this._currentUnsafeExitReason()) window.location.reload();
	};

	static override styles = [
		//The app's control vocabulary. This component not importing it is WHY
		//its overlays drifted into hand-rolled one-off treatments (#764) —
		//they had no access to the shared primitives.
		ButtonSharedStyles,
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
				/* Neutralize the base button treatment ButtonSharedStyles now
				   contributes: its margin, and its rest/hover drop shadows,
				   which are the filled-workhorse-button look, not this
				   banner's. */
				margin: 0;
				box-shadow: none;
				padding: 0.4rem 0.6rem;
				background: var(--app-primary-color);
				color: white;
				font: inherit;
				font-weight: 600;
				cursor: pointer;
			}
			.update-ready button:hover { box-shadow: none; }
			.update-ready button[disabled] { opacity: 0.55; cursor: not-allowed; }
			/* button:disabled:hover (0,2,1) from ButtonSharedStyles otherwise
			   outranks the banner rule and flips a disabled purple button to
			   gray under the cursor — reads as broken. */
			.update-ready button[disabled]:hover { background: var(--app-primary-color); box-shadow: none; }
			/* ButtonSharedStyles strips the UA focus ring app-wide
			   (button:focus outline:none). For every other consumer the
			   filled hover/selected states carry focus feedback well enough,
			   but these banners hold the app's ONLY recovery controls — a
			   keyboard user must be able to see which of two adjacent
			   buttons (one destructive) is focused. */
			.update-ready button:focus-visible, .save-status button:focus-visible {
				outline: 2px solid var(--app-primary-color);
				outline-offset: 2px;
			}
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
			/* box-shadow: none is load-bearing: the base button rule's rest
			   and hover shadows otherwise apply, boxing the text link. */
			.draft-recovery .discard { background: transparent; color: inherit; text-decoration: underline; box-shadow: none; }
			.draft-recovery .discard:hover { box-shadow: none; }
			.draft-error { color: var(--app-warning-color-light); }
			/* The saving pill speaks the app's existing ambient-status idiom
			   (#764): the CAPSULE treatment is byte-identical to the floating
			   corpus-status-indicator — the one prior surface that got
			   deliberate design attention — and its contents are the existing
			   primitives only: a status dot in the app's established
			   work-in-flight amber, a subordinate label, and button.small
			   icon controls. The previous version was a fourth, invented
			   form: its own radius, its own shadow recipe, its own type size,
			   a teal dot meaning the same thing the indicator says in amber,
			   and underlined text-link buttons that appear nowhere else.

			   Folding into corpus-status-indicator itself (the issue's
			   preferred option) was evaluated first and declined: the
			   floating indicator hides in presentation mode and behind the
			   header panel, and it deliberately contains no buttons — while
			   Retry/Stop must stay reachable in BOTH states (a crash in the
			   write-ahead window leaves a record whose ONLY exit is these
			   controls, see the render comment) and must stay interactive
			   under the corpus gate. A recovery affordance cannot live on a
			   surface that is sometimes hidden. */
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
				max-width: min(24rem, calc(100vw - 1.5rem));
				gap: 0.4rem;
				padding: 0.35rem 0.55rem;
				border-radius: 999px;
				background: rgb(255 255 255 / 92%);
				box-shadow: 0 1px 5px rgb(0 0 0 / 18%);
				font: 0.72rem var(--app-default-font-family);
				/* NOT --app-dark-text-color-light (#AAA): the corpus
				   indicator's own comment records rejecting that token for
				   pill text at ~2.3:1 on the white background — the primary
				   label must stay legible; only .save-reason is subordinate. */
				color: var(--app-dark-text-color);
			}
			/* Work in flight is AMBER everywhere: --app-pending-color is the
			   token corpus-status-indicator already uses for exactly this
			   meaning. The old teal made the same state two colors in the
			   same app, often on screen simultaneously. Paused stays amber
			   too — a paused save is recoverable, not destructive, and the
			   full-strength warning red belongs to the Stop control alone. */
			.save-dot { width: 0.5rem; height: 0.5rem; flex-shrink: 0; border-radius: 50%; background: var(--app-pending-color); }
			/* The reason is supporting detail, not a second headline. */
			.save-reason { color: var(--app-dark-text-color-light); }
			/* 18px glyphs per the button.small idiom, plus real padding: the
			   base idiom's zero-padding 18px hit target is too small for the
			   app's only recovery controls, where the safe Retry sits beside
			   the destructive Stop. (Stop's own flow still confirms before
			   discarding, so a mis-tap is recoverable.) */
			.save-status button.small { flex-shrink: 0; padding: 0.25rem; }
			.save-status button.small svg { height: 18px; width: 18px; }
			/* The most destructive control on screen keeps a visibly distinct
			   treatment: warning-red glyph, unlike every safe subtle icon. */
			.save-status button.small.stop svg { fill: var(--app-warning-color); }
			.save-status button.small.stop:hover svg { fill: var(--app-warning-color-light, var(--app-warning-color)); }
		`
	];

	override render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<main-view .active=${pageRequiresMainView(this._page)}></main-view>
		<basic-card-view .active=${this._page == PAGE_BASIC_CARD}></basic-card-view>
		<snack-bar .active="${this._snackbarOpened}">
				${this._snackbarMessage || `You are now ${this._offline ? 'offline' : 'online'}.`}</snack-bar>
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
				<span class='reason' title='Retry the saved operation'><button class='small' aria-label='Retry the saved operation' @click=${this._retrySave}>${REPLAY_ICON}</button></span>
				<span class='reason' title='Stop and discard the saved operation'><button class='small stop' aria-label='Stop and discard the saved operation' @click=${this._stopRetryingSave}>${CANCEL_ICON}</button></span>
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

	//The 7-day auto-activation backstop (#756): a user who never clicks the
	//"Update ready" banner runs arbitrarily old app code against live data
	//indefinitely. Once a waiting worker has been waiting more than the
	//deadline AND the same safety gates that guard the manual path pass, send
	//SKIP_WAITING automatically; if a gate blocks, keep waiting and re-check
	//on the hourly interval rather than forcing it. The decision logic lives
	//in service-worker-update.ts so tests can pin the deadline and gates.
	private _checkUpdateBackstop = () => {
		//Never act — and above all never CLEAR — on ignorance. The bootstrap
		//registers the service worker after the window load event, so at the
		//boot-time check the registration is usually not known yet; clearing
		//then wiped the legitimately-aging first-seen clock on every reload
		//and every new tab, which made the backstop structurally unable to
		//fire for exactly its target cohort (the reload-often banner
		//ignorer). CARD_WEB_SW_REGISTRATION is exposed unconditionally by
		//the bootstrap once registration completes, so "no registration
		//visible" means "haven't looked yet", not "no update".
		const registration = this._updateRegistration || window.CARD_WEB_SW_REGISTRATION || null;
		if (!registration) return;
		const waiting = registration.waiting;
		if (!waiting) {
			//A genuine no-update state: a stale first-seen record must not
			//make a FUTURE update auto-activate instantly.
			if (readUpdateFirstSeen() !== null) clearUpdateFirstSeen();
			return;
		}
		if (!this._updateRegistration) this._updateRegistration = registration;
		const firstSeen = recordUpdateFirstSeen(Date.now());
		//The manual path's gates plus one auto-only gate: the manual path
		//implicitly had a human CLICK as consent, so half-typed text in
		//non-card surfaces (a composing chat message) never needed guarding
		//there. An automatic reload has no such consent; hold while any is
		//present and let the hourly re-check try again.
		const composing = selectChatComposingMessage(store.getState() as State) ? 'a message is being composed' : '';
		if (shouldAutoActivateUpdate(firstSeen, Date.now(), this._currentUnsafeExitReason() || composing)) {
			this._activateUpdate();
		}
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

	//Registration lives here, NOT in firstUpdated, for three reasons (#770):
	//it runs earlier (before the first render, and before firstUpdated's
	//installer dispatches fan out through the store, where a single throw
	//used to silently skip every registration after it); it pairs with the
	//removals in disconnectedCallback, so a disconnect/reconnect of this
	//element no longer drops the beforeunload guard permanently
	//(firstUpdated never runs twice); and super.connectedCallback() connects
	//the store first, so state-derived fields are live before any handler
	//can fire.
	override connectedCallback() {
		super.connectedCallback();
		window.addEventListener('card-web-service-worker-update', this._updateEventHandler);
		window.addEventListener('beforeunload', this._beforeUnloadHandler);
		window.addEventListener('card-web-edit-draft-changed', this._draftEventHandler);
		window.addEventListener('storage', this._durableStorageHandler);
		this._updateChannel?.addEventListener('message', this._updateChannelHandler);
		if (window.CARD_WEB_SW_UPDATE_REGISTRATION) this._updateRegistration = window.CARD_WEB_SW_UPDATE_REGISTRATION;
		//The #756 backstop needs to re-evaluate while a tab stays open for
		//days: once at boot (a no-op until the bootstrap exposes the
		//registration; the update event covers the waiting case as soon as
		//it is known) and hourly thereafter (covers the long-lived tab). The
		//interval arms FIRST and the immediate check is guarded: a throw in
		//the check is the same one-throw-strips-what-follows class this
		//whole registration sequence exists to eliminate (#770 review).
		this._updateBackstopInterval = window.setInterval(() => this._checkUpdateBackstop(), UPDATE_AUTO_ACTIVATE_RECHECK_MS);
		try {
			this._checkUpdateBackstop();
		} catch (err) {
			console.error('update backstop check failed at connect', err);
		}
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
		document.addEventListener('keydown', this._handleKeyDown.bind(this));
		document.addEventListener('keyup', this._handleKeyUp.bind(this));
		window.addEventListener('blur', this._handleBlur.bind(this));
		//Each pwa-helpers installer invokes its callback SYNCHRONOUSLY at
		//install time (verified: router.js ends with
		//locationUpdatedCallback(...)), so each of these lines runs a store
		//dispatch that fans out to every subscriber before returning. Guarded
		//individually so one boot-time throw cannot silently strip the
		//installers after it — the failure mode that motivated #770.
		try {
			installRouter((location) => store.dispatch(navigated(location.pathname, location.search)));
		} catch (err) {
			console.error('installRouter failed at boot', err);
		}
		try {
			installOfflineWatcher((offline) => store.dispatch(updateOffline(offline)));
		} catch (err) {
			console.error('installOfflineWatcher failed at boot', err);
		}
		try {
			installMediaQueryWatcher('(max-width: 900px)',(isMobile) => {
				store.dispatch(turnMobileMode(isMobile));
			});
		} catch (err) {
			console.error('installMediaQueryWatcher failed at boot', err);
		}
	}

	override disconnectedCallback() {
		window.removeEventListener('card-web-service-worker-update', this._updateEventHandler);
		window.removeEventListener('beforeunload', this._beforeUnloadHandler);
		window.removeEventListener('card-web-edit-draft-changed', this._draftEventHandler);
		window.removeEventListener('storage', this._durableStorageHandler);
		this._updateChannel?.removeEventListener('message', this._updateChannelHandler);
		if (this._updateActivationTimeout !== undefined) window.clearTimeout(this._updateActivationTimeout);
		if (this._updateBackstopInterval !== undefined) window.clearInterval(this._updateBackstopInterval);
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
		this._snackbarMessage = state.app.snackbarMessage;
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
		//ANY open editor arms the guard, not just a non-empty redux diff
		//(#770 decision): textFieldUpdated deliberately skips dispatch when a
		//keystroke normalizes back to the stored value, so the contenteditable
		//(what the user sees) and redux (what a diff check would consult) can
		//diverge. EDITING_FINISH discards the editing state outright, so an
		//open editor is always worth a prompt. This also keeps the
		//service-worker auto-reload paths, which share this reason, from
		//reloading under an open editor.
		this._unsafeExitReason = this._editorOpen
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
	}
}

declare global {
	interface Window {
		CARD_WEB_SW_UPDATE_REGISTRATION? : ServiceWorkerRegistration;
		//Set unconditionally by the bootstrap once registration completes —
		//update waiting or not — so the backstop can tell "no update" from
		//"haven't looked yet".
		CARD_WEB_SW_REGISTRATION? : ServiceWorkerRegistration;
	}
	interface HTMLElementTagNameMap {
		'card-web-app': CardWebApp;
	}
}
