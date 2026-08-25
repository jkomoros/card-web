//The async seam that lets alert()/confirm()/prompt() call sites migrate ONCE
//instead of twice (#708).
//
//#708's stated approach is to "indirect all direct uses of those behind async
//methods that currently call out to those methods", and to expect "a stack of
//those currently active messages in the UI, since they don't actually block
//like the real ones do". This module is that indirection. Until each in-app
//dialog exists, the corresponding function falls back to the native call it
//replaces, so a call site migrated now keeps working and does not need touching
//again when the dialog lands.
//
//WHY A PROMISE AND NOT A REDUX ROUND TRIP. There are 26 sites of the shape
//`if (!confirm(...)) return;` (28 counting the &&-guarded ones) sitting in the
//middle of ordinary functions. Turning every one inside out into
//continuation-passing style is not a landable change; an awaitable call is a
//one-line edit. actions/prompt.ts + compose-dialog solve a narrower version of
//this with a closed CommitActionType enum, which does not generalize: extending
//it means enumerating 26 continuations as new action types.
//
//WHY THE REQUEST IS PLAIN DATA. The store holds the request; this module holds
//a private id -> resolver map. Everything in the request must survive a JSON
//round trip — hence validators are NAMES resolved through modal-validators.ts
//rather than functions, and a field that defaults from an earlier answer says so
//by index instead of carrying a closure.
//
//=========================================================================
//THE HAZARD EVERY MIGRATION MUST HANDLE, and it is not a style note.
//
//alert/confirm/prompt are SYNCHRONOUS: the world cannot change while one is
//open. These can be raced. Between the call and the resolution, timers fire,
//`online` listeners run, store subscribers run, and snapshots land. Verified by
//execution, not assumed.
//
//So a caller MUST re-read anything it captured before the await. Known live
//examples found by review, all of which write wrong data if migrated naively:
//
//  - actions/data.ts abandonPendingBulkTagOperation guards on a MODULE-LEVEL
//    boolean. Its resume watcher can start committing chunks during the await,
//    so the dialog promises "the remaining N will be left unchanged" and then
//    they get written. A previous commit already fixed this exact bug once.
//  - actions/data.ts deleteCard captures getState() BEFORE the confirm and
//    reads uid/editing/activeCard from it after; a sign-out or ownership
//    takeover mid-dialog mints an aux-write intent with a stale uid. Its `card`
//    argument goes stale the same way, leaving a dangling inbound reference.
//  - actions/user.ts reads auth.currentUser AFTER its confirm, on a path that is
//    already mid-auth-transition, and writes the result durably via arrayUnion.
//
//Re-check after the await. Capture ids, not snapshots.
//=========================================================================

import {
	store
} from './store.js';

import {
	MODAL_OPEN,
	MODAL_RESOLVE
} from './actions.js';

import {
	ModalRequest,
	ModalRequestID,
	ModalResult,
	DestructiveConfirmRequest,
	InputRequest,
	State
} from './types.js';

import {
	validatorNamed
} from './modal-validators.js';

//id -> resolve. Deliberately module-local; see the header.
const resolvers : Map<ModalRequestID, (result : ModalResult) => void> = new Map();

let nextID = 0;

//Prefixed per module instance so two ids can never collide even if this module
//is ever evaluated twice (a duplicated id strands one promise forever AND makes
//one resolve remove both store entries, since the reducer filters by id).
const SESSION = Math.random().toString(36).slice(2, 8);

const mintID = () : ModalRequestID => {
	nextID++;
	return `modal-${SESSION}-${nextID}`;
};

export const selectModalRequests = (state : State) : ModalRequest[] => state.modal.requests;

//True when any modal request is outstanding. selectKeyboardNavigates consults
//this, rather than growing a hand-written entry per dialog.
export const selectModalOpen = (state : State) : boolean => state.modal.requests.length > 0;

//Called by the dialog that satisfied the request. Dispatches internally and
//returns nothing: an earlier version returned an action-or-null for the caller
//to dispatch, which made `store.dispatch(resolveModal(...))` THROW on the
//already-handled case this is built to tolerate, and silently stranded the
//request in the store whenever a caller dropped the return value.
export const resolveModal = (id : ModalRequestID, result : ModalResult) : void => {
	const resolver = resolvers.get(id);
	//A resolve can legitimately arrive twice — a dialog closed while its commit
	//is in flight. The second one means "already handled", not "corrupt".
	if (!resolver) return;
	resolvers.delete(id);
	store.dispatch({type: MODAL_RESOLVE, requestID: id});
	resolver(result);
};

//Abandon every outstanding request, resolving each as a cancel. For teardown:
//a dialog that unmounts with requests parked would otherwise leave their
//promises pending forever, and a pending promise retains everything its awaiting
//thunk captured — for deleteCard that is a whole Redux state snapshot.
export const cancelAllModals = () : void => {
	for (const id of [...resolvers.keys()]) resolveModal(id, {});
};

