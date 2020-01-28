//NOTE: this file is duplicated (modulo npm/ES6 module syntax for exports) in
///src/reducers/tweet-helpers.js. See #134 for de-duping

//This file is popped out separately so it can be linked into the webapp as well
//in reducers/collection.js

//cachedSectionTwidderMapForSections is the sections map we were last passed; if
//it's different then we should regenerate cachedSectionTwidderMap.
let cachedSectionTwidderMapForSections = null;
//The cached map to pass back out if cachedSectionTwidderMapForSections is the same as last time.
let cachedSectionTwiddlerMap = null;

const SECTION_TWIDDLE_AMOUNT = 0.15;

//date may be a firestore timestamp or a date object.
const prettyTime = (date) => {
	//Recreated from util.js so this file doesn't have any imports
	if (!date) return '';
	if (typeof date.toDate === 'function') date = date.toDate();
	return date.toDateString();
};

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

exports.tweetOrderExtractor = (card, sections) => {
	//Note: this logic is just manually equivalent to the logic that
	//will be applied server-side, and is thus duplicated there.

	//Rate the cards that shouldn't actually be shown (that should be
	//filtered out) very low just to ensure they don't get tweeted.
	if (!card.published || !card.slugs || card.slugs.length === 0 || card.card_type !== 'content') {
		return [0, 'Not to be tweeted'];
	}

	const twiddlerMap = sectionTwiddlerMap(sections);

	//The baseValue is the more time that has passed since the last time it was tweeted. 
	const updatedSeconds = card.updated_substantive ? card.updated_substantive.seconds : 1000;
	const lastTweetedSeconds = card.last_tweeted ? card.last_tweeted.seconds : 0;
	let baseValue = updatedSeconds - lastTweetedSeconds;
	//Twiddle by section
	baseValue *= twiddlerMap.get(card.section) || 1.0;
	//TODO: include a negative multiplier for how many times it's been tweeted already.
	//TODO: includ a positive multiplier for how many times it's been starred.
	return [baseValue, prettyTime(lastTweetedSeconds)];
};