//--- Durable auxiliary writes ----------------------------------------------
//Executors for the aux-write queue. Each performs the SERVER side of a
//star/read/reading-list change; the calling thunks build intents and hand
//them to the queue, which persists them across reloads and replays them on
//boot/reconnect. Star batches are atomic, so on replay the star doc's server
//existence proves whether the counters already moved — the preflight makes
//the non-idempotent increments replay-safe. getDocFromServer fails while
//offline, which is exactly right: replay stops and retries on the next
//trigger.

const starRefsForIntent = (intent : AuxWriteIntent) => ({
	cardRef: doc(db, CARDS_COLLECTION, intent.cardID),
	starRef: doc(db, STARS_COLLECTION, idForPersonalCardInfo(intent.uid, intent.cardID)),
});

//The replay preflight asks "did the original batch commit?". Its ANSWER is
//proof; its FAILURE is not. A rejected read (rules error, offline, blip) used
//to propagate as a permission-denied that the queue classified as permanent,
//silently destroying the intent — the one path this queue exists to protect.
//Rethrow without a `code` so permanentFailure() treats it as transient and the
//intent is retained for the next replay.
const starCommitted = async (starRef : ReturnType<typeof doc>, label : string) : Promise<boolean> => {
	try {
		return (await getDocFromServer(starRef)).exists();
	} catch (err) {
		throw new Error(`${label} replay preflight could not be answered; retaining intent: ${String(err)}`);
	}
};

registerAuxWriteExecutor('star-add', async (intent, isReplay) => {
	const {cardRef, starRef} = starRefsForIntent(intent);
	if (isReplay && await starCommitted(starRef, 'star-add')) return;
	const batch = new MultiBatch(db);
	//updated-invariant: exempt — cardEditMinor rules path; star counts are
	//reader-driven and their drift is an accepted tradeoff.
	batch.updateWithoutTimestampBump(cardRef, {
		star_count: increment(1),
		star_count_manual: increment(1),
	});
	batch.set(starRef, {
		created: serverTimestamp(),
		owner: intent.uid,
		card: intent.cardID
	});
	await batch.commit();
});

registerAuxWriteExecutor('star-remove', async (intent, isReplay) => {
	const {cardRef, starRef} = starRefsForIntent(intent);
	if (isReplay && !(await starCommitted(starRef, 'star-remove'))) return;
	const batch = new MultiBatch(db);
	//updated-invariant: exempt — cardEditMinor rules path (see star-add).
	batch.updateWithoutTimestampBump(cardRef, {
		star_count: increment(-1),
		star_count_manual: increment(-1),
	});
	batch.delete(starRef);
	await batch.commit();
});

registerAuxWriteExecutor('read-add', async (intent) => {
	const readRef = doc(db, READS_COLLECTION, idForPersonalCardInfo(intent.uid, intent.cardID));
	const batch = new MultiBatch(db);
	batch.set(readRef, {created: serverTimestamp(), owner: intent.uid, card: intent.cardID});
	await batch.commit();
});

registerAuxWriteExecutor('read-remove', async (intent) => {
	const readRef = doc(db, READS_COLLECTION, idForPersonalCardInfo(intent.uid, intent.cardID));
	const batch = new MultiBatch(db);
	batch.delete(readRef);
	await batch.commit();
});

const readingListExecutor = (adding : boolean) => async (intent : AuxWriteIntent) => {
	const batch = new MultiBatch(db);
	const readingListRef = doc(db, READING_LISTS_COLLECTION, intent.uid);
	//The audit key comes from the INTENT (captured at creation), so a replay
	//overwrites its own audit doc instead of minting a duplicate.
	const readingListUpdateRef = doc(readingListRef, READING_LISTS_UPDATES_COLLECTION, intent.auditKey);
	batch.set(readingListRef, {
		cards: adding ? arrayUnion(intent.cardID) : arrayRemove(intent.cardID),
		updated: serverTimestamp(),
		owner: intent.uid,
	}, {merge: true});
	batch.set(readingListUpdateRef, {
		timestamp: serverTimestamp(),
		[adding ? 'add_card' : 'remove_card']: intent.cardID
	});
	await batch.commit();
};

registerAuxWriteExecutor('reading-list-add', readingListExecutor(true));
registerAuxWriteExecutor('reading-list-remove', readingListExecutor(false));

export const AUTO_MARK_READ_DELAY = 5000;

import {
	GoogleAuthProvider,
	signInWithCredential,
	signInWithPopup,
	signInWithRedirect,
	linkWithPopup,
	linkWithRedirect,
	getRedirectResult,
	signInAnonymously,
	signOut as firebaseSignOut,
	User,
	updateProfile,
	updateEmail,
	AuthCredential
} from 'firebase/auth';

import {
	confirmDestructive
} from '../modal.js';

import {
	mergeDecision,
	switchAccountQuestion
} from '../sign-in-merge.js';

import {
	discardPendingAuxWritesForUid
} from '../aux-write-queue.js';

import {
	DISABLE_ANONYMOUS_LOGIN
} from '../config.GENERATED.SECRET.js';

import {
	connectLiveStars,
	disconnectLiveStars,
	connectLiveReads,
	disconnectLiveReads,
	connectLiveReadingList,
	disconnectLiveReadingList,
	connectLivePermissions,
	disconnectLivePermissions
} from './database.js';

import {
	db,
	auth,
} from '../firebase.js';

import {
	FirebaseError
} from 'firebase/app';

import {
	doc,
	getDocFromServer,
	arrayUnion,
	arrayRemove,
	serverTimestamp,
	increment,
	FieldValue
} from 'firebase/firestore';

//The labels live with the queue so there is one copy; this only fixes the case
//for the start of a sentence.
const capitalize = (text : string) : string => text.charAt(0).toUpperCase() + text.slice(1);

//Report only what belongs to the CURRENT uid, and treat "no current uid" as
//not-ours rather than as ours.
//
//The permissive version — returning true when there is no current uid — was
//written to avoid dropping reports before sign-in resolves. Review showed what
//it actually bought: after sign-out, an `online` event calls
//replayPendingAuxWrites(''), readPendingAuxWrites ages out 30-day-old intents
//with no uid filter at all, and the previous account's discarded comment
//surfaces as the current viewer's news on a shared browser. Verified by
//discarding an intent whose uid was another user's while selectUid was empty:
//"Posting your comment couldn't be saved and has been discarded."
//
//Every aux write is created after sign-in and carries a uid, so an intent with
//no current uid to match against is never something the person now looking at
//the screen did. The boot-race worry does not survive contact either: replay is
//driven by uidProvider(), so a replay that can produce reports already has a uid.
const auxWriteBelongsToCurrentUser = (intent : AuxWriteIntent) : boolean => {
	const currentUID = selectUid(store.getState() as State);
	if (!currentUID) return false;
	return intent.uid === currentUID;
};

