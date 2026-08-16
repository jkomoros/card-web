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

const compareUpdatedTimestamp = (a : Card | undefined, b : Card) : number | null => {
	const left = a?.updated as TimestampParts | undefined;
	const right = b.updated as TimestampParts | undefined;
	if (!left || !right || !Number.isInteger(left.seconds) || !Number.isInteger(left.nanoseconds) ||
		!Number.isInteger(right.seconds) || !Number.isInteger(right.nanoseconds)) return null;
	if (left.seconds !== right.seconds) return left.seconds - right.seconds;
	return left.nanoseconds - right.nanoseconds;
};

//Mutates the just-parsed listener batch, matching the worker ingestion path:
//unchanged redeliveries are removed while new versions remain for processing.
export const dropCardsAlreadyAtUpdatedVersion = (cards : Cards, existing : ReadonlyMap<string, Card>) : void => {
	for (const [id, card] of Object.entries(cards)) {
		if (sameUpdatedTimestamp(existing.get(id), card)) delete cards[id];
	}
};

//A persistent-cache listener can lag the independently saved compact
//snapshot. Never let that older cache view roll the worker corpus backward;
//a server-confirmed listener delivery is still ingested normally.
export const dropCachedCardsNotNewerThanExisting = (cards : Cards, existing : ReadonlyMap<string, Card>) : void => {
	for (const [id, card] of Object.entries(cards)) {
		const comparison = compareUpdatedTimestamp(existing.get(id), card);
		if (comparison !== null && comparison >= 0) delete cards[id];
	}
};
