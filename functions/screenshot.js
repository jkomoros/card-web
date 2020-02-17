const common = require('./common.js');
const puppeteer = require('puppeteer');
const md5 = require('md5');

//SCREENSHOT_VERSION should be incremented whenever the settings or generation
//logic changes, such that a fetch for an unchanged card should generate a new
//screenshot.
const SCREENSHOT_VERSION = 3;
const SCREENSHOT_WIDTH = 1330;
const SCREENSHOT_HEIGHT = 768;

//The default bucket is already configured, just use that
const screenshotBucket = common.storage.bucket();

const screenshotFileNameForCard = (card) => {
	//This logic should include any parts of the card that might change the
	//visual display of the card. The logic can change anytime the
	//SCREENSHOT_VERSION increments.

	const title = card.title || "";
	const subtitle = card.subtitle || "";
	const body = card.body || "";
	const starCount = String(card.star_count || 0);
	const hash = md5(title + ':' + subtitle + ':' + body + ':' + starCount);

	//include the last prod deploy in the screenshot cache key because any time
	//prod is deployed, the card rendering might have changed (and we use prod
	//card rendering in both dev and prod cases because of the domain we have
	//puppeteer fetch)
	return 'screenshots/v' + SCREENSHOT_VERSION + '/' + common.LAST_PROD_DEPLOY + '/' + card.id + '/' + hash + '.png';
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
	const filename = screenshotFileNameForCard(card);
	const file = screenshotBucket.file(filename);
	const existsResponse = await file.exists();
	if (existsResponse[0]) {
		//Screenshot exists, return it
		const downloadFileResponse = await file.download();
		return downloadFileResponse[0];
	}
	console.log("Screenshot " + filename + " didn't exist in storage, creating.");
	const screenshot = await makeScreenshot(card);
	await file.save(screenshot);
	return screenshot;
}

const makeScreenshot = async (card) => {
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
	await page.goto(common.urlForBasicCard(card.id),{
		waitUntil: 'networkidle0'
	});
	//Wait for a long time until the firebase response is likely received.
	//TODO: make this not just a race
	await page.waitFor(15000);
	const png = await page.screenshot();
	await browser.close();
	return png;
}

exports.fetchScreenshotByIDOrSlug = fetchScreenshotByIDOrSlug;
exports.fetchScreenshot = fetchScreenshot;