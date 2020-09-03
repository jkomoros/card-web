export const SIGNIN_USER = 'SIGNIN_USER';
export const SIGNIN_SUCCESS = 'SIGNIN_SUCCESS';
export const SIGNIN_FAILURE = 'SIGNIN_FAILURE';
export const SIGNOUT_USER = 'SIGNOUT_USER';
export const SIGNOUT_SUCCESS = 'SIGNOUT_SUCCESS';
export const UPDATE_STARS = 'UPDATE_STARS';
export const UPDATE_READS = 'UPDATE_READS';
export const UPDATE_READING_LIST = 'UPDATE_READING_LIST';
export const AUTO_MARK_READ_PENDING_CHANGED = 'AUTO_MARK_READ_PENDING_CHANGED';
export const UPDATE_USER_PERMISSIONS = 'UPDATE_USER_PERMISSIONS';

export const AUTO_MARK_READ_DELAY = 5000;

import firebase from '@firebase/app';

import {
	connectLiveStars,
	disconnectLiveStars,
	connectLiveReads,
	disconnectLiveReads,
	connectLiveReadingList,
	disconnectLiveReadingList,
	db,
	auth,
	CARDS_COLLECTION,
	STARS_COLLECTION,
	READS_COLLECTION,
	USERS_COLLECTION,
	READING_LISTS_COLLECTION,
	READING_LISTS_UPDATES_COLLECTION,
	PERMISSIONS_COLLECTION
} from './database.js';

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
	selectCollectionIsFallback,
	getCardInReadingList
} from '../selectors.js';

let prevAnonymousMergeUser = null;

auth.getRedirectResult().catch( async err => {

	if (err.code != 'auth/credential-already-in-use') {
		alert('Couldn\'t sign in (' + err.code + '): ' + err.message);
		return;
	}

	let doSignin = confirm('You have already signed in with that account on another device. If you proceed, you will be logged in and any cards you\'ve starred or marked read on this device will be lost. If you do not proceed, you will not be logged in.');

	if (!doSignin) return;

	//OK, they do want to proceed.

	//We'll keep track of who the previous uid was, so maybe in the future we
	//can merge the accounts. the saveUserInfo after a successful signin will
	//notice this global is set and save it to the db.
	prevAnonymousMergeUser = auth.currentUser;

	let credential = err.credential;

	if (!credential) {
		alert('No credential provided, can\'t proceed');
		return;
	}

	auth.signInAndRetrieveDataWithCredential(credential);

});

export const saveUserInfo = () => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (!user) return;

	let batch = db.batch();
	ensureUserInfo(batch, user);
	//If we had a merge user, null it out on successful save, so we don't keep saving it.
	batch.commit().then(() => prevAnonymousMergeUser = null);

};

export const ensureUserInfo = (batchOrTransaction, user) => {
	if (!user) return;

	let data = {
		lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
		isAnonymous: user.isAnonymous,
	};

	//If this is set then we just signed in after a failed merge, so we want to
	//keep record that we failed.
	if (prevAnonymousMergeUser) {
		data.previousUids = firebase.firestore.FieldValue.arrayUnion(prevAnonymousMergeUser.uid);
		//This will be nulled out in saveUserInfo on successful commit.
	}

	batchOrTransaction.set(db.collection(USERS_COLLECTION).doc(user.uid), data, {merge: true});
};

export const showNeedSignin = () => (dispatch) => {
	let doSignIn = confirm('Doing that action requires signing in with your Google account. Do you want to sign in?');
	if (!doSignIn) return;
	dispatch(signIn());
};

export const signIn = () => (dispatch, getState) => {

	const state = getState();

	let isAnonymous = selectUserIsAnonymous(state);

	dispatch({type:SIGNIN_USER});

	let provider = new firebase.auth.GoogleAuthProvider();

	if (isAnonymous) {
		let user = auth.currentUser;
		if (!user) {
			console.warn('Unexpectedly didn\'t have user');
			return;
		}
		user.linkWithRedirect(provider);
		return;
	}

	auth.signInWithRedirect(provider).catch(err => {
		dispatch({type:SIGNIN_FAILURE, error: err});
	});

};

export const signOutSuccess = () => (dispatch) =>  {

	//Note that this is actually called anytime onAuthStateChange notices we're not signed
	//in, which can both be a manual sign out, as well as a page load with no user.

	//If the user hasn't previously signed in on this device, then this might be
	//a first page load. Try to do an anonymous account.
	if (!hasPreviousSignIn()) {
		auth.signInAnonymously();
		return;
	}

	dispatch({type: SIGNOUT_SUCCESS});
	disconnectLiveStars();
	disconnectLiveReads();
	disconnectLiveReadingList();
};

const HAS_PREVIOUS_SIGN_IN_KEY = 'hasPreviousSignIn';

