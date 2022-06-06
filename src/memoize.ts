import { deepEqual } from './util.js';


const arrayEqual = (a : any[], b : any[]) : boolean => {
	if (a.length != b.length) return false;
	return a.every((a,index) => a === b[index]);
};

//Like memoize, except the first argument is expected to be a thing that changes
//often, and the rest of the arguments are assumed to change rarely.
export function memoizeFirstArg<R, T extends (...args: any[]) => R>(fn : T) : T {
	const resultMap = new WeakMap();
	let g = (...args: any[]) => {
		if (!args.length) return fn();
		const firstArg = args[0];
		const restArgs = args.slice(1);
		const record = resultMap.get(firstArg);
		if (record && arrayEqual(record.restArgs, restArgs)) return record.result;
		const result = fn(...args);
		resultMap.set(firstArg, {restArgs, result});
		return result;
	};
	return g as T;
};

//deepEqualReturnSame is designed to wrap functions. If the result of the
//function is deepEqual to the last result, then it will return literally the
//last result. This is very useful in cases where there are values that have
//tons of expensive downstream calculations driven off of them, and where a
//small change to their inputs but no change in output is common. But note that
//deepEqual is expensive, so don't use it unless you know that the output is
//upstream of a LOT of calculations.
export function deepEqualReturnSame<R, T extends (...args: any[]) => R>(fn : T) : T {
	//The precise, equality key of the last result to check to see if they're exactly the same
	let resultKey;
	//The value to return if they're deep equal.
	let resultValue : R;
	let g = (...args : any[]) : R => {
		resultKey = fn(...args);
		if (deepEqual(resultKey, resultValue)) {
			return resultValue;
		}
		resultValue = resultKey;
		return resultValue;
	};
	return g as T;
};

//memoize will retain up to entries number of past arguments and if any match,
//return that result instead of recalculating.
//Using pattern described at https://stackoverflow.com/a/43382807
export function memoize<R, T extends (...args: any[]) => R>(fn : T, entries : number = 3) : T {

	//Objects with args, result
	const memoizedRecords : {args: any[], result: R}[] = [];

	const g = (...args : any[]) : R => {
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
};