import {
	registerAuxWriteExecutor,
	makeAuxWriteIntent,
	runDurableAuxWrite,
	onAuxWriteDiscarded,
	onAuxWriteStuck,
	auxWriteLabel,
	auxWriteLabelForKind,
	onAuxWriteQueueDepthChanged,
	readPendingAuxWrites,
	AuxWriteOutcome,
	AuxWriteKind,
	installAuxWriteReplayWatcher,
	AuxWriteIntent
} from '../aux-write-queue.js';

import {
	reportPersistentError,
	registerPersistentErrorAction,
	showSnackbar
} from './app.js';

import {
	idForPersonalCardInfo
} from '../util.js';

import {
	refreshCardSelector
} from './collection.js';

import {
	selectActiveCard,
	selectUser,
	selectUid,
	selectUserReadingList,
	getCardIsRead,
	selectUserIsAnonymous,
	selectUserStars,
	selectUserReads,
	selectStarsLoaded,
	selectReadsLoaded,
	selectReadingListLoaded,
	selectActiveCollection,
	getCardInReadingList,
	getCardHasStar,
	releasePreviousActiveCollection
} from '../selectors.js';

import {
	autoMarkReadScheduleDecision,
	awaitInteractableCollection,
	NotInteractableError,
	TRANSITIONAL_RECHECK_DELAY_MS
} from './fallback-guard.js';

import {
	UserInfo,
	Card,
	CardID,
	State,
	Uid
} from '../types.js';

import {
	ThunkSomeAction,
	AppThunkDispatch,
	store
} from '../store.js';

import {
	MultiBatch
} from '../multi_batch.js';

import {
	MutationFencedError
} from '../mutation-barrier.js';

import {
	CARDS_COLLECTION,
	STARS_COLLECTION,
	READS_COLLECTION,
	USERS_COLLECTION,
	READING_LISTS_COLLECTION,
	READING_LISTS_UPDATES_COLLECTION
} from '../../shared/collection-constants.js';

import {
	AUTO_MARK_READ_PENDING_CHANGED,
	SIGNIN_FAILURE,
	SIGNIN_CANCELLED,
	SIGNIN_SUCCESS,
	SIGNIN_USER,
	SIGNOUT_SUCCESS,
	SIGNOUT_USER,
	UPDATE_PENDING_AUX_WRITE_COUNT,
	UPDATE_READING_LIST,
	UPDATE_READS,
	UPDATE_STARS
} from '../actions.js';

import {
	LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY,
	LOCAL_STORAGE_HAS_PREVIOUS_REAL_SIGN_IN_KEY
} from '../constants.js';

//The anonymous uid an account switch abandoned, recorded into the real
//account's user doc as previousUids on its next save (ensureUserInfo) — a
//trail nothing reads today, cheap to keep for a migration script that might.
//A uid, not the User: across a redirect only the uid survives (sessionStorage).
let prevAnonymousMergeUid : string | null = null;
const ABANDONED_UID_KEY = 'sign-in-abandoned-uid';

export const saveUserInfo = () : ThunkSomeAction => (_, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (!user) return;

	const batch = new MultiBatch(db);
	ensureUserInfo(batch, user);
	//If we had a merge user, null it out on successful save, so we don't keep saving it.
	batch.commit()
		.then(() => prevAnonymousMergeUid = null)
		.catch(error => {
			//Auth restoration also runs in a deliberately inactive superseded tab.
			//That background bookkeeping is the one safe write to cancel quietly;
			//interactive workflows must continue to observe a failed commit.
			if (!(error instanceof MutationFencedError)) throw error;
		});

};

interface userInfoUpdate {
	lastSeen: FieldValue,
	isAnonymous: boolean,
	previousUids?: FieldValue,
}

export const ensureUserInfo = (batch : MultiBatch, user : UserInfo) => {
	if (!user) return;

	const data : userInfoUpdate = {
		lastSeen: serverTimestamp(),
		isAnonymous: user.isAnonymous,
	};

	//If this is set then we just signed in after a failed merge, so we want to
	//keep record that we failed.
	if (prevAnonymousMergeUid) {
		data.previousUids = arrayUnion(prevAnonymousMergeUid);
		//This will be nulled out in saveUserInfo on successful commit.
	}

	batch.set(doc(db, USERS_COLLECTION, user.uid), data, {merge: true});
};

export const showNeedSignin = () : ThunkSomeAction => (dispatch) => {
	const doSignIn = confirm('Doing that action requires signing in with your Google account. Do you want to sign in?');
	if (!doSignIn) return;
	dispatch(signIn());
};

const SIGNIN_RETRY_ACTION = 'signin-retry';

//The banner holds a serializable actionID, never a function — a thunk in the
//store would break serializability. Registration is LAZY and idempotent, not at
//module scope: app.ts transitively imports this file, so a top-level call here
//runs inside the cycle's temporal dead zone and throws
//"Cannot access 'registerPersistentErrorAction' before initialization" at boot.
//Called from the two thunks that can raise this banner, so it is always
//registered before any banner naming it can exist.
let signInRetryRegistered = false;
const ensureSignInRetryRegistered = () : void => {
	if (signInRetryRegistered) return;
	signInRetryRegistered = true;
	registerPersistentErrorAction(SIGNIN_RETRY_ACTION, signIn());
};

