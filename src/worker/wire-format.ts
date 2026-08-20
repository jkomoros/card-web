//Cards crossing the worker↔main-thread boundary are structured-cloned, which
//silently strips the prototype off Firestore Timestamp instances. Rather than
//hoping the clone of a Timestamp keeps usable fields, we explicitly convert
//Timestamps to marker objects on the sending side and reconstruct real
//Timestamp instances on the receiving side. The walk/convert logic is pure
//and dependency-injected so it's unit-testable in Node without Firestore.

type WireTimestamp = {
	__wireTimestamp: true,
	seconds : number,
	nanoseconds : number
};

const isWireTimestamp = (value : unknown) : value is WireTimestamp => {
	return Boolean(value && typeof value === 'object' && (value as WireTimestamp).__wireTimestamp === true);
};

declare const wireBrand : unique symbol;

//The compile-time brand for values that have passed through toWire (#738):
//prototype-carrying Timestamps replaced with marked wire shapes, safe to
//postMessage. The brand exists only in the type system — no runtime cost —
//and it is what makes "every card-bearing post() payload must run through
//toWire" an invariant the COMPILER holds up rather than a convention three
//call sites remember: a protocol field typed Wire<T> rejects a raw card at
//the call site that forgot to convert (#737 was exactly that bug, and
//typing the field `unknown` accepted it plus literally anything else).
//A value known to be wire-shaped from a non-toWire source (a JSON round
//trip through storage) may be asserted with `as Wire<T>` — visibly, at the
//site making the claim.
export type Wire<T> = {readonly [wireBrand] : T};

const toWireValue = (value : unknown, isTimestamp : (value : unknown) => boolean, getTime : (timestamp : unknown) => {seconds : number, nanoseconds : number}) : unknown => {
	if (!value || typeof value !== 'object') return value;
	if (isTimestamp(value)) {
		const {seconds, nanoseconds} = getTime(value);
		const result : WireTimestamp = {__wireTimestamp: true, seconds, nanoseconds};
		return result;
	}
	if (Array.isArray(value)) {
		let changed = false;
		const converted = value.map(item => {
			const convertedItem = toWireValue(item, isTimestamp, getTime);
			if (convertedItem !== item) changed = true;
			return convertedItem;
		});
		return changed ? converted : value;
	}
	let changed = false;
	const result : {[key : string] : unknown} = {};
	for (const [key, item] of Object.entries(value)) {
		const convertedItem = toWireValue(item, isTimestamp, getTime);
		if (convertedItem !== item) changed = true;
		result[key] = convertedItem;
	}
	return changed ? result : value;
};

//Deep-converts any value, replacing values matching isTimestamp with wire
//markers. Returns the original object when nothing needed converting (the
//common case for most nested structures), so unaffected subtrees keep
//identity and no garbage is created for them.
export const toWire = <T>(value : T, isTimestamp : (value : unknown) => boolean, getTime : (timestamp : unknown) => {seconds : number, nanoseconds : number}) : Wire<T> => {
	return toWireValue(value, isTimestamp, getTime) as Wire<T>;
};

//Deep-converts any value, replacing wire markers with the result of
//makeTimestamp. Returns the original object when nothing needed converting.
const fromWireValue = (value : unknown, makeTimestamp : (seconds : number, nanoseconds : number) => unknown) : unknown => {
	if (!value || typeof value !== 'object') return value;
	if (isWireTimestamp(value)) {
		return makeTimestamp(value.seconds, value.nanoseconds);
	}
	if (Array.isArray(value)) {
		let changed = false;
		const converted = value.map(item => {
			const convertedItem = fromWireValue(item, makeTimestamp);
			if (convertedItem !== item) changed = true;
			return convertedItem;
		});
		return changed ? converted : value;
	}
	let changed = false;
	const result : {[key : string] : unknown} = {};
	for (const [key, item] of Object.entries(value)) {
		const convertedItem = fromWireValue(item, makeTimestamp);
		if (convertedItem !== item) changed = true;
		result[key] = convertedItem;
	}
	return changed ? result : value;
};

//The inverse of toWire. Accepting Wire<T> (and returning the real T with no
//cast at the receiver) is the other half of the #738 brand: a receiver
//cannot forget the conversion either, and a payload that never went through
//toWire does not typecheck as an argument here.
export const fromWire = <T>(value : Wire<T>, makeTimestamp : (seconds : number, nanoseconds : number) => unknown) : T => {
	return fromWireValue(value, makeTimestamp) as T;
};
