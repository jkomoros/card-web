
import {
	db,
	prettyCardURL,
	DEV_MODE,
	TWITTER_ACCESS_TOKEN_KEY,
	TWITTER_ACCESS_TOKEN_SECRET,
	TWITTER_CONSUMER_KEY,
	TWITTER_CONSUMER_SECRET
} from './common.js';

import {
	FieldValue
} from 'firebase-admin/firestore';

import {
	fetchScreenshot
} from './screenshot.js';


import {
	Card,
	CardID,
	CardUpdate,
	Sections,
	TweetInfo,
	TweetInfoUpdate
} from './types.js';

import {
	tweetOrderExtractor
} from './tweet-helpers.js';

import Twitter from 'twitter';

import stable from 'stable';

type SortInfos = Map<CardID, [number, string]>;

//In DEV_MODE generally we don't actually send a tweet. but sometimes you need
//to test the actual tweet sending works, and in those cases you can flip this
//on temporarily, but don't commit!
const OVERRIDE_TWEET_IN_DEV_MODE = false;
//This number will be stored in tweetInfos, allowing us in the future to easily
//check the history of tweets for example if we change the message style we
//post.
const AUTO_TWEET_VERSION = 2;

//This is the max number of tweets to fetch engagement for, and should be set to
//at or below the limit in the twitter API.
const MAX_TWEETS_TO_FETCH = 100;

//If set to false, won't include a picture in generated tweets
const INCLUDE_PICTURE_IN_TWEET = true;

let twitterClient : Twitter | null = null;

if (!TWITTER_ACCESS_TOKEN_KEY || !TWITTER_CONSUMER_KEY || !TWITTER_ACCESS_TOKEN_SECRET || !TWITTER_CONSUMER_SECRET) {
	console.warn('The twitter keys are not configured, so tweets will not actually be sent. See README.md for how to set them up.');
} else {
	twitterClient = new Twitter({
		consumer_key: TWITTER_CONSUMER_KEY,
		consumer_secret: TWITTER_CONSUMER_SECRET,
		access_token_key: TWITTER_ACCESS_TOKEN_KEY,
		access_token_secret: TWITTER_ACCESS_TOKEN_SECRET
	});
}

//sendTweet sends the tweet and returns a tweet ID if the database shoould be
//marked that a tweet was sent.
const sendTweet = async (message : string, image : Buffer | null) : Promise<Twitter.ResponseData | null> => {
	if (DEV_MODE && !OVERRIDE_TWEET_IN_DEV_MODE) {
		console.log('Tweet that would have been sent if this weren\'t a dev project: ' + message);
		return {
			'id': 'FAKE_TWEET_ID_' + Math.floor(Math.random() * 10000000),
			'user_screen_name': 'FAUXTWEETUSER',
			'user_id': 'FAUXTWEETUSERID',
			'truncated': false,
			'supplied_text': message,
			'posted_text': message,
			'auto_tweet_version': AUTO_TWEET_VERSION,
			'media_expanded_url': '',
			'media_id': '',
			'media_url_https': '',
			'fake': true,
		};
	}
	if (!twitterClient) {
		console.log('Twitter client not set up. Tweet that would have been sent: ' + message);
		return null;
	}
	const tweetOptions : Twitter.RequestParams = {
		status: message, 
	};
	if (image) {
		const mediaResponse = await twitterClient.post('media/upload', {
			media: image,
			media_category: 'tweet_image',
		});
		tweetOptions.media_ids = mediaResponse.media_id_string;
	}

	let tweet;
	try {
		tweet = await twitterClient.post('statuses/update', tweetOptions);
	} catch(err) {
		console.error('Couldn\'t post to twitter', err);
		return null;
	}

	let media_expanded_url = '';
	let media_id = '';
	let media_url_https = '';
	if (tweet.entities && tweet.entities.media && tweet.entities.media.length) {
		const media = tweet.entities.media[0];
		media_expanded_url = media.expanded_url;
		media_id = media.id_str;
		media_url_https = media.media_url_https;
	}
	return {
		'id': tweet.id_str,
		'user_screen_name': tweet.user ? tweet.user.screen_name : '',
		'user_id': tweet.user ? tweet.user.id_str : '',
		'posted_text': tweet.text,
		'supplied_text': message,
		'truncated': tweet.truncated,
		'auto_tweet_version': AUTO_TWEET_VERSION,
		'media_expanded_url': media_expanded_url,
		'media_id': media_id,
		'media_url_https': media_url_https,
		'fake': false,
	};
};

