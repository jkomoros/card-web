//The pure part of the paged embedding reindex (#783). Lives in shared/ (no
//imports) because CI installs and builds only the root and shared/, never
//functions/node_modules — a test that compiled functions/ to reach it would
//have failed in CI (the review's find) — and because importing embeddings.ts
//itself would initialize Firebase, OpenAI and Qdrant at load.
//
//Why paged: the reindex loaded every card (~47k, with bodies and search
//tokens) AND scrolled every Qdrant point WITH its vector (47k × 1536 floats)
//into one process with 1 GiB, and died out of memory on every deploy since
//Sept 20 — silently, because the deploy fired it and never looked. A page of
//cards and the payloads of just their points fit in a few MB; a vector is
//fetched only for the one case that needs it (same content, older version).

export const DEFAULT_REINDEX_PAGE_SIZE = 500;
//A page stops taking new cards after this long and returns a cursor into
//itself: the deploy's loop calls each page with Node's fetch, whose headers
//timeout is 300 s, and a page of 500 cards that all need a fresh embedding
//(a version bump — exactly when a reindex matters) is 500 sequential model
//calls. Each card is processed to completion; only the walk is cut.
export const PAGE_TIME_BUDGET_MS = 120 * 1000;
//Cards whose embedding text is unchanged at the current version need only a
//fresh last_updated; Qdrant sets a payload on many points in one call.
export const UNCHANGED_PAYLOAD_BATCH = 200;

export type ReindexDecision = 'touch' | 'reuse-vector' | 'embed';

//What to do with one card given the point Qdrant holds for it (any version).
//  touch:        content and version both current — update last_updated only;
//  reuse-vector: content current but the version is older — fetch the vector
//                and re-store it under the current version, no embedding call;
//  embed:        content changed or no point — compute an embedding.
export const reindexDecision = (
	text : string,
	existing : {content? : string, extraction_version? : number} | null | undefined,
	currentVersion : number,
) : ReindexDecision => {
	if (!existing || existing.content !== text) return 'embed';
	return (existing.extraction_version || 0) === currentVersion ? 'touch' : 'reuse-vector';
};

export type ReindexPageResult = {
	//The last card id of the page, to start the next page after; null when
	//the walk is complete.
	nextCursor : string | null,
	processed : number,
	touched : number,
	reused : number,
	embedded : number,
	failed : number,
	failures : string[],
};

//Chunks a list for batched calls.
export const chunked = <T>(items : T[], size : number) : T[][] => {
	const out : T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
};

//The next cursor for a page. When the page stopped early (time budget) the
//cursor is the last PROCESSED id, so the next request continues inside the
//same page. When the whole page was processed: the last id when the page was
//full (there may be more), null when it was short (the walk is done). A page
//that is exactly full ends with one more empty request, which is the cheap,
//correct answer.
export const nextCursorFor = (lastProcessedID : string | null, processedCount : number, pageLength : number, pageSize : number) : string | null => {
	if (!lastProcessedID || !processedCount) return null;
	if (processedCount < pageLength) return lastProcessedID;
	if (pageLength < pageSize) return null;
	return lastProcessedID;
};

//Whether a page should stop taking cards: over budget, with at least one
//card processed so a slow single card cannot stall the walk.
export const pageOverBudget = (startedAt : number, now : number, processedCount : number, budgetMs = PAGE_TIME_BUDGET_MS) : boolean =>
	processedCount > 0 && now - startedAt >= budgetMs;
