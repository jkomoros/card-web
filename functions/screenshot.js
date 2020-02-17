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
	await page.goto(common.urlForBasicCard(card.id),{
		waitUntil: 'networkidle0'
	});
	const png = await page.screenshot();
	await browser.close();
	return png;
}

exports.fetchScreenshotByIDOrSlug = fetchScreenshotByIDOrSlug;
exports.fetchScreenshot = fetchScreenshot;