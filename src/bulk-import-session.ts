import {State} from './types.js';
import {selectUser} from './selectors.js';

//Capture after BULK_IMPORT_PENDING. The durable write belongs to the account,
//but its progress, draft clearing, selection and navigation belong to this
//particular UI operation. Closing/reopening, replacing the draft, starting a
//new operation, or signing out must detach that UI without cancelling writes.
export const bulkImportSessionIsCurrent = (getState : () => State) : (() => boolean) => {
	const state = getState();
	const session = state.bulkImport?.session;
	const uid = selectUser(state)?.uid;
	return () => {
		const current = getState();
		return current.bulkImport?.session === session && selectUser(current)?.uid === uid;
	};
};
