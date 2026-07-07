//Pure core of the `updated` write-invariant guard (zero imports so it can
//be unit-tested in Node). See src/multi_batch.ts for the enforcement point
//and docs/corpus-sync-design.md for why the invariant is load-bearing: the
//watermark delta sync only fetches docs with updated > watermark, and the
//timestamp-equality fast dedupe treats equal `updated` as proof of
//equivalence — a card write that forgets the bump silently never reaches
//other devices.

//True when path names a TOP-LEVEL doc in the given collection (not a
//subcollection doc like cards/{id}/updates/{ts}).
export const isTopLevelDocPath = (path : string, collectionName : string) : boolean => {
	const segments = path.split('/');
	return segments.length === 2 && segments[0] === collectionName;
};

//Returns the violation message for a card write, or null if the write is
//compliant. hasUpdatedSentinel: whether data.updated is the
//serverTimestamp() sentinel (the caller owns SDK-specific detection).
export const cardWriteViolation = (path : string, cardsCollection : string, hasUpdatedSentinel : boolean) : string | null => {
	if (!isTopLevelDocPath(path, cardsCollection)) return null;
	if (hasUpdatedSentinel) return null;
	return `Card write to ${path} does not set updated: serverTimestamp(). ` +
		'Every card mutation must bump `updated` or other devices will never sync it ' +
		'(see docs/corpus-sync-design.md). If this writer genuinely must not bump ' +
		'(reader-counter paths only), use updateWithoutTimestampBump().';
};