export const signIn = () : ThunkSomeAction => async (dispatch, getState) => {

	ensureSignInRetryRegistered();
	const state = getState();
	const isAnonymous = selectUserIsAnonymous(state);

	dispatch({type:SIGNIN_USER});

	const provider = googleProvider();

	try {
		if (isAnonymous) {
			//We'll only get here if anonymous login was not disabled
			const user = auth.currentUser;
			if (!user) {
				console.warn('Unexpectedly didn\'t have user');
				dispatch({type: SIGNIN_CANCELLED});
				return;
			}
			const linked = await linkWithPopup(user, provider);
			//Linking Google onto the anonymous account keeps the SAME uid, so
			//Firebase's onAuthStateChanged — the app's only sign-in
			//propagation path (user-chip) — does not fire: the signed-in user
			//did not change, only its providers did. Without this dispatch the
			//UI keeps rendering the anonymous session until a manual reload.
			//(Harmless if a future SDK does fire it: signInSuccess is
			//idempotent — its listener connects all disconnect-then-connect.)
			dispatch(signInSuccess(linked.user));
		} else {
			await signInWithPopup(auth, provider);
		}
	} catch (err) {
		//Popup blocked (embedded browsers, popup blockers, some enterprise
		//policies): fall back to the redirect flow instead of leaving the user
		//with a silent failure — previously this error only landed in Redux
		//state and nothing was shown at all. The result is picked up by
		//completeRedirectSignIn() on the next load.
		if (err instanceof FirebaseError && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
			try {
				const current = auth.currentUser;
				if (isAnonymous && current) await linkWithRedirect(current, provider);
				else await signInWithRedirect(auth, provider);
				return;
			} catch (redirectErr) {
				dispatch({type:SIGNIN_FAILURE, error: redirectErr});
				dispatch(reportPersistentError({
					what: 'Google sign-in couldn\u2019t open.',
					reassurance: 'Your browser is blocking the sign-in window. Allow pop-ups for this site, then try again.',
					action: {label: 'Try again', actionID: SIGNIN_RETRY_ACTION},
					dedupeKey: 'signin'
				}));
				return;
			}
		}
		if (err instanceof FirebaseError && err.code === 'auth/credential-already-in-use') {
			await dispatch(handleCredentialInUse(err));
		} else {
			dispatch({type:SIGNIN_FAILURE, error: err});
			//SIGNIN_FAILURE is not rendered anywhere, so without this the user
			//sees NOTHING when sign-in fails — indistinguishable from a dead
			//button, which is what made a blocked popup look like a loop.
			const code = err instanceof FirebaseError ? err.code : '';
			if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
				console.warn('[auth] sign-in failed:', code || err);
				dispatch(reportPersistentError({
					what: 'Sign in didn\u2019t complete.',
					//The auth code goes to the console, not the banner: HS-2.4 names
					//"a Firebase auth code" as a thing never to interpolate into copy.
					reassurance: 'If it keeps failing, allow pop-ups for this site.',
					action: {label: 'Try again', actionID: SIGNIN_RETRY_ACTION},
					dedupeKey: 'signin'
				}));
			}
		}
	}
};

//Completes a redirect-based sign-in (the popup-blocked fallback). Must run
//on boot: a redirect LINK keeps the same uid, so onAuthStateChanged does not
//fire for it — the same reason the popup link path dispatches explicitly.
export const completeRedirectSignIn = () : ThunkSomeAction => async (dispatch) => {
	ensureSignInRetryRegistered();
	try {
		const result = await getRedirectResult(auth);
		if (result?.user) {
			//A fresh sign-in (never a link) that the switch path started by
			//redirect: the abandoned anonymous uid rode along in
			//sessionStorage, the only thing that has to survive the trip —
			//for the previousUids trail, and for the queue discard the
			//navigation cut short.
			const abandonedUid = takeAbandonedUid();
			if (abandonedUid) {
				prevAnonymousMergeUid = abandonedUid;
				discardPendingAuxWritesForUid(abandonedUid);
			}
			dispatch(signInSuccess(result.user));
		}
	} catch (err) {
		//SIGNIN_FAILURE renders nowhere, and this is the RETURN leg of a
		//redirect the user deliberately started: failing silently leaves them
		//anonymous, staring at a sign-in button that appears to do nothing, in
		//a loop. The popup path already surfaces its failures the same way.
		const code = (err as {code? : string})?.code || '';
		console.warn('[auth] redirect sign-in failed:', code || err);
		if (err instanceof FirebaseError && code === 'auth/credential-already-in-use') {
			//The same question the popup leg asks, through the same thunk.
			//This leg used to show a banner with no way forward: the account
			//menu ran the same link again, which failed the same way (#789).
			dispatch({type:SIGNIN_USER});
			await dispatch(handleCredentialInUse(err));
			return;
		}
		dispatch({type:SIGNIN_FAILURE, error: err instanceof Error ? err : new Error(String(err))});
		dispatch(reportPersistentError({
			what: 'Sign in didn\u2019t complete.',
			reassurance: 'Nothing about your account has changed. You can try again.',
			action: {label: 'Try again', actionID: SIGNIN_RETRY_ACTION},
			dedupeKey: 'signin'
		}));
	}
};

//Google's account picker, so a user signed in as A who wants B is offered
//the choice instead of Google quietly reusing A (#789).
const googleProvider = () : GoogleAuthProvider => {
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({prompt: 'select_account'});
	return provider;
};

const rememberAbandonedUid = (uid : string) : void => {
	try {
		sessionStorage.setItem(ABANDONED_UID_KEY, uid);
	} catch {
		//Best effort: the trail is bookkeeping, not the sign-in.
	}
};

const takeAbandonedUid = () : string | null => {
	try {
		const uid = sessionStorage.getItem(ABANDONED_UID_KEY);
		if (uid) sessionStorage.removeItem(ABANDONED_UID_KEY);
		return uid;
	} catch {
		return null;
	}
};

//A sign-in that is NEVER a link: for switching to an existing account when
//the credential from the failed link cannot be used (expired, or absent).
//Popup first; redirect when the popup is blocked; the result of a redirect
//comes back through completeRedirectSignIn.
const freshSignIn = async (abandonedUid : string) : Promise<void> => {
	const provider = googleProvider();
	try {
		await signInWithPopup(auth, provider);
	} catch (err) {
		if (!(err instanceof FirebaseError) || (err.code !== 'auth/popup-blocked' && err.code !== 'auth/operation-not-supported-in-this-environment')) throw err;
		rememberAbandonedUid(abandonedUid);
		await signInWithRedirect(auth, provider);
	}
};

