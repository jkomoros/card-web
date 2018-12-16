
var PRESENTATION_URL = "https://docs.google.com/presentation/d/196n9NQEGJmdVxsShE3b8dBz8UUIee4oC7e8SC193HcQ/present"


function fallbackRedirect() {
	redirectToSlides("id.p");	
}

function redirectToSlides(slideId) {
	window.location.href = PRESENTATION_URL + "#slide=" + slideId;
}

function main() {
	fallbackRedirect();
}

main();

