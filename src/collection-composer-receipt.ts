export const currentBrowserLocation = () : string =>
	`${window.location.pathname}${window.location.search}${window.location.hash}`;

export const collectionReceiptCanUndo = (
	expectedLocation: string,
	currentLocation: string
) : boolean => Boolean(expectedLocation) && expectedLocation === currentLocation;