//THE EXISTING-ACCOUNT CASE, ONE WAY FOR BOTH LEGS (#789). Linking Google onto
//the anonymous account failed because that Google account is already a user
//of its own; the only way forward is to switch to it and leave this session's
//stars, reads and reading list under the anonymous uid. Whether to ask first
//is mergeDecision's (something to lose, or counts not yet known); the question
//is the destructive-confirm dialog's, through the seam that replaces the
//native confirm the popup leg used to call — which the embedded browsers that
//block the popup also suppress, answering "no" for the user and leaving
//`pending` stuck. The redirect leg used to have no path at all.
//
//The credential comes from the failed link on either leg, so the switch is a
//signInWithCredential with no further round trip; if it is missing or has
//expired, a fresh sign-in — never a link, which would fail the same way —
//takes over, so this cannot loop.
export const handleCredentialInUse = (err : FirebaseError) : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const stars = Object.keys(selectUserStars(state)).length;
	const reads = Object.keys(selectUserReads(state)).length;
	const readingList = selectUserReadingList(state).length;
	const loaded = selectStarsLoaded(state) && selectReadsLoaded(state) && selectReadingListLoaded(state);
	const decision = mergeDecision({stars, readingList, reads, loaded});
	const abandonedUid = selectUid(state);
	if (decision.kind === 'ask') {
		const go = await confirmDestructive(switchAccountQuestion(decision.lose));
		if (!go) {
			dispatch({type: SIGNIN_CANCELLED});
			return;
		}
	}
	//Re-check after the await (src/modal.ts): the world moved on while the
	//question was open. Only the same anonymous session may be abandoned.
	const current = auth.currentUser;
	if (!current || !current.isAnonymous || current.uid !== abandonedUid) {
		dispatch({type: SIGNIN_CANCELLED});
		return;
	}
	const credential : AuthCredential | null = GoogleAuthProvider.credentialFromError(err);
	prevAnonymousMergeUid = abandonedUid;
	try {
		if (credential) {
			try {
				await signInWithCredential(auth, credential);
			} catch (credentialErr) {
				console.warn('[auth] switching with the link\u2019s credential failed; signing in afresh:', credentialErr instanceof FirebaseError ? credentialErr.code : credentialErr);
				await freshSignIn(abandonedUid);
			}
		} else {
			await freshSignIn(abandonedUid);
		}
	} catch (signInErr) {
		prevAnonymousMergeUid = null;
		const code = signInErr instanceof FirebaseError ? signInErr.code : '';
		dispatch({type:SIGNIN_FAILURE, error: signInErr instanceof Error ? signInErr : new Error(String(signInErr))});
		if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
		console.warn('[auth] account switch failed:', code || signInErr);
		dispatch(reportPersistentError({
			what: 'Sign in didn\u2019t complete.',
			reassurance: 'Nothing on this device has changed. You can try again.',
			action: {label: 'Try again', actionID: SIGNIN_RETRY_ACTION},
			dedupeKey: 'signin'
		}));
		return;
	}
	//The abandoned session's queued stars, reads and reading-list changes
	//would never replay and would be counted as waiting for up to 30 days.
	discardPendingAuxWritesForUid(abandonedUid);
	if (decision.kind === 'switch') {
		//Silent otherwise, and the user may notice their read marks changed.
		dispatch(showSnackbar('You\u2019re signed in to your existing account.'));
	}
};

export const signOutSuccess = () : ThunkSomeAction => (dispatch) =>  {

	//Note that this is actually called anytime onAuthStateChange notices we're not signed
	//in, which can both be a manual sign out, as well as a page load with no user.

	//If the user hasn't previously signed in on this device, then this might be
	//a first page load. Try to do an anonymous account.
	if (!hasPreviousSignIn() && !DISABLE_ANONYMOUS_LOGIN) {
		signInAnonymously(auth);
		return;
	}

	dispatch({type: SIGNOUT_SUCCESS});
	//#768: release the one-generation corpus retainer eagerly on auth-scope
	//change; the old user's collection must not seed the next user's.
	releasePreviousActiveCollection();
	disconnectLiveStars();
	disconnectLiveReads();
	disconnectLiveReadingList();
	disconnectLivePermissions();
};

const flagHasPreviousRealSignIn = () => {
	try {
		localStorage.setItem(LOCAL_STORAGE_HAS_PREVIOUS_REAL_SIGN_IN_KEY, '1');
	} catch {
		//Best effort; reader routing degrades to the reader path.
	}
};

const flagHasPreviousSignIn = () => {
	//Safari in private mode will throw if you try to set
	try {
		localStorage.setItem(LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY, '1');
	} catch(err) {
		console.warn('Couldn\'t set has previous sign in: ' + err);
	}
};

const hasPreviousSignIn = () => {
	return localStorage.getItem(LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY) ? true : false;
};

const ensureRichestDataForUser = (firebaseUser : User) : ThunkSomeAction => async (dispatch) => {
	//Whatever the first account was will be the default photoUrl, displayName,
	//etc. So if your first account was an anonymous one (no photoUrl or
	//displayName) then even when you sign in with e.g. gmail we'll still have
	//your old photoURL. So here we update that, which really only needs to run
	//that once.

	if (firebaseUser.isAnonymous) return;

	if (firebaseUser.photoURL && firebaseUser.displayName && firebaseUser.email) return;

	let bestPhotoURL = null;
	let bestDisplayName = null;
	let bestEmail = null;

	for (const userInfo of firebaseUser.providerData) {
		if (!bestPhotoURL && userInfo.photoURL) bestPhotoURL = userInfo.photoURL;
		if (!bestDisplayName && userInfo.displayName) bestDisplayName = userInfo.displayName;
		if (!bestEmail && userInfo.email) bestEmail = userInfo.email;
	}

	//Even after updating the user we need to tell the UI it's updated.
	if (!bestPhotoURL && !bestDisplayName && !bestEmail) return;

	if (bestPhotoURL || bestDisplayName) {
		await updateProfile(firebaseUser, {
			photoURL: bestPhotoURL,
			displayName: bestDisplayName,
		});
		//firebaseUser has now been updated in place, based on testing in
		//Chrome.
	}

	if (bestEmail && !firebaseUser.email) {
		//Note that in our testing, after merging an anon account into a gmail
		//account, email is automatically set but displayName and photoURL are not,
		//so this won't run. But that's not documented anywhere so might as well do
		//this just in case to be safe.
		await updateEmail(firebaseUser, bestEmail);
	}

	dispatch(updateUserInfo(firebaseUser));

};

const updateUserInfo = (firebaseUser : User) : ThunkSomeAction => (dispatch) => {
	const info = _userInfo(firebaseUser);
	dispatch({
		type: SIGNIN_SUCCESS,
		user: info,
	});
	//#768: as on sign-out — a sign-in is the other half of an account
	//switch, and runs harmlessly at boot when nothing is held yet.
	releasePreviousActiveCollection();
};

//signInSuccess runs on every auth resolution; the queue-depth mirror below
//must only be registered once per page.
let auxWriteDepthListenerInstalled = false;