const selectCardToTweet = async () => {
	//Tweet card selects a tweet to send and sends it.
	const rawCards = await db.collection('cards').where('published', '==', true).where('card_type', '==', 'content').get();
	const rawSections = await db.collection('sections').orderBy('order').get();

	const sectionsMap = Object.fromEntries(rawSections.docs.map(snapshot => [snapshot.id, snapshot.data()])) as Sections;
	const cardsMap = Object.fromEntries(rawCards.docs.map(snapshot => [snapshot.id, Object.assign({id: snapshot.id}, snapshot.data())])) as Record<CardID, Card>;

	//We want the order of cards to be the same as the default order in the
	//client so we see the same thing there. The last reduce step is equivalent
	//to flat(), but flat doesn't exist in node 8.
	const cardIDsInOrder = Object.entries(sectionsMap).map(entry => entry[1].cards).reduce((accum, val) => accum.concat(val), []);

	//Note: at this point cardIDsinOrder contains IDs for cards that aren't in
	//cardsMap because they aren't published or aren't of type content, so
	//werent' fetched.

	//Extract the full data for each card, stuff in the ID, and then remove
	//cards who do not have a valid slug set (and skip ones that were in the id
	//list but weren't fetched)
	const cards = cardIDsInOrder.map(id => cardsMap[id]).filter(card => card && card.name !== card.id);
    
	const sortInfos = new Map(cards.map(card => [card.id, tweetOrderExtractor(card, sectionsMap, cardsMap)])) as SortInfos;
    
	const sorter = (left : Card, right : Card) => {
		if(!left || !right) return 0;
		//Info is the underlying sort value, then the label value.
		const leftInfo = sortInfos.get(left.id);
		const rightInfo = sortInfos.get(right.id);
		if (!leftInfo || !rightInfo) return 0;
		return rightInfo[0] - leftInfo[0];
	};
	//array.sort is not stable in Node 8. All browsers in 2019 now have a stable
	//sort (https://v8.dev/features/stable-sort), but Node doesn't until version
	//11 (https://github.com/nodejs/node/pull/22754#issuecomment-419551068 ).
	const sortedCards = stable(cards, sorter);

	return selectCardToTweetFromSortedList(sortedCards, sortInfos);
};

//cards is a sorted list of expanded cards. sortInfos is a Map of card.id =>
//[sort-value, sort-value]
const selectCardToTweetFromSortedList = (cards : Card[], sortInfos : SortInfos) => {
	if (!cards || cards.length === 0) return null;

	//Collect all of the cards at the front that are the same sort value, so
	//equivalent.
	const firstEquivalenceClass : Card[] = [];
	const equivalentClassSortValue = (sortInfos.get(cards[0].id) || [0])[0];
	for (let i = 0; i < cards.length; i++) {
		const card = cards[i];
		if ((sortInfos.get(card.id) || [0])[0] !== equivalentClassSortValue) {
			break;
		}
		firstEquivalenceClass.push(card);
	}

	//Pick a random card from the equivalence list, so the tweet order has a bit
	//of spice and isn't just "tweet things in order".
	return firstEquivalenceClass[Math.floor(Math.random()*firstEquivalenceClass.length)];
};

const markCardTweeted = async (card : Card, tweetInfo : Twitter.ResponseData | null) => {

	//If the tweetInfo doesn't exist then a tweet didn't go out (or we shouldn't
	//even bother pretending one did).
	if (!tweetInfo) return;

	const cardRef = db.collection('cards').doc(card.id);
	const tweetRef = db.collection('tweets').doc(tweetInfo.id);

	const batch = db.batch();

	batch.update(cardRef, {
		tweet_count: FieldValue.increment(1),
		last_tweeted: FieldValue.serverTimestamp(),
	});

	const extendedTweetInfo = Object.assign({}, tweetInfo);
	extendedTweetInfo.created = FieldValue.serverTimestamp();
	extendedTweetInfo.card = card.id;
	extendedTweetInfo.archived = false;
	extendedTweetInfo.archive_date = new Date(0);
	extendedTweetInfo.retweet_count = 0;
	extendedTweetInfo.favorite_count = 0;
	//Last time we fetched and updated the retweet and favorite counts
	extendedTweetInfo.engagement_last_fetched = new Date(0);
	//Last time the retweet or favorite counts CHANGED from what we already had
	//stored.
	extendedTweetInfo.engagement_last_changed = new Date(0);

	batch.create(tweetRef, extendedTweetInfo);

	console.log('Card tweeted ' + card.id + ' ' + tweetInfo.id);

	await batch.commit();
};

