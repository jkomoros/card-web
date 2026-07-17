import { CollectionComposerSuggestion } from './collection-composer-suggestions.js';

type PreviewResult = { numCards: number };
type PreviewRunner = (
	description: string,
	keyCardID: string
) => Promise<PreviewResult | null> | null;

type PreviewOptions = {
	debounceMS?: number;
	maxConcurrent?: number;
};

//A restarted composer generation can share work already in the corpus worker,
//but completed results are not cached because corpus membership can change.
const inFlight = new Map<string, Promise<PreviewResult | null>>();
const GLOBAL_MAX_CONCURRENT = 2;
let globallyRunning = 0;

type PreviewOwner = {
	active: boolean;
	running: number;
	maxConcurrent: number;
	onCount: (suggestionID: string, count: number) => void;
};

type PreviewJob = {
	owner: PreviewOwner;
	key: string;
	description: string;
	keyCardID: string;
	suggestionIDs: string[];
	run: PreviewRunner;
};

const globalQueue: PreviewJob[] = [];

const finishJob = (job: PreviewJob) => {
	job.owner.running--;
	pumpPreviewQueue();
};

const observePreview = (job: PreviewJob, pending: Promise<PreviewResult | null>) => {
	job.owner.running++;
	pending
		.then((result) => {
			if (!job.owner.active || !result) return;
			for (const suggestionID of job.suggestionIDs) job.owner.onCount(suggestionID, result.numCards);
		})
		.catch(() => {
			//Previews are progressive enhancement. Worker failures leave the
			//suggestion usable without a count.
		})
		.finally(() => finishJob(job));
};

function pumpPreviewQueue() {
	for (let index = globalQueue.length - 1; index >= 0; index--) {
		if (!globalQueue[index].owner.active) globalQueue.splice(index, 1);
	}
	while (true) {
		//Joining work that is already running consumes no additional worker slot,
		//so attach those observers even while the global worker limit is full.
		const sharedIndex = globalQueue.findIndex(job =>
			job.owner.active &&
			job.owner.running < job.owner.maxConcurrent &&
			inFlight.has(job.key)
		);
		if (sharedIndex >= 0) {
			const job = globalQueue.splice(sharedIndex, 1)[0];
			observePreview(job, inFlight.get(job.key)!);
			continue;
		}
		if (globallyRunning >= GLOBAL_MAX_CONCURRENT) return;
		const index = globalQueue.findIndex(job => job.owner.active && job.owner.running < job.owner.maxConcurrent);
		if (index < 0) return;
		const job = globalQueue.splice(index, 1)[0];
		let started : ReturnType<PreviewRunner>;
		try {
			started = job.run(job.description, job.keyCardID);
		} catch {
			//Treat a synchronous worker bridge failure the same as an unavailable
			//or rejected progressive preview.
			continue;
		}
		if (!started) continue;
		const pending = Promise.resolve(started);
		inFlight.set(job.key, pending);
		globallyRunning++;
		const release = () => {
			if (inFlight.get(job.key) === pending) inFlight.delete(job.key);
			globallyRunning--;
		};
		pending.then(release, release);
		observePreview(job, pending);
	}
}

export const startCollectionComposerPreviews = (
	suggestions: CollectionComposerSuggestion[],
	keyCardID: string,
	run: PreviewRunner,
	onCount: (suggestionID: string, count: number) => void,
	options: PreviewOptions = {}
): (() => void) => {
	const owner: PreviewOwner = {
		active: true,
		running: 0,
		maxConcurrent: Math.min(GLOBAL_MAX_CONCURRENT, Math.max(1, options.maxConcurrent ?? GLOBAL_MAX_CONCURRENT)),
		onCount,
	};
	const grouped = new Map<string, {description: string, suggestionIDs: string[]}>();
	for (const suggestion of suggestions) {
		const description = suggestion.description.serialize();
		const key = `${keyCardID}\n${description}`;
		const existing = grouped.get(key);
		if (existing) existing.suggestionIDs.push(suggestion.id);
		else grouped.set(key, {description, suggestionIDs: [suggestion.id]});
	}
	const enqueue = () => {
		for (const [key, work] of grouped.entries()) {
			globalQueue.push({owner, key, description: work.description, keyCardID, suggestionIDs: work.suggestionIDs, run});
		}
		pumpPreviewQueue();
	};

	const debounceMS = Math.max(0, options.debounceMS ?? 150);
	const timer = debounceMS ? window.setTimeout(enqueue, debounceMS) : null;
	if (!timer) enqueue();

	return () => {
		owner.active = false;
		if (timer) window.clearTimeout(timer);
		pumpPreviewQueue();
	};
};
