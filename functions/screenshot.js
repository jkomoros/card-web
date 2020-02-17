const common = require('./common.js');
const puppeteer = require('puppeteer');

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
	//TODO: check cache and store result in cache
	return await makeScreenshot(card);
}

const makeScreenshot = async (card) => {
	const browser = await puppeteer.launch({
		defaultViewport: {
			width: 1390,
			height: 768
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