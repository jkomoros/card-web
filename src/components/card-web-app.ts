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

import {
	dismissPersistentError,
	runPersistentErrorAction
} from '../actions/app.js';

import {
	PersistentError
} from '../types.js';

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
	unsentUserInputReason,
	readUpdateFirstSeen,
	recordUpdateFirstSeen,
	clearUpdateFirstSeen,
} from '../service-worker-update.js';

import {
	selectActiveCard,
	selectCardModificationError,
	selectChatComposingMessage,
	selectComposeOpen,
	selectFindDialogOpen,
	selectPendingDeletions,
	selectPendingModificationCount,
	selectPromptContent,
	selectQuery,
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
		_draftCount = 0;

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

	//Drives .banners.mobile. The card stage's action row is the app's only
	//navigation on a phone and it lives at the bottom of the stage, so this
	//column has to sit above it rather than on top of it.
	@state()
	private _mobileMode = false;

	private _lastDraftUid = '';
	//The card whose draft the banner is currently showing; Recover/Discard
	//target exactly this one (#766).
	private _draftCardID = '';
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
	//The bootstrap's "registration is ready, nothing waiting" signal. The
	//update event above cannot carry it (setting _updateRegistration is what
	//shows the banner), and without it a registration that completes with NO
	//waiting worker stays invisible until the HOURLY re-check — long enough
	//for a stale first-seen record from an already-activated update (the
	//all-tabs-closed activation path clears nothing) to be adopted by the
	//next deploy and instant-fire it (#756). The check itself still decides:
	//it only clears when a registration is genuinely visible with no waiting
	//worker, never on ignorance.
	private _registrationReadyHandler = () => {
		this._checkUpdateBackstop();
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
				indicator's pending layer. 4.24:1 on white — clears AA-large,
				not AA. (This said 4.6:1 for a long time; it was never
				measured.) */
				--app-pending-color: #b26a00;

				/* THE COLLECTION SENTENCE'S CLAUSE HUES (src/collection-pill-palette.ts).
				One hue per FAMILY of question a clause asks, so that squinting at a
				sentence tells you what kind of collection it is; differentiation
				within a family is the label's job, never a second hue. All eight sit
				at 26-42% lightness so they read as one ramp, all carry white text at
				>= 6.3:1 (tag-chip paints --app-light-text-color on the fill), and
				every one is kept >= 15deg from the four reserved semantics of 4.5
				(brand purple ~268, live teal 174, warning red 0, pending amber 33) so
				a clause hue is never mistaken for a status. */
				/* When a card CHANGED. */
				--app-clause-date-color: hsl(132, 48%, 27%);
				/* What a card IS: content, working notes, concept, quote, work. */
				--app-clause-card-type-color: hsl(210, 62%, 33%);
				/* How a card is LINKED to another: children, references, connections. */
				--app-clause-relationship-color: hsl(252, 42%, 42%);
				/* WHO wrote a card. */
				--app-clause-person-color: hsl(300, 40%, 32%);
				/* How a card RESEMBLES another: similar, same type, different type. */
				--app-clause-similarity-color: hsl(340, 48%, 36%);
				/* What a card SAYS: a query, a named card, a concept. */
				--app-clause-text-color: hsl(18, 52%, 34%);
				/* A FLAG on a card: starred, unread, published, has a TODO. */
				--app-clause-property-color: hsl(68, 45%, 27%);
				/* Scaffolding, not a subject: a starting set. Deliberately the one
				DESATURATED value in the ramp rather than an eighth hue, because a set
				is what the subjects hang on rather than something the collection is
				about. */
				--app-clause-structural-color: hsl(210, 12%, 38%);

				/* note: this is also replicated in index.TEMPLATE.html */
				--app-dark-text-color: #7f7f7f;
				--app-light-text-color: white;
				--app-section-even-color: #f7f7f7;
				--app-section-odd-color: white;

				/* Body text at chrome sizes. #7f7f7f is 4.00:1 on white and #AAA is
				2.32:1 — both fail AA for normal text, and comments in
				corpus-status-indicator and progress-panel already reject them for
				exactly that. This is 8.24:1, and it is what the snack bar was
				accidentally rendering through a var() fallback for a token that did
				not exist — §4.1's named failure mode. Making it real is the fix. */
				--app-dark-text-color-darker: #4d4d4d;
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
			/* ONE container owns the corner, and the banners stack inside it.
			   They each used to be position:fixed with a hand-computed bottom,
			   which meant two banners needed four values (.update-ready,
			   .draft-recovery, and an .editor-open variant of each) and a third
			   would have needed eight. The comments on those rules record two
			   real bugs from getting that arithmetic wrong. A flex column has
			   no arithmetic to get wrong. */
			.banners {
				position: fixed;
				/* Clears the comments panel's round add-comment button, which
				   lives in exactly this corner (44px wide at right:1em) and
				   was sitting underneath these banners. */
				right: 4.5rem;
				bottom: 0.75rem;
				z-index: 950;
				display: flex;
				flex-direction: column;
				align-items: flex-end;
				gap: 0.5rem;
				/* Only the banners themselves take clicks. */
				pointer-events: none;
			}

			/* The card editor's Save and Cancel row is position:fixed in this
			   same corner while editing. One offset on the container now moves
			   every banner clear of it. */
			.banners.editor-open {
				bottom: 4.25rem;
			}

			/* THE ONLY NAVIGATION A PHONE HAS MUST NOT BE COVERED.
			   On mobile the card stage's action row is the app's whole toolbar,
			   and it sits at the bottom of the stage — exactly where this
			   bottom-anchored column draws. A receipt toast lives for seconds
			   at a time, and for all of them it took the toolbar with it. Same
			   class of bug as the three corner collisions this file already
			   records, and the worst instance of it: the composer's own
			   'Compose collection' button is in that row, so the surface that
			   produced the toast was the one it hid.
			   5.5rem is measured from what it has to clear: the toolbar wraps
			   at 375px (card-stage), so two rows of 2.75em round buttons at the
			   0.8em mobile scale is ~4.4rem, plus the 0.75rem this column
			   already leaves at the desktop offset, rounded up. It is stated
			   AFTER .editor-open so it wins for both — 5.5rem clears the
			   editor's Save/Cancel row too. */
			.banners.mobile {
				bottom: calc(5.5rem + env(safe-area-inset-bottom));
			}

			.update-ready {
				pointer-events: auto;
				z-index: 950;
				display: flex;
				flex-wrap: wrap;
				align-items: center;
				/* Leaves the bottom-LEFT corner alone. right:4.5rem plus this
				   width let the left edge reach x=16px at narrow viewports,
				   which is exactly where card-drawer's two create-card buttons
				   live (left:1em, 44px rounds, x 16-104). Adversarial review
				   drove real clicks at 390px: the first create button
				   activated the draft banner's DISCARD control and the second
				   was dead. The old .draft-recovery { bottom: 4.25rem } was
				   clearing those buttons, not stacking — I read it as
				   arithmetic and removed the clearance with it. Bounding the
				   width fixes it at every viewport rather than for one banner
				   at one offset. */
				max-width: calc(100vw - 11.5rem);
				gap: 0.65rem;
				padding: 0.55rem 0.7rem;
				/* THE CARD LANGUAGE, not a fourth invented one. This box used to
				   carry the repo's ONLY 0.45rem radius and its ONLY
				   0 2px 12px rgb(0 0 0/20%) shadow, while var(--card-shadow) on a
				   square surface has six uses across cards, dialogs, thumbnails,
				   comment threads and progress-panel. §4.4 says core surfaces are
				   square. Design review put a toast and a banner side by side and
				   the honest conclusion was that the BANNER was the outlier —
				   so it moves, and two one-off values leave the codebase. */
				border-radius: 0;
				background-color: var(--card-color);
				box-shadow: var(--card-shadow);
				font-size: 0.85rem;
			}
			/* button.text and button.discard come from ButtonSharedStyles. */
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
			/* The four hand-computed bottom offsets that used to live here are
			   gone: .banners is a flex column, so the stacking is automatic and
			   adding a fourth banner costs nothing. */

			/* The failure the user still needs to know about outranks the other
			   two, so it renders first (topmost in a column that grows upward
			   from the corner) and carries the only colour. */
			.error-banner .error-mark {
				width: 0.5rem;
				height: 0.5rem;
				border-radius: 50%;
				flex-shrink: 0;
				background: var(--app-warning-color);
			}
			.error-banner .reassurance { color: var(--app-dark-text-color-darker); }
			/* box-shadow: none is load-bearing: the base button rule's rest
			   and hover shadows otherwise apply, boxing the text link.
			   Scoped to .discard rather than to .draft-recovery .discard: the
			   error banner has a Dismiss with the same job, and while the rule
			   was scoped to one banner it rendered as filled purple — the app's
			   PRIMARY action treatment, on the least consequential control on
			   screen. */

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
			.save-reason { color: var(--app-dark-text-color-darker); }
			/* 18px glyphs per the button.small idiom, plus real padding: the
			   base idiom's zero-padding 18px hit target is too small for the
			   app's only recovery controls, where the safe Retry sits beside
			   the destructive Stop. (Stop's own flow still confirms before
			   discarding, so a mis-tap is recoverable.) */
			.save-status button.small { flex-shrink: 0; padding: 0.25rem; }
			.save-status button.small svg { height: 18px; width: 18px; }
			/* The warning-red glyph that distinguishes this from every safe
			   subtle icon now comes from button.small.destructive in
			   ButtonSharedStyles — this control was the precedent it was
			   generalized from. */
		`
	];

	private _dismissError(error : PersistentError) {
		store.dispatch(dismissPersistentError(error.id));
	}

	private _runErrorAction(error : PersistentError) {
		if (!error.action) return;
		store.dispatch(runPersistentErrorAction(error.id, error.action.actionID));
	}

	override render() {
		// Anything that's related to rendering should be done in here.
		return html`
		<main-view .active=${pageRequiresMainView(this._page)}></main-view>
		<basic-card-view .active=${this._page == PAGE_BASIC_CARD}></basic-card-view>
		<div class='banners ${this._editorOpen ? 'editor-open' : ''} ${this._mobileMode ? 'mobile' : ''}'>
			<!-- FIRST, not last. The column is bottom-anchored, so a child added
			     at the END pushes everything above it up: with the snack bar
			     there, every ordinary toast shifted the persistent banners 48px
			     on arrival and back on expiry, and toasts fire on every
			     committed write. Above them, arrivals and expiries move
			     nothing the user might be reading or reaching for. -->
			<snack-bar></snack-bar>
			${this._persistentErrors.map(error => html`
				<div class='update-ready error-banner' role='alert'>
					<span class='error-mark' aria-hidden='true'></span>
					<span>${error.what}${error.reassurance ? html` <span class='reassurance'>${error.reassurance}</span>` : ''}</span>
					${error.action ? html`<button class='text' @click=${() => this._runErrorAction(error)}>${error.action.label}</button>` : ''}
					<button class='discard' @click=${() => this._dismissError(error)}>Dismiss</button>
				</div>`)}
			${this._updateRegistration || this._updateActivated ? html`
				<div class='update-ready' role='status' aria-live='polite'>
					<span>${this._currentUnsafeExitReason() ? `Update ready — ${this._currentUnsafeExitReason()}` : this._updateActivated ? 'Update active — reload to finish' : 'Update ready'}</span>
					<button class='text' ?disabled=${Boolean(this._currentUnsafeExitReason()) || this._updateReloading} @click=${this._activateUpdate}>Reload</button>
				</div>` : ''}
			${this._draftAvailable ? html`
				<div class='update-ready draft-recovery' role='alert' aria-live='assertive'>
					<span>${this._draftError || (this._draftCount > 1 ? `${this._draftCount} unsaved card drafts are available.` : 'An unsaved card draft is available.')}</span>
					<button class='text' ?disabled=${this._draftBusy} @click=${this._recoverDraft}>Recover</button>
					<button class='discard' ?disabled=${this._draftBusy} @click=${this._discardDraft}>Discard</button>
				</div>` : ''}
		</div>
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
				<span class='reason' title='Stop and discard the saved operation'><button class='small destructive' aria-label='Stop and discard the saved operation' @click=${this._stopRetryingSave}>${CANCEL_ICON}</button></span>
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
		//The manual path's gates plus the auto-only ones: the manual path
		//implicitly had a human CLICK as consent, so half-typed text in
		//non-card surfaces never needed guarding there. An automatic reload
		//has no such consent, and beforeunload cannot catch it (the guard
		//only arms on _currentUnsafeExitReason, which is exactly empty on
		//this path). The gates and why each exists — a composing chat
		//message, the compose dialog's redux-only unsent text, the find
		//dialog's open query (kept until the dialog closes, so it may
		//already have run; holding is the cheap side of that guess) — live
		//with the pure helper in
		//service-worker-update.ts so tests can pin them. Hold while any is
		//present and let the hourly re-check try again.
		const state = store.getState() as State;
		const unsentInput = unsentUserInputReason({
			chatComposing: selectChatComposingMessage(state),
			composeOpen: selectComposeOpen(state),
			composeContent: selectPromptContent(state),
			findDialogOpen: selectFindDialogOpen(state),
			findQuery: selectQuery(state)
		});
		if (shouldAutoActivateUpdate(firstSeen, Date.now(), this._currentUnsafeExitReason() || unsentInput)) {
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
		const {readEditDrafts} = await import('../edit-draft.js');
		const {durableCardMutationPendingForCard} = await import('../actions/data.js');
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
		//Per-card since #766: a draft stamped for a save that is live ON ITS
		//OWN CARD is excluded, but no longer hides other cards' orphaned
		//drafts. The banner shows the newest eligible draft and remembers
		//which, so Recover and Discard act on exactly the draft shown.
		const eligible = readEditDrafts().filter(draft =>
			draft.uid === selectUid(state) &&
			!(draft.operationID && durableCardMutationPendingForCard(draft.cardID)));
		const shown = eligible[0];
		this._draftAvailable = Boolean(shown && !state.editor?.editing);
		this._draftCardID = shown ? shown.cardID : '';
		this._draftCount = eligible.length;
		if (!this._draftAvailable) this._draftError = '';
	};

	private _recoverDraft = async () => {
		//Capture BEFORE any await: a storage-event refresh can retarget the
		//banner mid-flight, and this action belongs to the draft that was
		//showing when the user clicked (#766 review). An empty capture means
		//the banner lost its draft — refresh and bail rather than acting on
		//"whatever is newest".
		const cardID = this._draftCardID;
		if (!cardID) {
			await this._refreshDraftAvailability();
			return;
		}
		this._draftBusy = true;
		this._draftError = '';
		try {
			const {recoverEditDraft} = await import('../edit-draft.js');
			await recoverEditDraft(cardID);
		} catch (error) {
			this._draftError = error instanceof Error ? error.message : String(error);
		} finally {
			this._draftBusy = false;
			await this._refreshDraftAvailability();
		}
	};

	private _discardDraft = async () => {
		//Capture before the modal: while it sits open a storage-event refresh
		//can retarget or empty _draftCardID, and "discard THIS draft" must
		//never fall through to a clear-everything (#766 review: that
		//fallback wiped another account's stamped draft).
		const cardID = this._draftCardID;
		if (!cardID) {
			await this._refreshDraftAvailability();
			return;
		}
		if (!confirm('Permanently discard this unsaved draft?')) return;
		const {clearEditDraft} = await import('../edit-draft.js');
		clearEditDraft(cardID);
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
		window.addEventListener('card-web-service-worker-registration-ready', this._registrationReadyHandler);
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
		window.removeEventListener('card-web-service-worker-registration-ready', this._registrationReadyHandler);
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

	@state()
		_persistentErrors : PersistentError[] = [];

	override stateChanged(state : State) {
		this._persistentErrors = state.errors.errors;
		this._card = selectActiveCard(state);
		this._editorOpen = Boolean(state.editor?.editing);
		//§4.6: one breakpoint, threaded down as a property, never a CSS query.
		this._mobileMode = Boolean(state.app.mobileMode);
		this._page = state.app.page;
		this._offline = state.app.offline;
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
