export type DateRangeComparison = 'before' | 'after' | 'between';

export const relativeDateCacheKey = (referenceDate: Date = new Date()): string =>
	`${referenceDate.getFullYear()}-${referenceDate.getMonth()}-${referenceDate.getDate()}`;

/**
 * Parses a relative date string from local midnight.
 * Returns null if the string is not a recognized relative date format.
 */
export const parseRelativeDate = (str: string, referenceDate: Date = new Date()): Date | null => {
	if (!str) return null;

	if (str === 'today') {
		const d = new Date(referenceDate);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	if (str === 'yesterday') {
		const d = new Date(referenceDate);
		d.setDate(d.getDate() - 1);
		d.setHours(0, 0, 0, 0);
		return d;
	}

	const offsetMatch = str.match(/^(\d+)-(day|week|month|year)s?-ago$/);
	if (offsetMatch) {
		const amount = parseInt(offsetMatch[1], 10);
		const unit = offsetMatch[2];
		const d = new Date(referenceDate);
		d.setHours(0, 0, 0, 0);

		switch(unit) {
		case 'day':
			d.setDate(d.getDate() - amount);
			break;
		case 'week':
			d.setDate(d.getDate() - (amount * 7));
			break;
		case 'month':
			d.setMonth(d.getMonth() - amount);
			break;
		case 'year':
			d.setFullYear(d.getFullYear() - amount);
			break;
		}

		return d;
	}

	const weekdayMatch = str.match(/^last-(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/);
	if (weekdayMatch) {
		const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
		const targetDay = weekdays.indexOf(weekdayMatch[1]);
		const d = new Date(referenceDate);
		d.setHours(0, 0, 0, 0);
		const daysBack = ((d.getDay() - targetDay + 7) % 7) || 7;
		d.setDate(d.getDate() - daysBack);
		return d;
	}

	return null;
};

/**
 * Resolves an absolute date once, or a relative date once per local day.
 */
export const makeFilterDateResolver = (dateStr? : string) : (() => Date | null) => {
	if (!dateStr) return () => null;

	if (!parseRelativeDate(dateStr)) {
		const date = new Date(dateStr);
		return () => date;
	}

	let date : Date | null = null;
	let resolvedAt = 0;
	let expiresAt = 0;
	return () => {
		const now = Date.now();
		if (!date || now < resolvedAt || now >= expiresAt) {
			const referenceDate = new Date(now);
			date = parseRelativeDate(dateStr, referenceDate);
			resolvedAt = now;

			const tomorrow = new Date(referenceDate);
			tomorrow.setDate(tomorrow.getDate() + 1);
			tomorrow.setHours(0, 0, 0, 0);
			expiresAt = tomorrow.getTime();
		}
		return date;
	};
};

export const dateMatchesFilter = (
	valueMillis : number,
	comparisonType : DateRangeComparison,
	resolveFirstDate : () => Date | null,
	resolveSecondDate : () => Date | null
) : boolean => {
	const firstDate = resolveFirstDate();
	const firstDifference = valueMillis - (firstDate ? firstDate.getTime() : 0);

	switch(comparisonType) {
	case 'before':
		return firstDifference < 0;
	case 'after':
		return firstDifference > 0;
	case 'between': {
		const secondDate = resolveSecondDate();
		if (!secondDate) return false;
		const secondDifference = valueMillis - secondDate.getTime();
		return (firstDifference > 0 && secondDifference < 0) || (firstDifference < 0 && secondDifference > 0);
	}
	}
};
