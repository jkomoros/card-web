

const arrayEqual = (a, b) => {
	if (a.length != b.length) return false;
	return a.every((a,index) => a === b[index]);
};

//Like memoize, except the first argument is expected to be a thing that changes
//often, and the rest of the arguments are assumed to change rarely.
export const memoizeFirstArg = (fn) => {
	const resultMap = new WeakMap();
	return (...args) => {
		if (!args.length) return fn();
		const firstArg = args[0];
		const restArgs = args.slice(1);
		const record = resultMap.get(firstArg);
		if (record && arrayEqual(record.restArgs, restArgs)) return record.result;
		const result = fn(...args);
		resultMap.set(firstArg, {restArgs, result});
		return result;
	};
};

//memoize will retain up to entries number of past arguments and if any match,
//return that result instead of recalculating.
export const memoize = (fn, entries = 3) => {

	//Objects with args, result
	const memoizedRecords = [];

	return (...args) => {
		for (const record of memoizedRecords) {
			if (arrayEqual(record.args, args)) return record.result;
		}
		const result = fn(...args);
		memoizedRecords.unshift({args, result});
		if (memoizedRecords.length > entries) {
			const itemsToRemove = memoizedRecords.length - entries;
			memoizedRecords.splice(-1 * itemsToRemove, itemsToRemove);
		}
		return result;
	};
};
