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

//SERVING vs VERIFICATION are different questions, and conflating them cost a
//19-second blank screen on the real 40k corpus: every card was in the store
//at ~4s, but nothing rendered until all three watermark planes were
//server-confirmed at ~23s.
//
//Master never gated reads on verification at all — it served whatever
//Firestore's persistent cache held and healed in the background — and this
//branch's own design docs say the same ("trust slow, serve fast"; "the
//bridge should serve collections … while surfacing staleness"). So reads
//only require the corpus to be PRESENT and plausibly complete.
//
//'stale' is deliberately excluded: it means a plane that WAS healthy has
//dropped (an active regression), which is a different signal from
//'unverified' (not yet confirmed on this boot).
export const corpusMayServe = (
	syncMode : 'listen' | 'watermark',
	mayViewUnpublished : boolean,
	syncState : 'unverified' | 'live' | 'stale' | ''
) : boolean => syncMode !== 'watermark' || !mayViewUnpublished ||
	syncState === 'live' || syncState === 'unverified';

//The corpus statuses for which corpus-ownership-gate renders a full-screen,
//modal, background-inert overlay. Shared so the keyboard-shortcut gate cannot
//drift from the visual one: `inert` does not suppress document/window keydown
//listeners, so without consulting this the app's shortcuts kept firing
//UNDERNEATH the overlay — navigating cards or selecting one on the bare arrow
//and Space bindings, and starting an edit or creating a card on Cmd-E/Cmd-M,
//in a tab whose store had already been purged.
export const CORPUS_STATUS_BLOCKS_INTERACTION : ReadonlySet<string> = new Set([
	'checking', 'contended', 'inactive', 'takeover', 'unsupported', 'ownership-error', 'degraded'
]);