export const signInSuccess = (firebaseUser : User) : ThunkSomeAction => (dispatch) => {

	//Note that even when this is done, selectUserSignedIn might still return
	//false, if the user is signed in anonymously.

	dispatch(ensureRichestDataForUser(firebaseUser));

	dispatch(updateUserInfo(firebaseUser));

	dispatch(saveUserInfo());
	//ALWAYS set, including for anonymous sign-ins: this marker's job is to
	//stop signOutSuccess from calling signInAnonymously again on the next
	//null-auth event. Clearing it for anonymous users (an earlier attempt to
	//make the reader path reachable) removed that guard and let the popup
	//sign-in flow mint anonymous users in a loop.
	flagHasPreviousSignIn();
	//Reader routing uses its OWN signal, set only by a real sign-in, so a
	//device that has genuinely signed in skips the reader fast path.
	if (!firebaseUser.isAnonymous) flagHasPreviousRealSignIn();
	connectLivePermissions(firebaseUser.uid);
	connectLiveStars(firebaseUser.uid);
	//Replay any aux writes (stars/reads/reading-list) that were queued
	//durably but never server-confirmed — e.g. made offline before a reload.
	//The provider reads LIVE state so sign-out/account switches stop replays
	//of the old uid's intents (a captured uid would replay them under the
	//new auth and permanently drop them as permission-denied).
	installAuxWriteReplayWatcher(() => selectUid(store.getState() as State));
	//Mirror the queue's depth into Redux so the corpus status indicator can
	//show "changes waiting to reach the server" without any selector ever
	//reading localStorage. The queue pushes on every enqueue/dequeue; the
	//registration itself reports the current depth (intents surviving from a
	//previous session). Guarded: this sign-in path runs on every auth
	//resolution, and a duplicate listener would just dispatch twice.
	if (!auxWriteDepthListenerInstalled) {
		auxWriteDepthListenerInstalled = true;
		onAuxWriteQueueDepthChanged(count => store.dispatch({type: UPDATE_PENDING_AUX_WRITE_COUNT, count}));
	}
	//Undo optimistic per-user updates whose intent the queue later gives up on.
	//Installed beside the replay watcher because the replay loop is where most
	//terminal discards actually happen.
	installOptimisticUserStateReconciler();
	connectLiveReads(firebaseUser.uid);
	connectLiveReadingList(firebaseUser.uid);
};

const _userInfo = (info : User) : UserInfo => {
	return {
		uid: info.uid,
		isAnonymous: info.isAnonymous,
		photoURL: info.photoURL || '',
		displayName: info.displayName || '',
		email: info.email || ''
	};
};

export const signOut = () : ThunkSomeAction => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (!user) return;
	//We don't sign out anonymous users
	if (user.isAnonymous) return;

	dispatch({type:SIGNOUT_USER});
	flagHasPreviousSignIn();
	//signOut refuses anonymous users above, so reaching here proves a real
	//sign-in happened on this device — keep routing it to exclusive ownership
	//even though it is now signed out.
	flagHasPreviousRealSignIn();
	firebaseSignOut(auth);
};

//OPTIMISTIC APPLICATION for per-user state.
//
//These toggles never applied anything locally: the star/read/reading-list UI was
//painted entirely by the listener echo, which was instant only because the write
//and the listener shared one Firestore instance (latency compensation fires on
//the pending mutation). The listeners now live in the CORPUS WORKER — the only
//context with a persistent cache, so re-attach bills deltas rather than the
//whole result set — and that worker's instance knows nothing about this thread's
//pending write. Without applying locally, every toggle would wait for a server
//round trip before it visibly did anything.
//
//`apply` runs the moment the user acts. A later identical echo is harmless: the
//stars and reads reducers are set-based (setUnion/setRemove), so re-applying is
//a no-op.
//
//WHAT THIS DELIBERATELY DOES NOT DO is decide the outcome from its own first
//attempt. 'queued' is NOT terminal: runDurableAuxWrite answers 'queued' for
//anything retryable and returns, and the intent can still die much later — on a
//replay that hits a permanent failure (the card was deleted meanwhile), or by
//ageing out after 30 days. Neither of those can reach a closure that has already
//returned, so an earlier version left a discarded star visibly starred for the
//rest of the session. Terminal discards are reconciled by the subscriber
//installed in installOptimisticUserStateReconciler instead.
//
//A THROW is still handled here, because it is the one failure with no intent to
//be discarded later: if it threw before persisting there is nothing to notify.
//D7: these six actions each swallowed the guard's refusal into a console.log
//and returned. The user taps star, or read, or add-to-reading-list, and nothing
//happens at all — no change, no message, an unmarked dead control. The copy to
//explain it already existed; awaitInteractableCollection throws it, and it was
//being thrown away one line later, six times over.
//
//Deduped on one key across all six, because they share a cause: if the view is
//still catching up, mashing three different controls is one situation, not
//three.
const reportGuardRefusal = (dispatch : AppThunkDispatch, err : unknown) : void => {
	console.log(err);
	//ONLY the guard's own refusals are copy. This used to render
	//`err.message || String(err)` unconditionally, so any other throw from
	//inside the awaited expression — a selector TypeError, say — went verbatim
	//to a toast, which is precisely what HS-2.4 forbids. The catch is broad
	//because it must be; the RENDERING is what has to be narrow.
	if (err instanceof NotInteractableError) {
		dispatch(showSnackbar(err.message, {kind: 'refused', dedupeKey: 'collection-not-interactable'}));
		return;
	}
	dispatch(showSnackbar('That didn\u2019t work. Try again in a moment.', {kind: 'refused', dedupeKey: 'collection-not-interactable'}));
};

//D24: this used to revert in silence. The user taps the star, it fills, and
//then it un-fills itself with no explanation — which reads as the app being
//broken or as the tap not having registered, and the natural response is to tap
//again, into the same failure.
//
//`run()` THROWING is the narrow case where the write could not even be enqueued,
//so unlike a queued or discarded write there is nothing pending and nothing to
//retry in the background: the action simply did not happen. That is transient
//and entirely retryable by hand, so it is a snackbar rather than a banner —
//the durable-loss surfaces stay reserved for durable loss.
const applyOptimistically = async (
	kind : AuxWriteKind,
	apply : () => void,
	revert : () => void,
	run : () => Promise<AuxWriteOutcome>
) : Promise<void> => {
	apply();
	try {
		await run();
	} catch (err) {
		console.warn('[user-state] durable write failed before it could be persisted; reverting the optimistic update:', err);
		revert();
		//Deduped per kind: mashing a star produces one message, not six.
		store.dispatch(showSnackbar(`${capitalize(auxWriteLabelForKind(kind))} didn\u2019t go through, so it has been undone.`, {kind: 'refused', dedupeKey: `optimistic-${kind}`}));
	}
};

//Undo the optimistic effect of an intent that the queue has now given up on,
//whenever that happens. Computed from the state as it stands at revert time
//rather than from a snapshot captured when the user acted: a stale whole-list
//restore would discard a concurrent successful change to the same list.
//A FULL re-delivery replaces the set instead of unioning into it, and then the
//user's still-PENDING writes are overlaid on top.
//
//Both halves matter. Without the replace, a re-attach could never express a
//removal: Firestore reports the whole set as `added`, the reducer unions it in,
//and a star the user had just removed came back. Without the overlay, the
//replace would itself discard the removal — the server legitimately still has
//that star, because the write has not landed yet. The pending queue IS the
//record of what the user has done but the server has not yet acknowledged, so
//replaying it over authoritative state is what makes the two agree.
//
//This also repairs a case that predates the optimistic layer: after a reload,
//queued-but-unsent actions used to be invisible until they committed.
const overlayPendingUserIntents = (serverIDs : CardID[], addKind : AuxWriteKind, removeKind : AuxWriteKind, uid : string) : Set<CardID> => {
	const result = new Set(serverIDs);
	for (const intent of readPendingAuxWrites()) {
		if (intent.uid !== uid) continue;
		if (intent.kind === addKind) result.add(intent.cardID);
		else if (intent.kind === removeKind) result.delete(intent.cardID);
	}
	return result;
};

