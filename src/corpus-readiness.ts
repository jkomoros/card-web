//Pure logic for deciding whether the corpus worker's corpus can be trusted
//to SERVE (collections, reference blocks, find results) and to drive
//reconciliation, given how many cards Redux currently holds. Kept
//dependency-free so it can be unit-tested directly (the bridge itself
//imports store/window at module load and can't run under Node).
//
//Why this exists: readiness used to be inferred from "one batch arrived per
//fetch type", which is satisfiable by the FIRST of five partition flushes
//(~20% of the corpus) or by an offline worker's empty from-cache snapshot —
//both of which would let a partial or EMPTY worker corpus replace the
//warm-boot-primed 40k collection on screen. The worker now announces
//loadComplete explicitly, and this check guards against trusting a
//completed-but-implausibly-small corpus (offline boot, permission
//mismatch, partial outage) relative to what Redux already holds.

//Mirror of the reconciliation mass-removal guard: genuine
//while-you-were-away deletions are rare and small, so tolerate at most
//max(50, 10%) cards missing from the worker relative to Redux before
//declaring the worker corpus untrustworthy for serving.
export const corpusSizeTrustworthy = (workerCorpusSize : number, reduxCardCount : number) : boolean => {
	if (workerCorpusSize < 0) return false;
	const missing = reduxCardCount - workerCorpusSize;
	if (missing <= 0) return true;
	return missing <= Math.max(50, reduxCardCount * 0.1);
};

//Only privileged watermark sync needs the deletion+delta plane to be live
//before worker results are safe. Published-only and per-user author/editor
//connections do not use that plane and therefore have no syncState.
export const corpusSyncReady = (
	syncMode : 'listen' | 'watermark',
	mayViewUnpublished : boolean,
	syncState : 'unverified' | 'live' | 'stale' | ''
) : boolean => syncMode !== 'watermark' || !mayViewUnpublished || syncState === 'live';
