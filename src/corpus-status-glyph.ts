//The pure state→glyph mapping for corpus-status-indicator: given everything
//Redux knows about sync health, produce the dot's tone, whether it pulses,
//the compact count label, the pending-writes badge, and the multi-line
//tooltip. Pure and DOM-free so the whole layered-meaning contract is
//Node-testable (test/corpus-status-glyph); the component just renders what
//this returns.

import {
	CorpusStatus,
} from './types.js';

export const DEFAULT_CORPUS_STATUS_MESSAGES : Record<CorpusStatus, string> = {
	off: 'Card sync: standard mode',
	loading: 'Card sync: loading and verifying the corpus',
	live: 'Card sync: live',
	stale: 'Card sync is interrupted. Lists and search are temporarily unavailable; retrying automatically.',
	degraded: 'Card sync is degraded.',
	fallback: 'Background card sync is unavailable; using standard loading.',
	checking: 'Checking whether this tab can safely start card sync…',
	contended: 'Compendium is active in another tab.',
	inactive: 'Compendium moved to another tab. This tab is safely disconnected.',
	takeover: 'Moving Compendium to this tab…',
	unsupported: 'This browser cannot safely coordinate card sync.',
	'ownership-error': 'Card sync could not start.',
};

//The layered meaning of the dot, one tone per layer of health:
//- 'ok': live, nothing pending (the app's green-equivalent).
//- 'working': actively fetching/verifying — rendered with a pulse.
//- 'pending': local changes not yet server-confirmed (amber). Overrides ok
//  and working (the pulse survives when both apply).
//- 'problem': degraded/interrupted/wedged (red). Overrides everything.
//- 'muted': this tab is deliberately not syncing (other-tab ownership,
//  standard mode, fallback) — gray.
export type CorpusGlyphTone = 'ok' | 'working' | 'pending' | 'problem' | 'muted';

export type CorpusGlyphInput = {
	status : CorpusStatus,
	//The free-form corpusStatusMessage from Redux ('' when none).
	message : string,
	corpusSize : number,
	//Roughly how many cards the finished corpus will hold, when known
	//(cold sweep); null otherwise.
	expectedCorpusSize : number | null,
	corpusSnapshotAgeMs : number | null,
	//True once the worker announced loadComplete: every card is in hand and
	//any remaining non-live time is verification, not download.
	corpusComplete : boolean,
	//Verification-checkpoint progress for the loadComplete→live window: how
	//many of the connection's fixed set of verification checks have
	//completed, out of how many. null when the connection reports none
	//(reader/legacy modes) — the verifying line then stays imprecise.
	verifyDone : number | null,
	verifyTotal : number | null,
	//Card saves committed locally and awaiting their server echo.
	pendingSaveCount : number,
	//Durable aux-write intents (stars/reads/comments/creations) queued in
	//localStorage and not yet server-confirmed.
	queuedWriteCount : number,
};

export type CorpusGlyph = {
	tone : CorpusGlyphTone,
	pulse : boolean,
	//Compact count beside the dot: '812', '40.2k', '12.4k↑' (fetching, total
	//unknown), '12.4k/40.2k' (fetching, total known). '' when nothing to show.
	countLabel : string,
	//Superscript badge for un-confirmed local changes: '·2', or ''.
	pendingBadge : string,
	//Newline-separated full status; each line appears only when relevant.
	tooltip : string,
	//0..1 fraction of the CURRENT phase, when known; null otherwise. While
	//downloading it is the fetched fraction of the expected corpus; while
	//verifying it is the completed fraction of the verification checks — the
	//ring on the dot always means "progress of the current phase". Drives the
	//ring fill and the percentage in the tooltip.
	progress : number | null,
	//Which phase the ring's progress describes — drives the band's color so
	//downloading and verifying are distinguishable at a glance.
	progressPhase : 'download' | 'verify' | null,
	//True when the corpus is readable but card saves are gated (worker mode,
	//any non-'live' status with cards on screen — the verifying window, and
	//stale/degraded interruptions). Rendered as a tiny padlock so "you can
	//read, you can't yet save" is visible at a glance.
	writeLocked : boolean,
};

//Statuses during which the corpus is actively being fetched or verified —
//the "still working" pulse.
const FETCHING_STATUSES : ReadonlySet<CorpusStatus> = new Set<CorpusStatus>(['loading', 'checking', 'takeover']);

const PROBLEM_STATUSES : ReadonlySet<CorpusStatus> = new Set<CorpusStatus>(['stale', 'degraded', 'unsupported', 'ownership-error']);

//Compact enough to sit next to the dot without becoming a second status
//sentence: 812 -> '812', 40225 -> '40.2k'.
export const compactCardCount = (count : number) : string => {
	if (count < 10000) return String(count);
	return `${(count / 1000).toFixed(1)}k`;
};

const HOUR_MS = 60 * 60 * 1000;

const snapshotAgeLabel = (ageMs : number) : string => {
	const hours = ageMs / HOUR_MS;
	if (hours < 24) return `${Math.round(hours)}h`;
	return `${Math.round(hours / 24)}d`;
};

