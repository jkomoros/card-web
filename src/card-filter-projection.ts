import type {
	CardFilterBits,
	ConcreteFilterName,
	Filters
} from './types.js';

import {
	primeBitsFor
} from '../shared/filter_membership.js';

//The worker's card-derived projection as the prime's bitsets, or null when
//any filter has changed since the prime (then it must go as plain maps).
//All memberships must come from ONE prime: the bits are over that prime's
//id order, so a membership from a different build cannot share the ids.
export const cardFilterBitsForWire = (filters : Filters) : CardFilterBits | null => {
	const names : ConcreteFilterName[] = [];
	const words : Uint32Array[] = [];
	let ids : readonly string[] | null = null;
	for (const [name, membership] of Object.entries(filters)) {
		const source = primeBitsFor(membership);
		if (!source) return null;
		if (ids && source.ids !== ids) return null;
		ids = source.ids;
		names.push(name);
		words.push(source.words);
	}
	if (!ids) return null;
	return {ids: ids as string[], names, words};
};

//Shape check for a received projection: exactly the expected filter names,
//unique string ids, and one correctly sized Uint32Array per name. Content
//is the worker's to vouch for; the domain check in receiveCards guards the
//ids against the store.
export const validCardFilterBits = (bits : CardFilterBits, expectedNames : string[]) : boolean => {
	if (!bits || typeof bits !== 'object') return false;
	if (!Array.isArray(bits.ids) || !Array.isArray(bits.names) || !Array.isArray(bits.words)) return false;
	if (bits.names.length !== expectedNames.length || bits.words.length !== bits.names.length) return false;
	const expected = new Set(expectedNames);
	if (new Set(bits.names).size !== bits.names.length || bits.names.some(name => !expected.has(name))) return false;
	if (bits.ids.some(id => typeof id !== 'string' || !id)) return false;
	if (new Set(bits.ids).size !== bits.ids.length) return false;
	const wordCount = Math.ceil(bits.ids.length / 32);
	return bits.words.every(flat => flat instanceof Uint32Array && flat.length === wordCount);
};
