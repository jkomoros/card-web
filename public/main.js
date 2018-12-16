
var PRESENTATION_URL = "https://docs.google.com/presentation/d/196n9NQEGJmdVxsShE3b8dBz8UUIee4oC7e8SC193HcQ/present"

var DEBUG_MODE = true;

var SLIDE_DATA = null;

function slugToId(slug) {
	if (!SLIDE_DATA) return slug;
	var index = SLIDE_DATA['slug_index'];
	if (!index) return slug;
	var newVal = index[slug];
	return newVal ? newVal : slug;
}

function redirectToSlides(slideId) {
	if (!slideId) slideId = "id.p";
	slideId = slugToId(slideId);
	//If it's debug mode, then only navigate if they confirm
	if (!DEBUG_MODE || confirm(slideId)) window.location.href = PRESENTATION_URL + "#slide=" + slideId;
}

function extractSlideSlug() {

	var result = ["", false];

	var path = window.location.pathname;
	//Remove "/" from front
	path = path.substring(1);
	var pieces = path.split("/");
	if (!pieces) return result;
	if (pieces[0] == "s") result[0] = pieces[1];
	if (pieces.length > 2) {
		var warnPiece = pieces[2];
		if (warnPiece && warnPiece.substring(0, 1) == "w") result[1] = true;
	}
	return result;
}

function fallbackRedirect(e) {
	console.log(e);
	redirectToSlides();
}

function main() {
	
	if (!window.fetch) {
		fallbackRedirect();
		return;
	}

	fetch("/slides.json").then(function(resp) {
		resp.json().then(
			function(json) {
				SLIDE_DATA = json;
				var result = extractSlideSlug();
				console.log(result);
				redirectToSlides(result[0]);
			}
		)
	}).catch(
		fallbackRedirect
	)

}

main();