const flagHasPreviousSignIn = () => {
	//Safari in private mode will throw if you try to set
	try {
		localStorage.setItem(HAS_PREVIOUS_SIGN_IN_KEY, '1');
	} catch(err) {
		console.warn('Couldn\'t set has previous sign in: ' + err);
	}
};

const hasPreviousSignIn = () => {
	return localStorage.getItem(HAS_PREVIOUS_SIGN_IN_KEY) ? true : false;
};

const ensureRichestDataForUser = (firebaseUser) => (dispatch) => {
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

	firebaseUser.providerData.forEach(data => {
		if (!bestPhotoURL && data.photoURL) bestPhotoURL = data.photoURL;
		if (!bestDisplayName && data.displayName) bestDisplayName = data.displayName;
		if (!bestEmail && data.email) bestEmail = data.email;
	});

	//Even after updating the user we need to tell the UI it's updated.

	firebaseUser.updateProfile({
		photoURL: bestPhotoURL,
		displayName: bestDisplayName,
		email: bestEmail,
	}).then(firebaseUser => dispatch(updateUserInfo(firebaseUser))).catch(err => console.warn('Couldn\'t update profile: ', err));

};

const updateUserInfo = (firebaseUser) => (dispatch) => {
	let info = _userInfo(firebaseUser);
	dispatch({
		type: SIGNIN_SUCCESS,
		user: info,
	});
};

export const updatePermissions = (uid) => async (dispatch) => {
	if (!uid) {
		//This is only trigger on e.g. logout
		dispatch({
			type: UPDATE_USER_PERMISSIONS,
			permissions: {},
		});
		return;
	}
	let snapshot;
	try {
		snapshot = await db.collection(PERMISSIONS_COLLECTION).doc(uid).get();
	} catch(err) {
		dispatch({
			type: UPDATE_USER_PERMISSIONS,
			permissions: {},
		});
		return;
	}
	dispatch({
		type: UPDATE_USER_PERMISSIONS,
		//If thesnapshot doesn't exist then data() will be undefined, so always
		//return a {}.
		permissions: snapshot.data() || {},
	});
};

export const signInSuccess = (firebaseUser) => (dispatch) => {

	//Note that even when this is done, selectUserSignedIn might still return
	//false, if the user is signed in anonymously.

	dispatch(ensureRichestDataForUser(firebaseUser));

	dispatch(updateUserInfo(firebaseUser));

	dispatch(saveUserInfo());
	flagHasPreviousSignIn();
	dispatch(updatePermissions(firebaseUser.uid));
	connectLiveStars(firebaseUser.uid);
	connectLiveReads(firebaseUser.uid);
	connectLiveReadingList(firebaseUser.uid);
};

const _userInfo = (info) => {
	return {
		uid: info.uid,
		isAnonymous: info.isAnonymous,
		photoURL: info.photoURL,
		displayName: info.displayName,
		email: info.email
	};
};

export const signOut = () => (dispatch, getState) => {

	const state = getState();

	let user = selectUser(state);

	if (!user) return;
	//We don't sign out anonymous users
	if (user.isAnonymous) return;

	dispatch({type:SIGNOUT_USER});
	flagHasPreviousSignIn();
	updatePermissions('');
	auth.signOut();
};

export const updateStars = (starsToAdd = [], starsToRemove = []) => (dispatch) => {
	dispatch({
		type: UPDATE_STARS,
		starsToAdd,
		starsToRemove
	});
	dispatch(refreshCardSelector(false));
};

