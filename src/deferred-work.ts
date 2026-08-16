//Keeps a debounced expensive task from being starved by unrelated state churn,
//without letting an old max-wait window spill into a newly-selected subject.
//For example, a card-info calculation that has been deferred for one card
//must not become immediately overdue on the first ArrowRight dispatch for the
//next card.
export const deferredWorkStartedAt = (firstDeferredAt : number, now : number, subjectChanged : boolean) : number => {
	if (!firstDeferredAt || subjectChanged) return now;
	return firstDeferredAt;
};

export const deferredWorkIsOverdue = (firstDeferredAt : number, now : number, maxWaitMs : number) : boolean =>
	Boolean(firstDeferredAt) && now - firstDeferredAt >= maxWaitMs;
