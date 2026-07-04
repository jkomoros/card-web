//Document-ID partitions for reading the privileged unpublished corpus.
//Shared by the main-thread fetch path (src/actions/database.ts) and the
//corpus worker (both the getDocs prime and the per-partition live
//listeners) — previously each side carried its own copy and they had
//already drifted (one bounded the last partition with the max-string
//sentinel, the other left it open).
//
//A single query over 38k+ docs hits Firestore's ~60s non-configurable
//server timeout; partitioning by document-ID range keeps each query small
//AND localizes a dropped Listen stream to ~1/5 of the corpus. The
//boundaries encode the CURRENT corpus's ID distribution (ids are
//c-NNN-xxxxxx); a future ID scheme must revisit them or one partition
//silently absorbs everything and reintroduces the timeout.

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
	{ gte: '', lt: 'c-2' },
	{ gte: 'c-2', lt: 'c-4' },
	{ gte: 'c-4', lt: 'c-6' },
	{ gte: 'c-6', lt: 'c-8' },
	{ gte: 'c-8', lt: FIRESTORE_ID_UPPER_BOUND },
];

//Human-readable range label for status/log lines.
export const partitionLabel = (partition : UnpublishedCardPartition) : string => {
	const upper = partition.lt === FIRESTORE_ID_UPPER_BOUND ? 'end' : partition.lt;
	return `[${partition.gte || 'start'},${upper})`;
};
