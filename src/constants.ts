//Firestore has a maxmium allowed limit of 10000 for a single query.
export const FIRESTORE_MAXIMUM_LIMIT_CLAUSE = 10000;

export const LOCAL_STORAGE_HAS_PREVIOUS_SIGN_IN_KEY = 'hasPreviousSignIn';
//Set ONLY on a real (non-anonymous) sign-in. Distinct from the key above,
//whose job is to stop signOutSuccess from re-triggering signInAnonymously in
//a loop — overloading that one for routing removed the loop guard and made
//every null-auth event mint a new anonymous user.
export const LOCAL_STORAGE_HAS_PREVIOUS_REAL_SIGN_IN_KEY = 'hasPreviousRealSignIn';