export const toggleOnReadingList = (cardToToggle) => (dispatch, getState) => {

	if (!cardToToggle || !cardToToggle.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const onReadingList = getCardInReadingList(state, cardToToggle.id);

	dispatch(onReadingList ? removeFromReadingList(cardToToggle) : addToReadingList(cardToToggle));
};

export const addToReadingList = (cardToAdd) => (dispatch, getState) => {
	if (!cardToAdd || !cardToAdd.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	let uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const collectionIsFallback = selectCollectionIsFallback(state);
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	let batch = db.batch();

	let readingListRef = db.collection(READING_LISTS_COLLECTION).doc(uid);
	let readingListUpdateRef = readingListRef.collection(READING_LISTS_UPDATES_COLLECTION).doc('' + Date.now());

	let readingListObject = {
		cards: firebase.firestore.FieldValue.arrayUnion(cardToAdd.id),
		updated: firebase.firestore.FieldValue.serverTimestamp(),
		owner: uid,
	};

	let readingListUpdateObject = {
		timestamp: firebase.firestore.FieldValue.serverTimestamp(),
		add_card: cardToAdd.id
	};

	batch.set(readingListRef, readingListObject, {merge:true});
	batch.set(readingListUpdateRef, readingListUpdateObject);

	batch.commit();
};

export const removeFromReadingList = (cardToRemove) => (dispatch, getState) => {
	if (!cardToRemove || !cardToRemove.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	let uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const collectionIsFallback = selectCollectionIsFallback(state);
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	let batch = db.batch();

	let readingListRef = db.collection(READING_LISTS_COLLECTION).doc(uid);
	let readingListUpdateRef = readingListRef.collection(READING_LISTS_UPDATES_COLLECTION).doc('' + Date.now());

	let readingListObject = {
		cards: firebase.firestore.FieldValue.arrayRemove(cardToRemove.id),
		updated: firebase.firestore.FieldValue.serverTimestamp(),
		owner: uid
	};

	let readingListUpdateObject = {
		timestamp: firebase.firestore.FieldValue.serverTimestamp(),
		remove_card: cardToRemove.id
	};

	batch.set(readingListRef, readingListObject, {merge:true});
	batch.set(readingListUpdateRef, readingListUpdateObject);

	batch.commit();
};

export const addStar = (cardToStar) => (dispatch, getState) => {

	if (!cardToStar || !cardToStar.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	let uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const collectionIsFallback = selectCollectionIsFallback(state);
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	let cardRef = db.collection(CARDS_COLLECTION).doc(cardToStar.id);
	let starRef = db.collection(STARS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToStar.id));

	let batch = db.batch();
	batch.update(cardRef, {
		star_count: firebase.firestore.FieldValue.increment(1),
		star_count_manual: firebase.firestore.FieldValue.increment(1),
	});
	batch.set(starRef, {
		created: firebase.firestore.FieldValue.serverTimestamp(), 
		owner: uid, 
		card:cardToStar.id
	});
	batch.commit();
};

export const removeStar = (cardToStar) => (dispatch, getState) => {
	if (!cardToStar || !cardToStar.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	let uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const collectionIsFallback = selectCollectionIsFallback(state);
	if (collectionIsFallback) {
		console.log('Interacting with fallback content not allowed');
		return;
	}

	let cardRef = db.collection(CARDS_COLLECTION).doc(cardToStar.id);
	let starRef = db.collection(STARS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToStar.id));

	let batch = db.batch();
	batch.update(cardRef, {
		star_count: firebase.firestore.FieldValue.increment(-1),
		star_count_manual: firebase.firestore.FieldValue.increment(-1),
	});
	batch.delete(starRef);
	batch.commit();

};

export const updateReads = (readsToAdd = [], readsToRemove = []) => (dispatch) => {
	dispatch({
		type: UPDATE_READS,
		readsToAdd,
		readsToRemove
	});
	dispatch(refreshCardSelector(false));
};

export const updateReadingList = (list = []) => (dispatch) => {
	dispatch({
		type: UPDATE_READING_LIST,
		list,
	});
	dispatch(refreshCardSelector(false));
};

let autoMarkReadTimeoutId = null;

export const scheduleAutoMarkRead = () => (dispatch, getState) => {

	cancelPendingAutoMarkRead();

	const state = getState();
	const uid = selectUid(state);
	if (!uid) return;

	const collectionIsFallback = selectCollectionIsFallback(state);
	if (collectionIsFallback) {
		return;
	}

	const activeCard = selectActiveCard(state);
	if (!activeCard) return;
	if (getCardIsRead(state, activeCard.id)) return;

	autoMarkReadTimeoutId = setTimeout(() => dispatch(markActiveCardReadIfLoggedIn()), AUTO_MARK_READ_DELAY);

	dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: true});
};

export const cancelPendingAutoMarkRead = () => (dispatch) => {
	if (autoMarkReadTimeoutId) {
		dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
		clearTimeout(autoMarkReadTimeoutId);
		autoMarkReadTimeoutId = null;
	}
};

export const markActiveCardReadIfLoggedIn = () => (dispatch, getState) => {
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

export const markRead = (cardToMarkRead, existingReadDoesNotError) => (dispatch, getState) => {

	if (!cardToMarkRead || !cardToMarkRead.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	let uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const collectionIsFallback = selectCollectionIsFallback(state);
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

	let readRef = db.collection(READS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToMarkRead.id));

	let batch = db.batch();
	batch.set(readRef, {created: firebase.firestore.FieldValue.serverTimestamp(), owner: uid, card: cardToMarkRead.id});
	batch.commit();
};

export const markUnread = (cardToMarkUnread) => (dispatch, getState) => {
	if (!cardToMarkUnread || !cardToMarkUnread.id) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	let uid = selectUid(state);

	if (!uid) {
		console.log('Not logged in');
		return;
	}

	const collectionIsFallback = selectCollectionIsFallback(state);
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

	let readRef = db.collection(READS_COLLECTION).doc(idForPersonalCardInfo(uid, cardToMarkUnread.id));

	let batch = db.batch();
	batch.delete(readRef);
	batch.commit();

};
