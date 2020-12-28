

const arrayEqual = (a, b) => {
	if (a.length != b.length) return false;
	return a.every((a,index) => a === b[index]);
};

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
