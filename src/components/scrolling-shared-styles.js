import { html } from 'lit';

//Based on https://gist.github.com/IceCreamYou/cd517596e5847a88e2bb0a091da43fb4
const areScrollbarsVisible = () => {
	var scrollableElem = document.createElement('div');
	var innerElem = document.createElement('div');
	scrollableElem.style.width = '30px';
	scrollableElem.style.height = '30px';
	scrollableElem.style.overflow = 'scroll';
	scrollableElem.style.borderWidth = '0';
	innerElem.style.width = '30px';
	innerElem.style.height = '60px';
	scrollableElem.appendChild(innerElem);
	document.body.appendChild(scrollableElem); // Elements only have width if they're in the layout
	var diff = scrollableElem.offsetWidth - scrollableElem.clientWidth;
	document.body.removeChild(scrollableElem);
	return diff > 0;
};

const visibleScrollBars = html`
<style>

	.scroller {
		overflow: overlay;
	}

	.scroller::-webkit-scrollbar {
		-webkit-appearance: none;
		width: 7px;
	}

	.scroller::-webkit-scrollbar-track {
		background-color:transparent;
	}

	.scroller::-webkit-scrollbar-thumb {
		border-radius: 4px;
		background-color: transparent;
		-webkit-box-shadow: 0 0 1px rgba(255,255,255,.5);
		box-shadow:0 0 1px rgba(255,255,255,.5);
	}

	.scroller:hover::-webkit-scrollbar-thumb {
		background-color: rgba(0,0,0, 0.5);
	}
</style>
`;

const hiddenScrollBars = html`
<style>
	.scroller {
		overflow: overlay;
	}
</style>
`;

//On Macs, there might be overlay scrolling, or if the user has picked the
//Always system setting, or has a USB mouse plugged in wiht a scrollwheel, the
//scrollsbars will always show. If it's in a forced scrolling mode then we want
//to use our faux scrollbars (which have some visual tells like not animating
//opacity). But if it's not, then we want to just do normal scrollbars, and get
//the default system styling.
export const ScrollingSharedStyles = areScrollbarsVisible() ? visibleScrollBars : hiddenScrollBars;