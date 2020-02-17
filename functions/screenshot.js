const common = require('./common.js');

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

const makeScreenshot = async () => {
	console.warn("Not yet implemented");
	return null;
}

exports.fetchScreenshotByIDOrSlug = fetchScreenshotByIDOrSlug;
exports.fetchScreenshot = fetchScreenshot;