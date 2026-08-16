import { CollectionDescription } from './collection_description.js';

export const currentBrowserLocation = () : string =>
	`${window.location.pathname}${window.location.search}${window.location.hash}`;

export const collectionReceiptCanUndo = (
	expectedLocation: string,
	currentLocation: string,
	activeCardAliases: string[] = []
) : boolean => {
	if (!expectedLocation) return false;
	if (expectedLocation === currentLocation) return true;
	try {
		const expected = new URL(expectedLocation, 'https://collection-receipt.invalid');
		const current = new URL(currentLocation, 'https://collection-receipt.invalid');
		if (expected.search !== current.search || expected.hash !== current.hash) return false;
		if (!expected.pathname.startsWith('/c/') || !current.pathname.startsWith('/c/')) return false;
		const [expectedDescription, expectedCard] = CollectionDescription.deserializeWithExtra(expected.pathname.slice(3));
		const [currentDescription, currentCard] = CollectionDescription.deserializeWithExtra(current.pathname.slice(3));
		if (!expectedDescription.equivalent(currentDescription)) return false;
		const aliases = new Set(activeCardAliases.filter(Boolean));
		return Boolean(expectedCard) && aliases.has(expectedCard) && aliases.has(currentCard);
	} catch {
		return false;
	}
};