//Whether an in-app dialog is mounted for this kind of request yet. Until one is,
//the fallback runs. This is the ONLY place that decides, so deleting a fallback
//is a one-line change when its dialog lands.
const handlerInstalled : {[kind in ModalRequest['kind']] : boolean} = {
	'destructive-confirm': false,
	'input': false,
};

export const installModalHandler = (kind : ModalRequest['kind']) : void => {
	handlerInstalled[kind] = true;
};

//Symmetric with install, because a one-way global flag is a trap: a dialog that
//installs on connect and later unmounts would leave every subsequent call
//hanging forever with no fallback and no dialog to answer it.
export const uninstallModalHandler = (kind : ModalRequest['kind']) : void => {
	handlerInstalled[kind] = false;
	const state = store.getState() as State;
	for (const request of [...state.modal.requests]) {
		if (request.kind == kind) resolveModal(request.id, {});
	}
};

const openModal = (request : ModalRequest) : Promise<ModalResult> => {
	const pending = new Promise<ModalResult>(resolve => {
		resolvers.set(request.id, resolve);
	});
	//Dispatched OUTSIDE the executor on purpose. Redux runs subscribers
	//synchronously and does not catch; one throwing stateChanged inside the
	//executor would reject this promise instead of fulfilling it, which is not
	//the declared contract and which no migrated `if (!await confirm...)` site
	//would be guarding against. Out here a subscriber's throw propagates to the
	//caller as itself, and the parked resolver is cleaned up.
	try {
		store.dispatch({type: MODAL_OPEN, request});
	} catch (err) {
		resolvers.delete(request.id);
		throw err;
	}
	return pending;
};

//Ask the user to confirm an irreversible action (HOUSE-STYLE §3.7 Tier 1).
//
//Do NOT use this for anything reversible-until-Save — removing a tag, a
//reference, a filter. Confirming cheap reversible actions is what trains people
//to dismiss the dangerous confirms unread, which is the whole argument for the
//two tiers.
export const confirmDestructive = async (request : DestructiveConfirmRequest) : Promise<boolean> => {
	if (!handlerInstalled['destructive-confirm']) {
		//Composed to read the way the dialog will, and to carry everything the
		//dialog would show: the question, what is lost, the specifics, what
		//survives, then the one approved irreversibility phrasing. Dropping
		//`detail` here would delete the information the user needs to answer —
		//it is the diff you are about to overwrite, the tags a fork would lose.
		const lines = [request.title, request.what];
		if (request.detail && request.detail.length) lines.push(request.detail.join('\n'));
		if (request.survives) lines.push(request.survives);
		lines.push('This can\'t be undone.');
		return confirm(lines.join('\n\n'));
	}
	const result = await openModal({...request, kind: 'destructive-confirm', id: mintID()});
	return result.confirmed === true;
};

//The value a field starts with, given the answers already collected. Shared by
//the fallback and the dialog so they cannot disagree.
export const seedForField = (request : InputRequest, index : number, answersSoFar : string[]) : string => {
	const field = request.fields[index];
	//The chained pair this exists for: a tag's base name, then its display name
	//defaulted from what the user just typed. Expressed as an INDEX rather than
	//a closure so the request stays serializable.
	if (field.defaultFromField !== undefined) return answersSoFar[field.defaultFromField] ?? '';
	return field.value ?? '';
};

//Ask the user for one or more values. Returns one string per field, or null if
//they cancelled.
export const askForInput = async (request : InputRequest) : Promise<string[] | null> => {
	if (!handlerInstalled['input']) {
		const values : string[] = [];
		for (let i = 0; i < request.fields.length; i++) {
			const field = request.fields[i];
			const hint = field.hint ? '\n' + field.hint : '';
			const answer = prompt(field.label + hint, seedForField(request, i, values));
			if (answer === null) return null;
			const complaint = field.validator ? validatorNamed(field.validator)(answer) : null;
			if (complaint) {
				//The fallback has nowhere inline to put this. The dialog will.
				alert(complaint);
				return null;
			}
			values.push(answer);
		}
		return values;
	}
	const result = await openModal({...request, kind: 'input', id: mintID()});
	if (!result.values) return null;
	//Validation must NOT live only in the fallback: a migrated caller would stop
	//refusing bad input the day the dialog installs. The dialog validates as you
	//type; this is the backstop that makes the contract the same either way.
	for (let i = 0; i < request.fields.length; i++) {
		const validator = request.fields[i].validator;
		if (!validator) continue;
		if (validatorNamed(validator)(result.values[i] ?? '')) return null;
	}
	return result.values;
};
