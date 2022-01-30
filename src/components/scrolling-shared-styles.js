import { html } from '@polymer/lit-element';

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

export const ScrollingSharedStyles = areScrollbarsVisible() ? visibleScrollBars : hiddenScrollBars;