//Expressed through the existing set-based action rather than a new "replace"
//one: computing the removals explicitly means setUnion/setRemove produce the
//replacement, and the `*Loaded` semantics stay exactly as they were.
const applyAuthoritativeSet = (
	current : {[id : CardID] : unknown},
	desired : Set<CardID>
) : {added : CardID[], removed : CardID[]} => ({
	added: [...desired],
	removed: Object.keys(current).filter(id => !desired.has(id)),
});

//The reading list needs the same treatment as stars and reads, and did not get
//it: the bridge replaced it wholesale on every worker delivery. EVERY delivery
//is a full list, and post-error re-attach is now routine thanks to the listener
//retry — so queueing an add on a flaky connection and then receiving any
//delivery visibly reversed the user's action.
//
//Order is meaningful here, unlike the sets, so this rebuilds from the server's
//ORDER and then applies pending intents: an add appends (matching the
//server-side arrayUnion) and a remove deletes in place.
export const receiveAuthoritativeReadingList = (serverList : CardID[]) : ThunkSomeAction => (dispatch, getState) => {
	const uid = selectUid(getState());
	const result = [...serverList];
	for (const intent of readPendingAuxWrites()) {
		if (intent.uid !== uid) continue;
		if (intent.kind === 'reading-list-add') {
			if (!result.includes(intent.cardID)) result.push(intent.cardID);
		} else if (intent.kind === 'reading-list-remove') {
			const at = result.indexOf(intent.cardID);
			if (at >= 0) result.splice(at, 1);
		}
	}
	dispatch(updateReadingList(result));
};

export const receiveAuthoritativeStars = (serverIDs : CardID[]) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const desired = overlayPendingUserIntents(serverIDs, 'star-add', 'star-remove', selectUid(state));
	const {added, removed} = applyAuthoritativeSet(state.user?.stars || {}, desired);
	dispatch(updateStars(added, removed));
};

export const receiveAuthoritativeReads = (serverIDs : CardID[]) : ThunkSomeAction => (dispatch, getState) => {
	const state = getState();
	const desired = overlayPendingUserIntents(serverIDs, 'read-add', 'read-remove', selectUid(state));
	const {added, removed} = applyAuthoritativeSet(state.user?.reads || {}, desired);
	dispatch(updateReads(added, removed));
};

let optimisticReconcilerInstalled = false;

export const installOptimisticUserStateReconciler = () : void => {
	//Sign-in runs on every auth change, and a second subscriber would revert
	//twice. Most of these reverts are idempotent, but relying on that is not a
	//reason to register the same listener repeatedly.
	if (optimisticReconcilerInstalled) return;
	optimisticReconcilerInstalled = true;
	onAuxWriteDiscarded(intent => {
		//These reverts are unconditional deltas, which is very slightly lossy in
		//one narrow case: if a queued star-add is discarded weeks later (the
		//30-day age-out) and the user has SUCCESSFULLY re-starred the same card
		//in between, this removes the legitimate star locally. It self-heals on
		//the next authoritative re-delivery, which now exists. Consulting the
		//server per discard would close it, and costs more than it buys.
		const cardID = intent.cardID;
		if (!cardID) return;
		//An intent belonging to a PREVIOUS account can be discarded after a
		//switch (its replay earns permission-denied under the new auth, which is
		//classified permanent). Reverting then would corrupt the new user's
		//state with the old user's action.
		if (intent.uid !== selectUid(store.getState() as State)) return;
		switch (intent.kind) {
		case 'star-add':
			store.dispatch(updateStars([], [cardID], true));
			return;
		case 'star-remove':
			store.dispatch(updateStars([cardID], [], true));
			return;
		case 'read-add':
			store.dispatch(updateReads([], [cardID], true));
			return;
		case 'read-remove':
			store.dispatch(updateReads([cardID], [], true));
			return;
		case 'reading-list-add': {
			const list = selectUserReadingList(store.getState() as State);
			if (list.includes(cardID)) store.dispatch(updateReadingList(list.filter((id : CardID) => id !== cardID), true));
			return;
		}
		case 'reading-list-remove': {
			const list = selectUserReadingList(store.getState() as State);
			if (!list.includes(cardID)) store.dispatch(updateReadingList([...list, cardID], true));
			return;
		}
		default:
			//Other kinds (card-create, comments, card-delete) have their own
			//reporting and no optimistic per-user state to undo.
			return;
		}
	});

};

//REGISTERED AT MODULE SCOPE, ON PURPOSE. These first lived inside
//installOptimisticUserStateReconciler, which only runs once sign-in completes —
//and test/comment-executors caught that immediately: a comment edit discarded
//before then told the user nothing, which is precisely the silent-discard
//failure mode this branch keeps rediscovering. Reporting that a write was lost
//must not be contingent on any install step having happened first.
//
//Safe at module scope where a registerPersistentErrorAction call was not: this
//imports from aux-write-queue.js, which does not import back, and
//reportPersistentError is only dereferenced when the callback FIRES, long after
//the app.ts cycle has settled.
//ONE DEDUPE KEY FOR BOTH, per INTENT. Two keys looked tidier and was a defect:
//stuck and discarded are two states of the SAME write, and an intent normally
//passes through stuck on its way to discarded (always, for anything that hits
//the 30-day age-out). With separate keys the user ends up holding both banners
//at once — "still saved on this device and being retried" sitting directly
//above "given up on" — with no way to clear the false one except by hand. That
//is the two-surfaces-contradicting-each-other failure HS-2.4 opens with.
//Sharing the key means the discard REPLACES the stuck notice in place.
//
//Keyed on intent.id, NOT intent.kind. The id is minted exactly once, in
//makeAuxWriteIntent, and rides the intent unchanged through its whole
//stuck-then-discarded lifecycle, so the same-write replacement above still
//holds. The kind-based key went further than that justification: two
//DIFFERENT lost writes of the same kind — two comments on different cards
//discarded in one replay pass — collapsed into one banner, and the reducer's
//replace-in-place meant the user was told about the second loss and never
//the first.
const auxWriteBannerKey = (intent : AuxWriteIntent) : string => `aux-write-${intent.id}`;

