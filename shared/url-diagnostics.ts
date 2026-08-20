//Records the parts of a collection URL that could not be understood, so the app
//can TELL the user instead of silently showing something other than what the
//URL describes.
//
//Why this exists: five classes of malformed URL used to throw inside a
//collection run (#750). The worker's subscription loop swallows that, so a warm
//navigation kept showing the PREVIOUS collection under the new URL, and a cold
//load span forever on "loading…". Degrading to a sane fallback fixes the crash
//but introduces the quieter problem — the URL says one thing and the app does
//another — so every fallback reports here.
//
//Lives in shared/ rather than src/ because the URL PARSER lives here too
//(collection_description_base), and shared/ may not import from src/. It has
//zero imports of its own, so it does not compromise shared/'s standalone
//publishability.
//
//Deliberately a leaf module with no app imports: the reporters live in
//filters.ts and collection_description.ts, which run on BOTH the main thread and
//inside the corpus worker. In the worker nobody is listening and the reports
//simply accumulate against the cap; the main thread's copy is the one the UI
//reads.

export type URLDiagnostic = {
	//The URL part we could not make sense of, e.g. 'sort/bogus'.
	part : string,
	//What we did instead, in words a user could act on.
	fallback : string
};

//Bounded so a pathological URL (or a worker running for days) cannot grow this
//without limit. Newest wins: the most recent navigation is the one a user is
//looking at.
const MAX_DIAGNOSTICS = 24;

let diagnostics : URLDiagnostic[] = [];
let listener : ((diagnostics : URLDiagnostic[]) => void) | null = null;

export const reportURLDiagnostic = (part : string, fallback : string) : void => {
	//Collection runs repeat — the same bad URL is re-parsed on every recompute —
	//so dedupe rather than reporting the same part dozens of times.
	if (diagnostics.some(d => d.part === part)) return;
	diagnostics = [...diagnostics, {part, fallback}].slice(-MAX_DIAGNOSTICS);
	if (listener) listener(diagnostics);
};

export const currentURLDiagnostics = () : URLDiagnostic[] => diagnostics;

//The self-correction half (#757): a part that was reported and LATER parses
//fine — section/tag filter names load async, so an early recompute can
//record a diagnostic against a perfectly valid URL — is retracted by the
//success path. This is what makes boot-time false positives heal without a
//navigation-scoped clear. (An earlier rationale claimed clearing would
//also break re-reporting because makeConfigurableFilter reports only once
//per construction; execution showed that only holds for the narrow case of
//a wrapped bad head re-run against memoized-identical extras — the real
//reasons for no-clear are simplicity and that render-time scoping plus
//retraction already deliver hide-on-navigate and show-on-revisit.)
export const retractURLDiagnostic = (part : string) : void => {
	if (!diagnostics.some(d => d.part === part)) return;
	diagnostics = diagnostics.filter(d => d.part !== part);
	if (listener) listener(diagnostics);
};

//Cleared when the user navigates somewhere new, so a stale complaint about a URL
//they have left does not follow them around.
export const clearURLDiagnostics = () : void => {
	if (diagnostics.length === 0) return;
	diagnostics = [];
	if (listener) listener(diagnostics);
};

export const setURLDiagnosticsListener = (newListener : ((diagnostics : URLDiagnostic[]) => void) | null) : void => {
	listener = newListener;
};