export const corpusStatusGlyph = (input : CorpusGlyphInput) : CorpusGlyph => {
	const {status, message, corpusSize, expectedCorpusSize, corpusComplete, verifyDone, verifyTotal, corpusSnapshotAgeMs, pendingSaveCount, queuedWriteCount} = input;

	const fetching = FETCHING_STATUSES.has(status);
	const pendingTotal = pendingSaveCount + queuedWriteCount;

	//Verification-checkpoint progress, when this connection reports it.
	//Clamped: the worker latches checkpoints so done is monotonic, but a
	//defensive clamp here means a re-run phase can never claim more checks
	//than exist.
	const haveVerify = verifyTotal !== null && verifyTotal > 0 && verifyDone !== null;
	const clampedVerifyDone = haveVerify ? Math.min(verifyDone as number, verifyTotal as number) : 0;

	//Layer precedence: problem beats pending beats working beats ok/muted.
	//Pending outranks even the muted states — a queued change is the user's
	//own work waiting, which matters regardless of which tab owns sync.
	let tone : CorpusGlyphTone;
	if (PROBLEM_STATUSES.has(status)) tone = 'problem';
	else if (pendingTotal > 0) tone = 'pending';
	else if (fetching) tone = 'working';
	else if (status === 'live') tone = 'ok';
	else tone = 'muted';

	//"Still working" stays visible even when the amber pending layer wins the
	//color; a problem dot holds steady so it reads as a state, not activity.
	const pulse = fetching && tone !== 'problem';

	//A total is only a progress target while it is ahead of the count.
	const haveTarget = fetching && expectedCorpusSize !== null && expectedCorpusSize > corpusSize;

	let countLabel = '';
	if (corpusSize) {
		if (haveTarget) countLabel = `${compactCardCount(corpusSize)}/${compactCardCount(expectedCorpusSize as number)}`;
		else if (fetching) countLabel = `${compactCardCount(corpusSize)}↑`;
		else countLabel = compactCardCount(corpusSize);
	}

	const pendingBadge = pendingTotal > 0 ? `·${pendingTotal}` : '';

	const lines : string[] = [];
	if (status === 'live') {
		lines.push(corpusSize
			? `Cards: ${corpusSize.toLocaleString()} — up to date`
			: DEFAULT_CORPUS_STATUS_MESSAGES.live);
	} else if (fetching && corpusSize) {
		//'loading' is genuinely downloading; 'checking'/'takeover' with cards
		//already on screen are VERIFYING — a warm boot has the whole corpus in
		//hand within seconds, and calling that state "fetching" read as "still
		//downloading 40k cards" when nothing was being downloaded at all.
		if (status !== 'loading' || corpusComplete) {
			//With checkpoint progress the verifying line gains precision:
			//which check we are on and how far through. Capped below 100% —
			//only reaching 'live' may claim done.
			if (haveVerify) {
				const pct = Math.min(Math.round((clampedVerifyDone / (verifyTotal as number)) * 100), 99);
				lines.push(`Verifying ${corpusSize.toLocaleString()} cards… (${clampedVerifyDone} of ${verifyTotal} checks, ${pct}%)`);
			} else {
				lines.push(`Verifying ${corpusSize.toLocaleString()} cards…`);
			}
		} else if (haveTarget) {
			const pct = Math.min(Math.round((corpusSize / (expectedCorpusSize as number)) * 100), 99);
			lines.push(`Fetching cards: ${corpusSize.toLocaleString()} of ~${(expectedCorpusSize as number).toLocaleString()} (${pct}%)…`);
		} else {
			lines.push(`Fetching cards: ${corpusSize.toLocaleString()} so far…`);
		}
	} else {
		lines.push(DEFAULT_CORPUS_STATUS_MESSAGES[status]);
		if (corpusSize) lines.push(`Cards: ${corpusSize.toLocaleString()}`);
	}
	if (pendingSaveCount > 0) {
		lines.push(pendingSaveCount === 1
			? '1 save awaiting server confirmation'
			: `${pendingSaveCount} saves awaiting server confirmation`);
	}
	if (queuedWriteCount > 0) {
		lines.push(queuedWriteCount === 1
			? '1 queued change will be retried automatically'
			: `${queuedWriteCount} queued changes will be retried automatically`);
	}
	//Only worth saying once it is old enough to explain something the user
	//might otherwise mistake for missing data.
	if (corpusSnapshotAgeMs !== null && corpusSnapshotAgeMs >= HOUR_MS) {
		lines.push(`Snapshot: ${snapshotAgeLabel(corpusSnapshotAgeMs)} old`);
	}
	//The free-form message, when it adds something the lines above did not
	//already say (the 'stale' dispatch carries the default copy verbatim).
	if (message && !lines.includes(message)) lines.push(message);

	//The ring means "progress of the current phase". While genuinely
	//downloading with a known target it is the fetched fraction; while
	//verifying (warm boot, or the post-download window) it is the completed
	//fraction of the verification checks. Capped below 1 so the ring never
	//claims done before the status does.
	const downloading = status === 'loading' && !corpusComplete;
	const verifying = fetching && corpusSize > 0 && !downloading;
	let progress : number | null = null;
	let progressPhase : 'download' | 'verify' | null = null;
	if (downloading && expectedCorpusSize && expectedCorpusSize > 0) {
		progress = Math.min(corpusSize / expectedCorpusSize, 0.99);
		progressPhase = 'download';
	} else if (verifying && haveVerify) {
		progress = Math.min(clampedVerifyDone / (verifyTotal as number), 0.99);
		progressPhase = 'verify';
	}

	//Write-locked: cards are on screen but saving is gated until the corpus
	//reaches 'live'. The tooltip line reuses sync-copy's verifying clause so
	//the pill can never drift from what the blocked controls' tooltips say.
	const writeLocked = status !== 'live' && corpusSize > 0 &&
		(FETCHING_STATUSES.has(status) || PROBLEM_STATUSES.has(status));
	if (writeLocked) {
		lines.push('Reading, browsing and editing work now; saving unlocks when verification finishes.');
	}

	return {tone, pulse, countLabel, pendingBadge, tooltip: lines.join('\n'), writeLocked, progress, progressPhase};
};
