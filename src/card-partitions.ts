//Document-ID partitions for reading the privileged unpublished corpus.
//Shared by the main-thread fetch path (src/actions/database.ts) and the
//corpus worker (both the getDocs prime and the per-partition live
//listeners) — previously each side carried its own copy and they had
//already drifted (one bounded the last partition with the max-string
//sentinel, the other left it open).
//
//A single query over 38k+ docs hits Firestore's ~60s non-configurable
//server timeout (~37s per 10k docs measured under forced long-polling);
//partitioning by document-ID range keeps each query small AND localizes a
//dropped Listen stream to one partition's worth of redelivery. The
//boundaries encode the CURRENT corpus's ID distribution (ids are
//c-NNN-xxxxxx, with the digit after 'c-' distributed evenly 0-9); a future
//ID scheme must revisit them or one partition silently absorbs everything
//and reintroduces the timeout.
//
//SIZED FOR THE 60k+ PROD TARGET: ten single-digit partitions ≈ 6k docs
//each at 60k (~20s per query, comfortably under the timeout) with headroom
//to ~100k. Five two-digit partitions were fine at 40k (~8k each) but reach
//~12k each at 60k — back inside the zone where a Listen stream was
//observed dying ("datastore operation timed out" at 38k single-stream).
//Note: reshaping partitions invalidates previously-persisted per-query
//resume tokens, costing one full re-read on the first boot after the
//change — don't reshape casually.

//The conventional Firestore max-string sentinel (U+F8FF) bounding the last
//partition above. An explicit escape — an invisible literal in a string is
//how the two previous copies of this table drifted unnoticed.
export const FIRESTORE_ID_UPPER_BOUND = '\uf8ff';

export type UnpublishedCardPartition = {
	//'' means unbounded below.
	gte : string,
	lt : string
};

export const UNPUBLISHED_CARD_PARTITIONS : UnpublishedCardPartition[] = [
	{ gte: '', lt: 'c-1' },
	{ gte: 'c-1', lt: 'c-2' },
	{ gte: 'c-2', lt: 'c-3' },
	{ gte: 'c-3', lt: 'c-4' },
	{ gte: 'c-4', lt: 'c-5' },
	{ gte: 'c-5', lt: 'c-6' },
	{ gte: 'c-6', lt: 'c-7' },
	{ gte: 'c-7', lt: 'c-8' },
	{ gte: 'c-8', lt: 'c-9' },
	{ gte: 'c-9', lt: FIRESTORE_ID_UPPER_BOUND },
];

//Human-readable range label for status/log lines.
export const partitionLabel = (partition : UnpublishedCardPartition) : string => {
	const upper = partition.lt === FIRESTORE_ID_UPPER_BOUND ? 'end' : partition.lt;
	return `[${partition.gte || 'start'},${upper})`;
};
