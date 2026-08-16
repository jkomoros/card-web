export type SavedOperationInspection<T> = {
	operation: T | null,
	error: Error | null,
};

//The abandon UI must remain usable even when the parser is rejecting the very
//record the user needs to discard.
export const inspectSavedOperation = <T>(reader : () => T | null) : SavedOperationInspection<T> => {
	try {
		return {operation: reader(), error: null};
	} catch (error) {
		return {operation: null, error: error instanceof Error ? error : new Error(String(error))};
	}
};