onAuxWriteDiscarded((intent, detail) => {
	//The raw error goes to the console, never into the banner: HS-2.4 forbids
	//interpolating String(err) into user-facing text, and these messages come
	//straight from the Firestore SDK ("Missing or insufficient permissions").
	//Unlike the composed messages modifyCardFailure passes through, nothing
	//here was written for a reader.
	console.warn(`[aux-write] ${intent.kind} discarded:`, detail);
	if (!auxWriteBelongsToCurrentUser(intent)) return;
	store.dispatch(reportPersistentError({
		//Not "couldn't be saved": the labels are gerunds, so that produced
		//"Saving your edit to that comment couldn't be saved."
		what: `${capitalize(auxWriteLabel(intent))} didn\u2019t go through, and won\u2019t be retried again.`,
		reassurance: 'You can try it again.',
		dedupeKey: auxWriteBannerKey(intent)
	}));
});

onAuxWriteStuck((intent, detail) => {
	console.warn(`[aux-write] ${intent.kind} is stuck:`, detail);
	if (!auxWriteBelongsToCurrentUser(intent)) return;
	store.dispatch(reportPersistentError({
		what: `${capitalize(auxWriteLabel(intent))} isn\u2019t going through.`,
		//The reassurance is the whole point of the queued state (§3.6): the work
		//is not lost, it is still being retried, and nothing is asked of them.
		reassurance: 'Your change is still saved on this device and is being retried.',
		dedupeKey: auxWriteBannerKey(intent)
	}));
});

export const updateStars = (starsToAdd : CardID[] = [], starsToRemove : CardID[] = [], optimistic = false) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_STARS,
		starsToAdd,
		starsToRemove,
		optimistic
	});
	dispatch(refreshCardSelector(false));
};

export const toggleOnReadingList = (cardToToggle : CardID) : ThunkSomeAction => (dispatch, getState) => {

	if (!cardToToggle) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const onReadingList = getCardInReadingList(state, cardToToggle);

	dispatch(onReadingList ? removeFromReadingList(cardToToggle) : addToReadingList(cardToToggle));
};

//The shared preamble of the six user-state thunks below: resolve the acting
//uid, hold the action until the active collection is concrete (#767), and only
//then confirm the SAME account is still the one acting. One helper because the
//guard block was copy-pasted six times and the post-await re-check has to ride
//every copy.
//
//RE-CHECK AFTER THE AWAIT, per modal.ts's rule (createForkedCard in
//actions/data.ts sets the pattern): awaitInteractableCollection can defer for
//up to three seconds during a worker cutover, and a sign-out or a cross-tab
//account takeover can land inside that window. A uid captured before the await
//is then the WRONG account. Minting a durable intent under it earns a
//permanent rules rejection on the immediate attempt — or a transient failure
//that the uid-filtered replay will never retry — while
//auxWriteBelongsToCurrentUser (correctly) suppresses the discard banner: a
//silent durable loss. And the optimistic apply that follows would pollute the
//NEW account's local state with the old account's action.
//
//The abandonment is DELIBERATELY silent, unlike the guard refusal one branch
//up: the account that took the action is gone from this tab, so there is
//nobody the refusal toast would be for — the person now looking at the screen
//did not take this action, and telling them about it is the same
//cross-account leak the uid filters elsewhere in this file exist to prevent.
//
//`silentRefusal` is for the auto-mark-read timer, the one caller that is not
//a user tap: D7's refusals-must-speak rule is about unmarked dead CONTROLS,
//and a background timer declining is not a dead control — a refused toast for
//it complains about an action the user never took.
const guardedActingUid = async (
	dispatch : AppThunkDispatch,
	getState : () => State,
	silentRefusal = false
) : Promise<Uid | null> => {
	const uid = selectUid(getState());

	if (!uid) {
		console.log('Not logged in');
		return null;
	}

	//#767: the transitional cutover placeholder's isFallback:false is a
	//guess; wait for the concrete collection instead of acting on it, and
	//refuse (like fallback) if it never resolves.
	try {
		await awaitInteractableCollection(() => selectActiveCollection(getState()));
	} catch (err) {
		if (silentRefusal) {
			console.log('Declining a non-user-initiated action the guard refused:', err);
			return null;
		}
		reportGuardRefusal(dispatch, err);
		return null;
	}

	if (selectUid(getState()) !== uid) {
		console.log('The signed-in account changed while the action was deferred; abandoning it');
		return null;
	}

	return uid;
};

export const addToReadingList = (cardToAdd : CardID) : ThunkSomeAction => async (dispatch, getState) => {
	if (!cardToAdd) {
		console.log('Invalid card provided');
		return;
	}

	const uid = await guardedActingUid(dispatch, getState);
	if (uid === null) return;

	//The reading list is an ORDERED array replaced wholesale, so the optimistic
	//value is computed from the list as it stands rather than expressed as a
	//delta. Appending matches the server-side arrayUnion.
	void applyOptimistically(
		'reading-list-add',
		() => {
			const list = selectUserReadingList(getState());
			if (!list.includes(cardToAdd)) dispatch(updateReadingList([...list, cardToAdd], true));
		},
		() => {
			const list = selectUserReadingList(getState());
			if (list.includes(cardToAdd)) dispatch(updateReadingList(list.filter((id : CardID) => id !== cardToAdd), true));
		},
		() => runDurableAuxWrite(makeAuxWriteIntent(uid, 'reading-list-add', cardToAdd, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)));
};

export const removeFromReadingList = (cardToRemove : CardID) : ThunkSomeAction => async (dispatch, getState) => {
	if (!cardToRemove) {
		console.log('Invalid card provided');
		return;
	}

	const uid = await guardedActingUid(dispatch, getState);
	if (uid === null) return;

	void applyOptimistically(
		'reading-list-remove',
		() => {
			const list = selectUserReadingList(getState());
			if (list.includes(cardToRemove)) dispatch(updateReadingList(list.filter((id : CardID) => id !== cardToRemove), true));
		},
		() => {
			const list = selectUserReadingList(getState());
			if (!list.includes(cardToRemove)) dispatch(updateReadingList([...list, cardToRemove], true));
		},
		() => runDurableAuxWrite(makeAuxWriteIntent(uid, 'reading-list-remove', cardToRemove, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)));
};

export const addStar = (cardToStar : Card | null) : ThunkSomeAction => async (dispatch, getState) => {

	if (!cardToStar || !cardToStar.id) {
		console.log('Invalid card provided');
		return;
	}

	const uid = await guardedActingUid(dispatch, getState);
	if (uid === null) return;

	const starredID = cardToStar.id;
	//Re-check AFTER the guard: two clicks landing inside one deferral window
	//would both see the pre-click state and enqueue two increments for one
	//user-star (the review executed exactly that). The reads and reading-list
	//tails are naturally idempotent; the star counter is not.
	if (getCardHasStar(getState(), starredID)) {
		console.log('The card is already starred!');
		return;
	}
	void applyOptimistically(
		'star-add',
		() => dispatch(updateStars([starredID], [], true)),
		() => dispatch(updateStars([], [starredID], true)),
		() => runDurableAuxWrite(makeAuxWriteIntent(uid, 'star-add', starredID)));
};

