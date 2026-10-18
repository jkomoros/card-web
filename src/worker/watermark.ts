//Pure watermark logic for the delta sync (docs/corpus-sync-design.md).
//Operates on plain {seconds, nanoseconds} shapes so it is unit-testable in
//Node without the Firestore SDK; callers convert to/from Timestamp.
//
//THE INVARIANT the no-gap proof rests on (do not "optimize" this away): a
//watermark may only ever be derived from, or advanced to, the `updated`
//value of a document actually resident in the corpus, delivered by a
//server-confirmed snapshot. Never from wall clock, snapshot read time, or
//locally-materialized echo cards (their timestamps are client-clock
//sentinels).

export type WireTimestamp = {
	seconds : number,
	nanoseconds : number
};

//Overlap subtracted from the watermark when building the delta query bound.
//Server timestamps are authoritative, so this is cheap insurance against
//boundary-equality subtleties and implementation drift, not clock skew: the
//cost is re-delivery of docs changed in the final minutes of the previous
//session, and ingestion is idempotent.
export const WATERMARK_MARGIN_SECONDS = 5 * 60;

export const compareTimestamps = (a : WireTimestamp, b : WireTimestamp) : number => {
	if (a.seconds !== b.seconds) return a.seconds - b.seconds;
	return a.nanoseconds - b.nanoseconds;
};

//The greatest `updated` across the given cards, or null if none carry one.
export const deriveWatermark = (updatedValues : Iterable<WireTimestamp | undefined | null>) : WireTimestamp | null => {
	let max : WireTimestamp | null = null;
	for (const value of updatedValues) {
		if (!value || typeof value.seconds !== 'number' || typeof value.nanoseconds !== 'number') continue;
		if (!max || compareTimestamps(value, max) > 0) max = value;
	}
	return max;
};

//Returns the candidate if it advances the current watermark, else current.
export const advanceWatermark = (current : WireTimestamp | null, candidate : WireTimestamp | undefined | null) : WireTimestamp | null => {
	if (!candidate || typeof candidate.seconds !== 'number' || typeof candidate.nanoseconds !== 'number') return current;
	if (!current || compareTimestamps(candidate, current) > 0) return candidate;
	return current;
};

//The query bound: watermark minus the safety margin, floored at epoch.
export const watermarkQueryBound = (watermark : WireTimestamp) : WireTimestamp => ({
	seconds: Math.max(0, watermark.seconds - WATERMARK_MARGIN_SECONDS),
	nanoseconds: watermark.nanoseconds
});

//Above this many docs the delta listener's window is served by the budgeted
//partition sweep instead of one listener. A single listener over tens of
//thousands of docs materializes them all in one delivery (the memory burst
//that killed the owner's tab twice on a months-old client, #786) and Firestore
//answers "exceeded the deadline" for it (DEV: 42,904 docs, never live). The
//sweep reads the same docs in pages of bounded size, with its own
//backpressure, and clamps the watermark to its start bound; a sweep that is
//still running on reconnect is resumed from its cursors.
export const DELTA_WINDOW_MAX_DOCS = 5000;

//Where a delta window of `count` docs should be served. One sweep per
//connection generation: if the window is still oversized afterwards, the
//listener is attached anyway rather than sweeping forever, and the status
//line says so.
export const deltaWindowRoute = (count : number | null, maxDocs : number, alreadySwept : boolean) : 'listen' | 'sweep' => {
	if (count === null || !Number.isFinite(count)) return 'listen';
	if (count <= maxDocs) return 'listen';
	return alreadySwept ? 'listen' : 'sweep';
};
