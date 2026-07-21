import {
	Card,
	Cards
} from '../types.js';

type TimestampParts = {
	seconds: number;
	nanoseconds: number;
};

//`updated` is enforced on every persisted card mutation. Equal timestamp
//parts therefore identify the exact version already present in the corpus.
export const sameUpdatedTimestamp = (a : Card | undefined, b : Card) : boolean => {
	const left = a?.updated as TimestampParts | undefined;
	const right = b.updated as TimestampParts | undefined;
	return Boolean(left && right && left.seconds === right.seconds && left.nanoseconds === right.nanoseconds);
};

//Mutates the just-parsed listener batch, matching the worker ingestion path:
//unchanged redeliveries are removed while new versions remain for processing.
export const dropCardsAlreadyAtUpdatedVersion = (cards : Cards, existing : ReadonlyMap<string, Card>) : void => {
	for (const [id, card] of Object.entries(cards)) {
		if (sameUpdatedTimestamp(existing.get(id), card)) delete cards[id];
	}
};
