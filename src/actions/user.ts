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
	OAuthProvider
} from 'firebase/auth';

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

import {
	registerAuxWriteExecutor,
	makeAuxWriteIntent,
	runDurableAuxWrite,
	installAuxWriteReplayWatcher,
	AuxWriteIntent
} from '../aux-write-queue.js';

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
	getCardIsRead,
	selectUserIsAnonymous,
	selectActiveCollection,
	getCardInReadingList
} from '../selectors.js';

import {
	UserInfo,
	Card,
	CardID,
	State
} from '../types.js';

import {
	ThunkSomeAction,
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
	SIGNIN_SUCCESS,
	SIGNIN_USER,
	SIGNOUT_SUCCESS,
	SIGNOUT_USER,
	UPDATE_READING_LIST,
	UPDATE_READS,
	UPDATE_STARS
} from '../actions.js';

import {
	LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY,
	LOCAL_STORAGE_HAS_PREVIOUS_REAL_SIGN_IN_KEY
} from '../constants.js';

let prevAnonymousMergeUser : User | null = null;

export const saveUserInfo = () : ThunkSomeAction => (_, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (!user) return;

	const batch = new MultiBatch(db);
	ensureUserInfo(batch, user);
	//If we had a merge user, null it out on successful save, so we don't keep saving it.
	batch.commit()
		.then(() => prevAnonymousMergeUser = null)
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
	if (prevAnonymousMergeUser) {
		data.previousUids = arrayUnion(prevAnonymousMergeUser.uid);
		//This will be nulled out in saveUserInfo on successful commit.
	}

	batch.set(doc(db, USERS_COLLECTION, user.uid), data, {merge: true});
};

export const showNeedSignin = () : ThunkSomeAction => (dispatch) => {
	const doSignIn = confirm('Doing that action requires signing in with your Google account. Do you want to sign in?');
	if (!doSignIn) return;
	dispatch(signIn());
};

export const signIn = () : ThunkSomeAction => async (dispatch, getState) => {
	const state = getState();
	const isAnonymous = selectUserIsAnonymous(state);

	dispatch({type:SIGNIN_USER});

	const provider = new GoogleAuthProvider();

	try {
		if (isAnonymous) {
			//We'll only get here if anonymous login was not disabled
			const user = auth.currentUser;
			if (!user) {
				console.warn('Unexpectedly didn\'t have user');
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
				alert('Could not open Google sign-in. Please allow popups for this site and try again.');
				return;
			}
		}
		if (err instanceof FirebaseError && err.code === 'auth/credential-already-in-use') {

			//TODO: only show this confirmation if the old account has at least one star or a few dozen reads.

			// Add a delay to ensure the popup is closed
			await new Promise(resolve => setTimeout(resolve, 250));

			// The popup is now closed, so it's safe to show the confirmation dialog
			const doSignin = confirm('You have already signed in with that account on another device. If you proceed, you will be logged in and any cards you\'ve starred or marked read on this device will be lost. If you do not proceed, you will not be logged in.');

			if (!doSignin) return;

			prevAnonymousMergeUser = auth.currentUser;

			const credential = OAuthProvider.credentialFromError(err);

			if (!credential) {
				alert('No credential provided, can\'t proceed');
				return;
			}

			try {
				await signInWithCredential(auth, credential);
			} catch (signInErr) {
				dispatch({type:SIGNIN_FAILURE, error: signInErr});
			}
		} else {
			dispatch({type:SIGNIN_FAILURE, error: err});
			//SIGNIN_FAILURE is not rendered anywhere, so without this the user
			//sees NOTHING when sign-in fails — indistinguishable from a dead
			//button, which is what made a blocked popup look like a loop.
			const code = err instanceof FirebaseError ? err.code : '';
			if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
				alert(`Sign-in did not complete${code ? ` (${code})` : ''}. Please try again; if it keeps failing, allow popups for this site.`);
			}
		}
	}
};

//Completes a redirect-based sign-in (the popup-blocked fallback). Must run
//on boot: a redirect LINK keeps the same uid, so onAuthStateChanged does not
//fire for it — the same reason the popup link path dispatches explicitly.
export const completeRedirectSignIn = () : ThunkSomeAction => async (dispatch) => {
	try {
		const result = await getRedirectResult(auth);
		if (result?.user) dispatch(signInSuccess(result.user));
	} catch (err) {
		dispatch({type:SIGNIN_FAILURE, error: err});
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
};

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

export const updateStars = (starsToAdd : CardID[] = [], starsToRemove : CardID[] = []) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_STARS,
		starsToAdd,
		starsToRemove
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

export const addToReadingList = (cardToAdd : CardID) : ThunkSomeAction => (_, getState) => {
	if (!cardToAdd) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	void runDurableAuxWrite(makeAuxWriteIntent(uid, 'reading-list-add', cardToAdd, '' + Date.now()));
};

export const removeFromReadingList = (cardToRemove : CardID) : ThunkSomeAction => (_, getState) => {
	if (!cardToRemove) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	void runDurableAuxWrite(makeAuxWriteIntent(uid, 'reading-list-remove', cardToRemove, '' + Date.now()));
};

export const addStar = (cardToStar : Card | null) : ThunkSomeAction => (_, getState) => {

	if (!cardToStar || !cardToStar.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	void runDurableAuxWrite(makeAuxWriteIntent(uid, 'star-add', cardToStar.id));
};

export const removeStar = (cardToStar : Card | null) : ThunkSomeAction => (_, getState) => {
	if (!cardToStar || !cardToStar.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	void runDurableAuxWrite(makeAuxWriteIntent(uid, 'star-remove', cardToStar.id));
};

export const updateReads = (readsToAdd : CardID[] = [], readsToRemove : CardID[] = []) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_READS,
		readsToAdd,
		readsToRemove
	});
	dispatch(refreshCardSelector(false));
};

export const updateReadingList = (list : CardID[] = []) : ThunkSomeAction => (dispatch) => {
	dispatch({
		type: UPDATE_READING_LIST,
		list,
	});
	dispatch(refreshCardSelector(false));
};

let autoMarkReadTimeoutId : number | null = null;

export const scheduleAutoMarkRead = () : ThunkSomeAction => (dispatch, getState) => {

	cancelPendingAutoMarkRead();

	const state = getState();
	const uid = selectUid(state);
	if (!uid) return;

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
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
	const activeCard = selectActiveCard(state);
	if (!activeCard) return;
	dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
	dispatch(markRead(activeCard, true));
};

export const markRead = (cardToMarkRead : Card | null, existingReadDoesNotError? : boolean) : ThunkSomeAction => (_, getState) => {

	if (!cardToMarkRead || !cardToMarkRead.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	if (getCardIsRead(state, cardToMarkRead.id)) {
		if (!existingReadDoesNotError) {
			console.log('The card is already read!');
			return;
		}
	}

	void runDurableAuxWrite(makeAuxWriteIntent(uid, 'read-add', cardToMarkRead.id));
};

export const markUnread = (cardToMarkUnread : Card | null) : ThunkSomeAction => (_, getState) => {
	if (!cardToMarkUnread || !cardToMarkUnread.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const activeCollection = selectActiveCollection(state);
	const collectionIsFallback = activeCollection && activeCollection.isFallback;
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	if (!getCardIsRead(state, cardToMarkUnread.id)) {
		console.log('Card isn\'t read!');
		return;
	}

	//Just in case we were planning on setting this card as read.
	cancelPendingAutoMarkRead();

	void runDurableAuxWrite(makeAuxWriteIntent(uid, 'read-remove', cardToMarkUnread.id));
};
