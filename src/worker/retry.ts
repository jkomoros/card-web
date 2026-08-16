//Small dependency-free retry helper for the corpus worker's Firestore
//operations. The worker uses a memory cache, so unlike the main thread there
//is no persistent-cache cushion when the backend has a blip: reads must be
//retried against the server or the corpus silently loads incomplete.

export type RetryOptions = {
	//Maximum number of attempts (including the first). Default 5.
	attempts? : number,
	//Delay before the first retry; doubles each retry. Default 1000.
	baseDelayMs? : number,
	//Cap on the backoff delay. Default 60000.
	maxDelayMs? : number,
	//Checked before each attempt and after each backoff sleep; when it
	//returns false (e.g. the connection generation moved on) the retry loop
	//stops immediately by rethrowing the last error.
	shouldContinue? : () => boolean,
	//Called before each backoff sleep with the error that caused the retry.
	onRetry? : (error : unknown, attempt : number, delayMs : number) => void,
};

const sleep = (ms : number) : Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const retryWithBackoff = async <T>(fn : () => Promise<T>, options : RetryOptions = {}) : Promise<T> => {
	const attempts = options.attempts ?? 5;
	const baseDelayMs = options.baseDelayMs ?? 1000;
	const maxDelayMs = options.maxDelayMs ?? 60000;
	const shouldContinue = options.shouldContinue ?? (() => true);
	let lastError : unknown = new Error('retryWithBackoff: no attempts made');
	let delay = baseDelayMs;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (!shouldContinue()) throw lastError;
		try {
			return await fn();
		} catch (error) {
			lastError = error;
			if (attempt === attempts) break;
			if (options.onRetry) options.onRetry(error, attempt, delay);
			await sleep(delay);
			delay = Math.min(delay * 2, maxDelayMs);
		}
	}
	throw lastError;
};
