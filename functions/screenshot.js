const common = require('./common.js');
const puppeteer = require('puppeteer');
const md5 = require('md5');

//SCREENSHOT_VERSION should be incremented whenever the settings or generation
//logic changes, such that a fetch for an unchanged card should generate a new
//screenshot.
const SCREENSHOT_VERSION = 5;
const SCREENSHOT_WIDTH = 1330;
const SCREENSHOT_HEIGHT = 768;

//The default bucket is already configured, just use that
const screenshotBucket = common.storage.bucket();

const screenshotFileNameForCard = (card, cardLinkCards) => {
	//This logic should include any parts of the card that might change the
	//visual display of the card. The logic can change anytime the
	//SCREENSHOT_VERSION increments.

	const title = card.title || "";
	const subtitle = card.subtitle || "";
	const body = card.body || "";
	const starCount = String(card.star_count || 0);

	const publishedCardKeys = Object.keys(cardLinkCards).filter(key => cardLinkCards[key].published);
	publishedCardKeys.sort();

	const hash = md5(title + ':' + subtitle + ':' + body + ':' + starCount + ':' + publishedCardKeys.join('+'));

	//include the last prod deploy in the screenshot cache key because any time
	//prod is deployed, the card rendering might have changed. Note that this is
	//slightly in error because now we use the card renderer that is deployed
	//for this project, not just the prod rendrer as before.
	return 'screenshots/v' + SCREENSHOT_VERSION + '/' + common.LAST_DEPLOY_AFFECTING_RENDERING + '/' + card.id + '/' + hash + '.png';
}

const fetchScreenshotByIDOrSlug = async (idOrSlug) => {
	let card = await common.getCardByIDOrSlug(idOrSlug);
	if (!card) {
		console.warn("No such card: " + idOrSlug);
		return null;
	}
	return await fetchScreenshot(card);
}

const fetchScreenshot = async(card) =>{
	if (!card) {
		console.warn("No card provided");
		return null;
	}
	if (!card.published) {
		console.warn("The card wasn't published");
		return null;
	}
	const cardLinkCards = await common.getCardLinkCardsForCard(card);
	const filename = screenshotFileNameForCard(card, cardLinkCards);
	const file = screenshotBucket.file(filename);
	const existsResponse = await file.exists();
	if (existsResponse[0]) {
		//Screenshot exists, return it
		const downloadFileResponse = await file.download();
		return downloadFileResponse[0];
	}
	console.log("Screenshot " + filename + " didn't exist in storage, creating.");
	const screenshot = await makeScreenshot(card, cardLinkCards);
	await file.save(screenshot);
	return screenshot;
}

const makeScreenshot = async (card, cardLinkCards) => {
	const browser = await puppeteer.launch({
		defaultViewport: {
			width: SCREENSHOT_WIDTH,
			height: SCREENSHOT_HEIGHT
		},
		args: ['--no-sandbox'],
	});

	const page = await browser.newPage();
	//forward any console messages from the page to our own log
	page.on('console', e => {
		console.log("Page logged via console: " + e.text());
	})

	//Wait for networkidle0, otherwise bold fonts etc might not have finished
	//loading.
	await page.goto(common.urlForBasicCard(card.id), {
		waitUntil: 'networkidle0',
	});

	//Inject in the card directly, which should short-circuit the firebase fetch.
	//Disabling no-undef because that function is defined in the context of the page
	// eslint-disable-next-line no-undef
	await page.evaluate((card, cards) => injectFetchedCard(card, cards), card, cardLinkCards);

	//Wait for the signal that the card has been fetched and rendered
	await page.waitForFunction('window.' + common.WINDOW_CARD_RENDERED_VARIABLE);

	//Wait a little bit longer just for good measure, especially since the card
	//fades in as it loads in basic-card-viewer.
	await page.waitFor(1000);
	const png = await page.screenshot();
	await browser.close();
	return png;
}

exports.fetchScreenshotByIDOrSlug = fetchScreenshotByIDOrSlug;
exports.fetchScreenshot = fetchScreenshot;