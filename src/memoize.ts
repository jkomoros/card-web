import { deepEqual } from './util.js';

const trimUndefined = (arr: unknown[]): unknown[] => {
	let lastDefinedIndex = arr.length - 1;
	while (lastDefinedIndex >= 0 && arr[lastDefinedIndex] === undefined) {
		lastDefinedIndex--;
	}
	return arr.slice(0, lastDefinedIndex + 1);
};

//arrayEqual will return true if the arrays are equal, ignoring undefined values at the end.
const arrayEqual = (a: unknown[], b: unknown[]): boolean => {
	const trimmedA = trimUndefined(a);
	const trimmedB = trimUndefined(b);
	if (trimmedA.length !== trimmedB.length) return false;
	return trimmedA.every((value, index) => value === trimmedB[index]);
};

//Like memoize, except the first argument is expected to be a thing that changes
//often, and the rest of the arguments are assumed to change rarely.
export function memoizeFirstArg<R, T extends (firstArg : object, ...restArgs: unknown[]) => R>(fn : T) : T {
	const resultMap = new WeakMap();
	const g = (firstArg : object, ...restArgs: unknown[]) => {
		const record = resultMap.get(firstArg);
		if (record && arrayEqual(record.restArgs, restArgs)) return record.result;
		const result = fn(firstArg, ...restArgs);
		resultMap.set(firstArg, {restArgs, result});
		return result;
	};
	return g as T;
}

//deepEqualReturnSame is designed to wrap functions. If the result of the
//function is deepEqual to the last result, then it will return literally the
//last result. This is very useful in cases where there are values that have
//tons of expensive downstream calculations driven off of them, and where a
//small change to their inputs but no change in output is common. But note that
//deepEqual is expensive, so don't use it unless you know that the output is
//upstream of a LOT of calculations.
export function deepEqualReturnSame<R, T extends (...args: unknown[]) => R>(fn : T) : T {
	//The precise, equality key of the last result to check to see if they're exactly the same
	let resultKey;
	//The value to return if they're deep equal.
	let resultValue : R;
	const g = (...args : unknown[]) : R => {
		resultKey = fn(...args);
		if (deepEqual(resultKey, resultValue)) {
			return resultValue;
		}
		resultValue = resultKey;
		return resultValue;
	};
	return g as T;
}

//Like memoize, but the FIRST argument — expected to be the large object
//whose retention matters (a corpus-sized cards map) — is a WeakMap key, so
//the cache never keeps it alive (#749). Each live first-arg keeps a small
//recency-ordered list of records for the remaining args, compared with
//arrayEqual: that preserves the property the plain memoize gave downstream
//consumers (a stable RESULT IDENTITY for repeated identical calls, which
//things like the configurable-filter memo key on) without the plain
//version's cost — memoize(fn, 3) holds its last three argument tuples
//STRONGLY, so a swapped-out corpus stayed pinned (measured on the issue:
//51.0 → 30.6 MB on flushing the memo) and #744's weak-keying of the
//downstream cache delivered zero net benefit. Records die with their
//first-arg key; everything they reference is alive anyway while the key is.
export function memoizeWeakFirstArg<R, T extends (firstArg : object, ...restArgs : unknown[]) => R>(fn : T, entries = 3) : T {
	const recordsByFirst = new WeakMap<object, {restArgs : unknown[], result : R}[]>();
	const g = (firstArg : object, ...restArgs : unknown[]) : R => {
		let records = recordsByFirst.get(firstArg);
		if (records) {
			const index = records.findIndex(record => arrayEqual(record.restArgs, restArgs));
			if (index >= 0) {
				const [record] = records.splice(index, 1);
				//Refresh recency so an in-use tuple is not the one evicted.
				records.unshift(record);
				return record.result;
			}
		} else {
			records = [];
			recordsByFirst.set(firstArg, records);
		}
		const result = fn(firstArg, ...restArgs);
		records.unshift({restArgs, result});
		if (records.length > entries) records.splice(entries);
		return result;
	};
	return g as T;
}

//memoize will retain up to entries number of past arguments and if any match,
//return that result instead of recalculating.
//Using pattern described at https://stackoverflow.com/a/43382807
//
//RETENTION WARNING (#749): the records hold their args STRONGLY. The
//default of 3 entries is fine for small arguments, but a caller whose
//arguments include corpus-sized maps will pin up to three corpora for as
//long as nothing displaces them — which is how the filter-extras memo
//became the app's largest accidental retainer. For corpus-sized arguments
//use memoizeWeakFirstArg with the big object first.
export function memoize<R, T extends (...args: unknown[]) => R>(fn : T, entries  = 3) : T {

	//Objects with args, result
	const memoizedRecords : {args: unknown[], result: R}[] = [];

	const g = (...args : unknown[]) : R => {
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

	return g as T;
}
