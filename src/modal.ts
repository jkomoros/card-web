//The async seam that lets alert()/confirm()/prompt() call sites migrate ONCE
//instead of twice (#708).
//
//#708's stated approach is to "indirect all direct uses of those behind async
//methods that currently call out to those methods", and to expect "a stack of
//those currently active messages in the UI, since they don't actually block
//like the real ones do". This module is that indirection. Today the in-app
//dialogs that satisfy these requests are being built; until each one exists,
//the corresponding function falls back to the native call it replaces, so a
//call site migrated now keeps working and does not need touching again when the
//dialog lands.
//
//WHY A PROMISE AND NOT A REDUX ROUND TRIP. There are 31 sites of the shape
//`if (!confirm(...)) return;` sitting in the middle of ordinary sync or async
//functions. Turning every one of them inside out into continuation-passing
//style is not a landable change. An awaitable call is a one-line edit at each
//site.
//
//WHY THE RESOLVER DOES NOT LIVE IN REDUX. A function in the store would break
//serializability, which test/reactive-state depends on. So the store holds the
//plain-object REQUEST and this module holds a private id -> resolver map. Same
//split runDurableAuxWrite uses (aux-write-queue.ts): a promise for the caller,
//durable state somewhere it can be inspected.
//
//THE HAZARD THIS INTRODUCES, stated plainly because every migration has to
//handle it: alert/confirm/prompt are SYNCHRONOUS and re-entrant-safe — the world
//cannot change while one is open. These can be raced. A caller that checks a
//precondition, awaits, and then acts must RE-CHECK after the await.
//card-web-app.ts:578 already documents this hazard for the draft case and
//mitigates it by capturing its target id before the modal; that is the pattern.

import {
	store
} from './store.js';

import {
	MODAL_OPEN,
	MODAL_RESOLVE,
	SomeAction
} from './actions.js';

import {
	ModalRequest,
	ModalRequestID,
	ModalResult,
	DestructiveConfirmRequest,
	InputRequest
} from './types.js';

//id -> resolve. Deliberately module-local; see the header.
const resolvers : Map<ModalRequestID, (result : ModalResult) => void> = new Map();

let nextID = 0;

const mintID = () : ModalRequestID => {
	nextID++;
	return `modal-${nextID}`;
};

//Called by the dialog that satisfied the request. Resolving an unknown id is a
//no-op rather than a throw: a resolve can legitimately arrive twice if a dialog
//is closed while its commit is in flight, and the second one means "already
//handled", not "corrupt".
export const resolveModal = (id : ModalRequestID, result : ModalResult) : SomeAction | null => {
	const resolver = resolvers.get(id);
	if (!resolver) return null;
	resolvers.delete(id);
	resolver(result);
	return {type: MODAL_RESOLVE, requestID: id};
};

const openModal = (request : ModalRequest) : Promise<ModalResult> => {
	return new Promise<ModalResult>(resolve => {
		resolvers.set(request.id, resolve);
		store.dispatch({type: MODAL_OPEN, request});
	});
};

//Whether an in-app dialog is mounted for this kind of request yet. Until one
//is, the fallback below runs. This is the ONLY place that decides, so deleting
//a fallback is a one-line change when its dialog lands.
const handlerInstalled : {[kind in ModalRequest['kind']] : boolean} = {
	'destructive-confirm': false,
	'input': false,
};

export const installModalHandler = (kind : ModalRequest['kind']) : void => {
	handlerInstalled[kind] = true;
};

//Ask the user to confirm an irreversible action (HOUSE-STYLE §3.7 Tier 1).
//
//Do NOT use this for anything reversible-until-Save — removing a tag, a
//reference, a filter. Confirming cheap reversible actions is what trains people
//to dismiss the dangerous confirms unread, which is the whole argument for the
//two tiers.
export const confirmDestructive = async (request : DestructiveConfirmRequest) : Promise<boolean> => {
	if (!handlerInstalled['destructive-confirm']) {
		//Composed to read the same as the dialog will: what is lost, what
		//survives, then the irreversibility.
		const lines = [request.what];
		if (request.survives) lines.push(request.survives);
		lines.push('This can\'t be undone.');
		return confirm(lines.join('\n\n'));
	}
	const result = await openModal({...request, kind: 'destructive-confirm', id: mintID()});
	return result.confirmed === true;
};

//Ask the user for one or more values. Returns one string per field, or null if
//they cancelled.
//
//Fields are an ARRAY because of the chained pair that exists twice verbatim
//(card-editor.ts:1381/1383 and multi-edit-dialog.ts:553/555): a tag's base name
//and then its display name, defaulted from the base. Two native prompts back to
//back; one dialog with two fields.
export const askForInput = async (request : InputRequest) : Promise<string[] | null> => {
	if (!handlerInstalled['input']) {
		const values : string[] = [];
		for (const field of request.fields) {
			const hint = field.hint ? '\n' + field.hint : '';
			const answer = prompt(field.label + hint, field.value ?? '');
			if (answer === null) return null;
			const complaint = field.validate ? field.validate(answer) : null;
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
	return result.values ?? null;
};

//Testing seam: the fallbacks call global alert/confirm/prompt, which a test
//cannot otherwise observe. Not exported from any index; test-only by intent.
export const _resolversForTesting = resolvers;
