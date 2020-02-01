//NOTE: this file is duplicated (modulo npm/ES6 module syntax for exports) in
///functions/tweet-helpers.js. See #134 for de-duping

//This file is popped out separately so it can be linked into the webapp as well
//in reducers/collection.js

//cachedSectionTwidderMapForSections is the sections map we were last passed; if
//it's different then we should regenerate cachedSectionTwidderMap.
let cachedSectionTwidderMapForSections = null;
//The cached map to pass back out if cachedSectionTwidderMapForSections is the same as last time.
let cachedSectionTwiddlerMap = null;

const SECTION_TWIDDLE_AMOUNT = 0.20;
const UNPUBLISHED_LINKS_TWIDDLE_AMOUNT = 0.2;

//sectionTwiddler map returns a map of section names to amount to twiddle those
//values up for earlier sections. It's memoized so if sections doesn't change it
//returns the same thing--and generally it should only have to be generated
//once.
const sectionTwiddlerMap = (sections) => {

	if (cachedSectionTwidderMapForSections === sections && cachedSectionTwiddlerMap) return cachedSectionTwiddlerMap;

	let twiddlerMap = new Map();
	const sectionKeys = Object.keys(sections);
	for (let i = 0; i < sectionKeys.length; i++) {
		let multiplier = 1.0;
		const sectionKey = sectionKeys[i];
		//Section 0 is 'about', which isn't good... or bad.
		if (i !== 0) {
			//!st sectino is the best, but the last section (typically
			//!'random_thoughts') is actively bad, and the second-to-last
			//!(typically 'stubs') is neutral.
			multiplier = 1.0 + ((sectionKeys.length - i) * SECTION_TWIDDLE_AMOUNT) - (SECTION_TWIDDLE_AMOUNT * 2);
		}
		twiddlerMap.set(sectionKey, multiplier);
	}

	cachedSectionTwiddlerMap = twiddlerMap;
	cachedSectionTwidderMapForSections = sections;

	return twiddlerMap;

};

export const tweetOrderExtractor = (card, sections, allCards) => {
	//Note: this logic is just manually equivalent to the logic that
	//will be applied server-side, and is thus duplicated there.

	//Rate the cards that shouldn't actually be shown (that should be
	//filtered out) very low just to ensure they don't get tweeted.
	if (!card.published || !card.slugs || card.slugs.length === 0 || card.card_type !== 'content') {
		return [Number.MIN_SAFE_INTEGER, 'Not to be tweeted'];
	}

	const twiddlerMap = sectionTwiddlerMap(sections);

	//The baseValue is the more time that has passed since the last time it was tweeted. 
	const updatedSeconds = card.updated_substantive ? card.updated_substantive.seconds : 1000;
	const lastTweetedSeconds = card.last_tweeted ? card.last_tweeted.seconds : 0;
	let baseValue = updatedSeconds - lastTweetedSeconds;
	//Twiddle by section
	baseValue *= twiddlerMap.get(card.section) || 1.0;

	//Down-twiddle cards that have already been tweeted multiple times, with a
	//logrithmic folloff. Adding 1 verifies that we never get Infinity from log
	//of 0, and also that a single tweet has some effect.
	const tweetTwiddle = Math.log10(card.tweet_count + 1) / 3;
	//The larger tweetTwiddle, the smaller we want the thing to be. If it's
	//positive already, that means we want less than 1.0. If it's negative,
	//we want it to be MORE negative.
	if (baseValue < 0) {
		baseValue *= 1.0 + tweetTwiddle;
	} else {
		baseValue *= 1.0 - tweetTwiddle;
	}

	//Twiddle cards up that have stars. Doing star_count + 1 avoids Infinity for
	//a star_count of 0, and also starts giving a boost for the first star.
	const starTwiddle = Math.log10(card.star_count + 1) / 2;
	if (baseValue < 0) {
		baseValue *= 1.0 - starTwiddle;
	} else {
		baseValue *= 1.0 + starTwiddle;
	}

	//Twiddle up cards that were very, very recently updated, with a very strong
	//effect that falls off rapidly.
	const secondsInDay = 60 * 60 * 24;
	//Date.now() is in millis, updatedSeconds is in seconds;
	const secondsSinceUpdated = (Date.now() / 1000) - updatedSeconds;
	const daysSinceUpdated = secondsSinceUpdated / secondsInDay;
	//We want it to start at a 2x multiplier but go way down quickly as the
	//number of days that have passed get large.
	const veryRecentTwiddle = 2 / Math.pow(daysSinceUpdated, 1.4);
	if (baseValue < 0) {
		baseValue *= 1.0 - veryRecentTwiddle;
	} else {
		baseValue *= 1.0 + veryRecentTwiddle;
	}

	//Twiddler to penalize cards where more than 50% of outbound links are
	//unpublished, since there aren't many threads for people to pull on to dig
	//deeper.
	const outboundCardsPublished = card.links.map(id => allCards[id] ? allCards[id].published : false);
	const numOutboundLinksPublished = outboundCardsPublished.reduce((runningTotal, isPublished) => isPublished ? runningTotal + 1 : runningTotal, 0);
	const penalizeForLinkingToUnpublishedCards = outboundCardsPublished.length === 0 || numOutboundLinksPublished / outboundCardsPublished.length < 0.5;
	if (penalizeForLinkingToUnpublishedCards) {
		if (baseValue < 0) {
			baseValue *= 1.0 + UNPUBLISHED_LINKS_TWIDDLE_AMOUNT;
		} else {
			baseValue *= 1.0 - UNPUBLISHED_LINKS_TWIDDLE_AMOUNT;
		}
	}

	return [baseValue, baseValue];
};