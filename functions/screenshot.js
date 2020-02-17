const common = require('./common.js');
const puppeteer = require('puppeteer');
const md5 = require('md5');

//SCREENSHOT_VERSION should be incremented whenever the settings or generation
//logic changes, such that a fetch for an unchanged card should generate a new
//screenshot.
const SCREENSHOT_VERSION = 1;
const SCREENSHOT_WIDTH = 1390;
const SCREENSHOT_HEIGHT = 768;

const screenshotFileNameForCard = (card) => {
	//This logic should include any parts of the card that might change the
	//visual display of the card. The logic can change anytime the
	//SCREENSHOT_VERSION increments.

	const title = card.title || "";
	const subtitle = card.subtitle || "";
	const body = card.body || "";
	const hash = md5(title + ':' + subtitle + ':' + body);

	return 'v' + SCREENSHOT_VERSION + '/' + card.id + '/' + hash + '.png';
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
	console.log("Filename that would have been used for card: " + filename);
	//TODO: check cache and store result in cache
	return await makeScreenshot(card);
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