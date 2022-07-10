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

import {
	GoogleAuthProvider,
	signInWithCredential,
	linkWithRedirect,
	signInWithRedirect,
	signInAnonymously,
	signOut as firebaseSignOut,
	getRedirectResult,
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
	CARDS_COLLECTION,
	STARS_COLLECTION,
	READS_COLLECTION,
	USERS_COLLECTION,
	READING_LISTS_COLLECTION,
	READING_LISTS_UPDATES_COLLECTION,
	PERMISSIONS_COLLECTION
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
	getDoc,
	arrayUnion,
	arrayRemove,
	serverTimestamp,
	increment,
	FieldValue
} from 'firebase/firestore';

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
	CardID
} from '../types.js';

import {
	AppActionCreator
} from '../store.js';

import {
	MultiBatch
} from '../multi_batch.js';

let prevAnonymousMergeUser : User = null;

getRedirectResult(auth).catch( async (err : FirebaseError) => {

	if (err.code != 'auth/credential-already-in-use') {
		alert('Couldn\'t sign in (' + err.code + '): ' + err.message);
		return;
	}

	const doSignin = confirm('You have already signed in with that account on another device. If you proceed, you will be logged in and any cards you\'ve starred or marked read on this device will be lost. If you do not proceed, you will not be logged in.');

	if (!doSignin) return;

	//OK, they do want to proceed.

	//We'll keep track of who the previous uid was, so maybe in the future we
	//can merge the accounts. the saveUserInfo after a successful signin will
	//notice this global is set and save it to the db.
	prevAnonymousMergeUser = auth.currentUser;

	const credential = OAuthProvider.credentialFromError(err);

	if (!credential) {
		alert('No credential provided, can\'t proceed');
		return;
	}

	signInWithCredential(auth, credential);

});

