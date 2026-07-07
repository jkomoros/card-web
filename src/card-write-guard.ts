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

//The ONLY top-level card fields a no-bump write (updateWithoutTimestampBump)
//may touch. These are the reader-driven counters whose drift is an accepted
//tradeoff (single editor, rare readers, vestigial tweet feature) and whose
//security rules (cardEditMinor) forbid touching `updated`. ANY other field is
//a content change that MUST bump `updated`, so writing it via the escape
//hatch is a bug — the hatch is not a way to opt out of the invariant for
//real content.
export const COUNTER_FIELDS_EXEMPT_FROM_UPDATED : readonly string[] = [
	'star_count',
	'star_count_manual',
	'thread_count',
	'thread_resolved_count',
	'updated_message',
	'tweet_count',
	'tweet_favorite_count',
	'tweet_retweet_count',
	'last_tweeted'
];

//Returns a violation message if a no-bump card write (updateWithoutTimestampBump)
//touches any field outside the counter allowlist, or null if it is a
//legitimate counter-only write. `keys` are the top-level field names being
//written. Non-card writes are always allowed (the invariant is card-only).
export const nonBumpCardWriteViolation = (path : string, cardsCollection : string, keys : string[]) : string | null => {
	if (!isTopLevelDocPath(path, cardsCollection)) return null;
	const disallowed = keys.filter(key => !COUNTER_FIELDS_EXEMPT_FROM_UPDATED.includes(key));
	if (disallowed.length === 0) return null;
	return `updateWithoutTimestampBump write to ${path} touches non-counter field(s): ${disallowed.join(', ')}. ` +
		'The escape hatch is only for reader-driven counters (' + COUNTER_FIELDS_EXEMPT_FROM_UPDATED.join(', ') + '); ' +
		'a content change must bump `updated` — use update() instead.';
};
