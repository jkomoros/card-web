//Origin-tab-local accounting for Firestore mutation workflows. Ownership
//handoff consults this leaf module before deactivating a page, so no async
//write can continue from a superseded tab.

let inFlight = 0;
let fenced = false;

export class MutationFencedError extends Error {
	constructor() {
		super('This tab is inactive and cannot start Firestore mutations');
		this.name = 'MutationFencedError';
	}
}

export const beginMutation = () : (() => void) => {
	if (fenced) throw new MutationFencedError();
	inFlight++;
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		inFlight = Math.max(0, inFlight - 1);
	};
};

//Accept a thunk rather than an already-created Promise: argument evaluation
//must happen only after beginMutation has checked the fence. Otherwise a raw
//Firestore write could start and only then discover that this tab is inactive.
export const trackMutation = async <T>(operation : () => Promise<T>) : Promise<T> => {
	const finish = beginMutation();
	try {
		return await operation();
	} finally {
		finish();
	}
};

export const inFlightMutationCount = () : number => inFlight;

export const fenceMutations = () => { fenced = true; };
export const allowMutations = () => { fenced = false; };
export const mutationsFenced = () : boolean => fenced;