export const saveUserInfo : AppActionCreator = () => (_, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (!user) return;

	const batch = new MultiBatch(db);
	ensureUserInfo(batch, user);
	//If we had a merge user, null it out on successful save, so we don't keep saving it.
	batch.commit().then(() => prevAnonymousMergeUser = null);

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

export const showNeedSignin : AppActionCreator = () => (dispatch) => {
	const doSignIn = confirm('Doing that action requires signing in with your Google account. Do you want to sign in?');
	if (!doSignIn) return;
	dispatch(signIn());
};

export const signIn : AppActionCreator = () => (dispatch, getState) => {

	const state = getState();

	const isAnonymous = selectUserIsAnonymous(state);

	dispatch({type:SIGNIN_USER});

	const provider = new GoogleAuthProvider();

	if (isAnonymous) {
		//We'll only get here if anonymous login was not disabled
		const user = auth.currentUser;
		if (!user) {
			console.warn('Unexpectedly didn\'t have user');
			return;
		}
		linkWithRedirect(user, provider);
		return;
	}

	signInWithRedirect(auth, provider).catch(err => {
		dispatch({type:SIGNIN_FAILURE, error: err});
	});

};

export const signOutSuccess : AppActionCreator = () => (dispatch) =>  {

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

const ensureRichestDataForUser : AppActionCreator = (firebaseUser : User) => async (dispatch) => {
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

const updateUserInfo : AppActionCreator = (firebaseUser : User) => (dispatch) => {
	const info = _userInfo(firebaseUser);
	dispatch({
		type: SIGNIN_SUCCESS,
		user: info,
	});
};

export const updatePermissions : AppActionCreator = (uid) => async (dispatch) => {
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
		snapshot = await getDoc(doc(db, PERMISSIONS_COLLECTION, uid));
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

export const signInSuccess : AppActionCreator = (firebaseUser) => (dispatch) => {

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

const _userInfo = (info : User) : UserInfo => {
	return {
		uid: info.uid,
		isAnonymous: info.isAnonymous,
		photoURL: info.photoURL,
		displayName: info.displayName,
		email: info.email
	};
};

export const signOut : AppActionCreator = () => (dispatch, getState) => {

	const state = getState();

	const user = selectUser(state);

	if (!user) return;
	//We don't sign out anonymous users
	if (user.isAnonymous) return;

	dispatch({type:SIGNOUT_USER});
	flagHasPreviousSignIn();
	updatePermissions('');
	firebaseSignOut(auth);
};

export const updateStars : AppActionCreator = (starsToAdd : CardID[] = [], starsToRemove : CardID[] = []) => (dispatch) => {
	dispatch({
		type: UPDATE_STARS,
		starsToAdd,
		starsToRemove
	});
	dispatch(refreshCardSelector(false));
};

export const toggleOnReadingList : AppActionCreator = (cardToToggle : CardID) => (dispatch, getState) => {

	if (!cardToToggle) {
		console.log('Invalid card provided');
		return;
	}

	const state = getState();
	const onReadingList = getCardInReadingList(state, cardToToggle);

	dispatch(onReadingList ? removeFromReadingList(cardToToggle) : addToReadingList(cardToToggle));
};

export const addToReadingList : AppActionCreator = (cardToAdd : CardID) => (_, getState) => {
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

	const batch = new MultiBatch(db);

	const readingListRef = doc(db, READING_LISTS_COLLECTION, uid);
	const readingListUpdateRef = doc(readingListRef, READING_LISTS_UPDATES_COLLECTION, '' + Date.now());

	const readingListObject = {
		cards: arrayUnion(cardToAdd),
		updated: serverTimestamp(),
		owner: uid,
	};

	const readingListUpdateObject = {
		timestamp: serverTimestamp(),
		add_card: cardToAdd
	};

	batch.set(readingListRef, readingListObject, {merge:true});
	batch.set(readingListUpdateRef, readingListUpdateObject);

	batch.commit();
};

export const removeFromReadingList : AppActionCreator = (cardToRemove : CardID) => (_, getState) => {
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

	const batch = new MultiBatch(db);

	const readingListRef = doc(db, READING_LISTS_COLLECTION, uid);
	const readingListUpdateRef = doc(readingListRef, READING_LISTS_UPDATES_COLLECTION, '' + Date.now());

	const readingListObject = {
		cards: arrayRemove(cardToRemove),
		updated: serverTimestamp(),
		owner: uid
	};

	const readingListUpdateObject = {
		timestamp: serverTimestamp(),
		remove_card: cardToRemove
	};

	batch.set(readingListRef, readingListObject, {merge:true});
	batch.set(readingListUpdateRef, readingListUpdateObject);

	batch.commit();
};

export const addStar : AppActionCreator = (cardToStar : Card) => (_, getState) => {

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

	const cardRef = doc(db, CARDS_COLLECTION, cardToStar.id);
	const starRef = doc(db, STARS_COLLECTION, idForPersonalCardInfo(uid, cardToStar.id));

	const batch = new MultiBatch(db);
	batch.update(cardRef, {
		star_count: increment(1),
		star_count_manual: increment(1),
	});
	batch.set(starRef, {
		created: serverTimestamp(), 
		owner: uid, 
		card:cardToStar.id
	});
	batch.commit();
};

export const removeStar : AppActionCreator = (cardToStar : Card) => (_, getState) => {
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

	const cardRef = doc(db, CARDS_COLLECTION, cardToStar.id);
	const starRef = doc(db, STARS_COLLECTION, idForPersonalCardInfo(uid, cardToStar.id));

	const batch = new MultiBatch(db);
	batch.update(cardRef, {
		star_count: increment(-1),
		star_count_manual: increment(-1),
	});
	batch.delete(starRef);
	batch.commit();

};

export const updateReads : AppActionCreator = (readsToAdd : CardID[] = [], readsToRemove : CardID[] = []) => (dispatch) => {
	dispatch({
		type: UPDATE_READS,
		readsToAdd,
		readsToRemove
	});
	dispatch(refreshCardSelector(false));
};

export const updateReadingList : AppActionCreator = (list : CardID[] = []) => (dispatch) => {
	dispatch({
		type: UPDATE_READING_LIST,
		list,
	});
	dispatch(refreshCardSelector(false));
};

let autoMarkReadTimeoutId : number;

export const scheduleAutoMarkRead : AppActionCreator = () => (dispatch, getState) => {

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

export const cancelPendingAutoMarkRead : AppActionCreator = () => (dispatch) => {
	if (autoMarkReadTimeoutId) {
		dispatch({type: AUTO_MARK_READ_PENDING_CHANGED, pending: false});
		clearTimeout(autoMarkReadTimeoutId);
		autoMarkReadTimeoutId = null;
	}
};

export const markActiveCardReadIfLoggedIn : AppActionCreator = () => (dispatch, getState) => {
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

export const markRead : AppActionCreator = (cardToMarkRead : Card, existingReadDoesNotError? : boolean) => (_, getState) => {

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

	const readRef = doc(db, READS_COLLECTION, idForPersonalCardInfo(uid, cardToMarkRead.id));

	const batch = new MultiBatch(db);
	batch.set(readRef, {created: serverTimestamp(), owner: uid, card: cardToMarkRead.id});
	batch.commit();
};

export const markUnread : AppActionCreator = (cardToMarkUnread : Card) => (_, getState) => {
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

	const readRef = doc(db, READS_COLLECTION, idForPersonalCardInfo(uid, cardToMarkUnread.id));

	const batch = new MultiBatch(db);
	batch.delete(readRef);
	batch.commit();

};