export const removeStar = (cardToStar : Card | null) : ThunkSomeAction => async (dispatch, getState) => {
	if (!cardToStar || !cardToStar.id) {
		console.log('Invalid card provided');
		return;
	}

	const uid = await guardedActingUid(dispatch, getState);
	if (uid === null) return;

	const unstarredID = cardToStar.id;
	//Symmetric with addStar: a doubled remove would decrement twice.
	if (!getCardHasStar(getState(), unstarredID)) {
		console.log('The card isn\'t starred!');
		return;
	}
	void applyOptimistically(
		'star-remove',
		() => dispatch(updateStars([], [unstarredID], true)),
		() => dispatch(updateStars([unstarredID], [], true)),
		() => runDurableAuxWrite(makeAuxWriteIntent(uid, 'star-remove', unstarredID)));
};

export const updateReads = (readsToAdd : CardID[] = [], readsToRemove : CardID[] = [], optimistic = false) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_READS,
		readsToAdd,
		readsToRemove,
		optimistic
	});
	dispatch(refreshCardSelector(false));
};

export const updateReadingList = (list : CardID[] = [], optimistic = false) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_READING_LIST,
		list,
		optimistic
	});
	dispatch(refreshCardSelector(false));
};

let autoMarkReadTimeoutId : number | null = null;

export const scheduleAutoMarkRead = (transitionalAttempt = 0) : ThunkSomeAction => (dispatch, getState) => {

	//This used to be a bare cancelPendingAutoMarkRead() call, which discarded
	//the thunk without running it: navigating card-to-card within the 5s
	//window left the old timer live, and the deferral chain below relies on
	//cancellation actually working.
	dispatch(cancelPendingAutoMarkRead());

	const state = getState();
	const uid = selectUid(state);
	if (!uid) return;

	//#767: the transitional cutover placeholder claims isFallback:false as a
	//guess. Scheduling off it started the pending animation on every
	//navigation to an orphaned card — and had a cutover ever outlasted the
	//timer, the fire-time re-check would have trusted the same guess and
	//committed the read this guard exists to prevent. Defer instead, riding
	//autoMarkReadTimeoutId so any navigation's cancel also kills the re-check
	//chain, and start the real timer (and animation) only once the collection
	//is concrete.
	const decision = autoMarkReadScheduleDecision(selectActiveCollection(state), transitionalAttempt);
	if (decision === 'skip' || decision === 'give-up') return;
	if (decision === 'defer') {
		autoMarkReadTimeoutId = window.setTimeout(() => dispatch(scheduleAutoMarkRead(transitionalAttempt + 1)), TRANSITIONAL_RECHECK_DELAY_MS);
		return;
	}

	const activeCard = selectActiveCard(state);
	if (!activeCard) return;
	if (getCardIsRead(state, activeCard.id)) return;

	autoMarkReadTimeoutId = window.setTimeout(() => dispatch(markActiveCardReadIfLoggedIn()), AUTO_MARK_READ_DELAY);

	dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: true});
};

export const cancelPendingAutoMarkRead = () : ThunkSomeAction => (dispatch) => {
	if (autoMarkReadTimeoutId) {
		dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
		clearTimeout(autoMarkReadTimeoutId);
		autoMarkReadTimeoutId = null;
	}
};

export const markActiveCardReadIfLoggedIn = () : ThunkSomeAction => (dispatch, getState) => {
	//It's the responsibility of the thing that scheduled this to ensure that it
	//only fires if the card we wnat to mark read is still active.
	const state = getState();
	const uid = selectUid(state);
	if (!uid) return;
	//#767: if the cutover outlasted the timer, the placeholder's verdict
	//still cannot be trusted at fire time. Start the wait over; the concrete
	//collection decides.
	const activeCollection = selectActiveCollection(state);
	if (activeCollection && activeCollection.isTransitional) {
		dispatch(scheduleAutoMarkRead());
		return;
	}
	//#767 the other direction: a cutover can also RESOLVE to fallback content
	//while the timer runs. autoMarkReadScheduleDecision already answers 'skip'
	//for a fallback collection at schedule time; without the same answer at
	//fire time this fell through to markRead, whose guard threw, and the
	//refusal toast complained about an auto-action the user never took.
	//markRead's auto path now declines its guard silently too (belt and
	//braces), but the right outcome is to never attempt the read at all — and
	//to take the pending animation down, since the read it promised is off.
	if (activeCollection && activeCollection.isFallback) {
		dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
		return;
	}
	const activeCard = selectActiveCard(state);
	if (!activeCard) return;
	dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
	dispatch(markRead(activeCard, true));
};

export const markRead = (cardToMarkRead : Card | null, existingReadDoesNotError? : boolean) : ThunkSomeAction => async (dispatch, getState) => {

	if (!cardToMarkRead || !cardToMarkRead.id) {
		console.log('Invalid card provided');
		return;
	}

	//`existingReadDoesNotError` is only ever passed by the auto-mark-read
	//timer (markActiveCardReadIfLoggedIn), so it doubles as "this is not a
	//user tap": a guard refusal on that path declines silently instead of
	//rendering a refused toast for an action the user never took.
	const uid = await guardedActingUid(dispatch, getState, existingReadDoesNotError);
	if (uid === null) return;

	if (getCardIsRead(getState(), cardToMarkRead.id)) {
		if (!existingReadDoesNotError) {
			console.log('The card is already read!');
			return;
		}
	}

	const readID = cardToMarkRead.id;
	void applyOptimistically(
		'read-add',
		() => dispatch(updateReads([readID], [], true)),
		() => dispatch(updateReads([], [readID], true)),
		() => runDurableAuxWrite(makeAuxWriteIntent(uid, 'read-add', readID)));
};

export const markUnread = (cardToMarkUnread : Card | null) : ThunkSomeAction => async (dispatch, getState) => {
	if (!cardToMarkUnread || !cardToMarkUnread.id) {
		console.log('Invalid card provided');
		return;
	}

	const uid = await guardedActingUid(dispatch, getState);
	if (uid === null) return;

	if (!getCardIsRead(getState(), cardToMarkUnread.id)) {
		console.log('Card isn\'t read!');
		return;
	}

	//Just in case we were planning on setting this card as read. This used
	//to be a bare call, which discarded the thunk without running it.
	dispatch(cancelPendingAutoMarkRead());

	const unreadID = cardToMarkUnread.id;
	void applyOptimistically(
		'read-remove',
		() => dispatch(updateReads([], [unreadID], true)),
		() => dispatch(updateReads([unreadID], [], true)),
		() => runDurableAuxWrite(makeAuxWriteIntent(uid, 'read-remove', unreadID)));
};