export const fetchTweetEngagement = async() => {

	if (!twitterClient) {
		console.warn('Twitter client not configured, so cant\' fetch tweets');
		return;
	}

	const tweets = await db.collection('tweets').where('fake', '==', false).where('archived', '==', false).orderBy('engagement_last_fetched', 'asc').limit(MAX_TWEETS_TO_FETCH).get();
	const tweetIDs = tweets.docs.map(doc => doc.id);
	if (tweetIDs.length === 0) {
		console.log('No tweets to fetch');
		return;
	}

	//map means "for tweets that are deleted or invisible, return null in that spot instead of skipping"
	let tweetInfos = await twitterClient.get('statuses/lookup', {map: true, id: tweetIDs.join(',')});

	//Because map = true, the shape of tweetInfos, instead of being an array of
	//infos, is a map with a single key of 'id', which itself a map of id_str to
	//tweetInfoOrNull.
	if (!tweetInfos.id) {
		console.warn('We expected the tweetInfos API result to be a map with a key of "id" but it wasn\'t');
		return;
	}

	tweetInfos = tweetInfos.id;
	//tweetInfos is now a map of id_str to tweetInfoOrNull

	const transactionPromises : Promise<unknown>[] = [];

	for (const entry of Object.entries(tweetInfos)) {
		const tweetInfo = entry[1];
		const tweetID = entry[0];
		const tweetRef = db.collection('tweets').doc(tweetID);

		//Note: because we sent map:true to the twitter API, tweets that no
		//longer exist will be null tweetInfo. If that happens, archive them so
		//we don't continue trying to fetch them in the future.
		if (!tweetInfo) {
			console.log('Tweet ' + tweetID + ' appeared to have been deleted, marking as archived');
			transactionPromises.push(tweetRef.update({
				archived: true,
				archive_date: FieldValue.serverTimestamp(),
				engagement_last_fetched: FieldValue.serverTimestamp(),
			}));
			continue;
		}

		const retweet_count = tweetInfo.retweet_count;
		const favorite_count = tweetInfo.favorite_count;

		const transactionPromise = db.runTransaction(async transaction => {
			const tweetDoc = await transaction.get(tweetRef);
			if (!tweetDoc.exists) {
				throw new Error('Tweet with id ' + tweetID + ' not found in tweets collection');
			}

			const tweetDocUpdate : TweetInfoUpdate = {'engagement_last_fetched': FieldValue.serverTimestamp()};

			const tweetDocData = tweetDoc.data() as TweetInfo;

			if (retweet_count !== tweetDocData.retweet_count || favorite_count !== tweetDocData.favorite_count) {

				//Something has changed since we last fetched.
				tweetDocUpdate.engagement_last_changed = FieldValue.serverTimestamp();
				tweetDocUpdate.retweet_count = retweet_count;
				tweetDocUpdate.favorite_count = favorite_count;

				const cardID = tweetDocData.card;
				const cardRef = db.collection('cards').doc(cardID);
				const cardDoc = await transaction.get(cardRef);
				if (!cardDoc.exists) {
					throw new Error('Card with ID ' + cardID + ' doesn\'t exist!');
				}

				const cardUpdateDoc : CardUpdate = {};
				let starCountDiff = 0;

				if (retweet_count !== tweetDocData.retweet_count) {
					const retweetDiff = retweet_count - tweetDocData.retweet_count;
					starCountDiff += retweetDiff;
					cardUpdateDoc.tweet_retweet_count = FieldValue.increment(retweetDiff);
				}

				if (favorite_count !== tweetDocData.favorite_count) {
					const favoriteDiff = favorite_count - tweetDocData.favorite_count;
					starCountDiff += favoriteDiff;
					cardUpdateDoc.tweet_favorite_count = FieldValue.increment(favoriteDiff);
				}

				cardUpdateDoc.star_count = FieldValue.increment(starCountDiff);

				transaction.update(cardRef, cardUpdateDoc);
			}

			transaction.update(tweetRef, tweetDocUpdate);

		});
		transactionPromises.push(transactionPromise);
	}

	await Promise.all(transactionPromises);

};

export const tweetCard = async () => {
	const card = await selectCardToTweet();
	if (!card) throw new Error('No card');
	const url = prettyCardURL(card);
	const message = card.title + ' ' + url;
	let image : Buffer | null = null;
	if (INCLUDE_PICTURE_IN_TWEET) {
		image =  await fetchScreenshot(card);
	}
	const tweetInfo = await sendTweet(message, image);
	await markCardTweeted(card, tweetInfo);
};