
var PRESENTATION_URL = "https://docs.google.com/presentation/d/196n9NQEGJmdVxsShE3b8dBz8UUIee4oC7e8SC193HcQ/present"


function fallbackRedirect() {

}

function redirectToSlides(slideId) {
	if (!slideId) slideId = "id.p";
	window.location.href = PRESENTATION_URL + "#slide=" + slideId;
}

function extractSlideSlug() {
	return "";
}

function main() {
	
	var slug = extractSlideSlug();
	redirectToSlides(slug);
}

main();

