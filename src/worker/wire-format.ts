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

//Deep-converts any value, replacing values matching isTimestamp with wire
//markers. Returns the original object when nothing needed converting (the
//common case for most nested structures), so unaffected subtrees keep
//identity and no garbage is created for them.
export const toWire = (value : unknown, isTimestamp : (value : unknown) => boolean, getTime : (timestamp : unknown) => {seconds : number, nanoseconds : number}) : unknown => {
	if (!value || typeof value !== 'object') return value;
	if (isTimestamp(value)) {
		const {seconds, nanoseconds} = getTime(value);
		const result : WireTimestamp = {__wireTimestamp: true, seconds, nanoseconds};
		return result;
	}
	if (Array.isArray(value)) {
		let changed = false;
		const converted = value.map(item => {
			const convertedItem = toWire(item, isTimestamp, getTime);
			if (convertedItem !== item) changed = true;
			return convertedItem;
		});
		return changed ? converted : value;
	}
	let changed = false;
	const result : {[key : string] : unknown} = {};
	for (const [key, item] of Object.entries(value)) {
		const convertedItem = toWire(item, isTimestamp, getTime);
		if (convertedItem !== item) changed = true;
		result[key] = convertedItem;
	}
	return changed ? result : value;
};

//Deep-converts any value, replacing wire markers with the result of
//makeTimestamp. Returns the original object when nothing needed converting.
export const fromWire = (value : unknown, makeTimestamp : (seconds : number, nanoseconds : number) => unknown) : unknown => {
	if (!value || typeof value !== 'object') return value;
	if (isWireTimestamp(value)) {
		return makeTimestamp(value.seconds, value.nanoseconds);
	}
	if (Array.isArray(value)) {
		let changed = false;
		const converted = value.map(item => {
			const convertedItem = fromWire(item, makeTimestamp);
			if (convertedItem !== item) changed = true;
			return convertedItem;
		});
		return changed ? converted : value;
	}
	let changed = false;
	const result : {[key : string] : unknown} = {};
	for (const [key, item] of Object.entries(value)) {
		const convertedItem = fromWire(item, makeTimestamp);
		if (convertedItem !== item) changed = true;
		result[key] = convertedItem;
	}
	return changed ? result : value;
};
