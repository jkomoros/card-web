//card.images is an imagesBlock. It has the following shape:
/*
[
	{
		//Must always be set to a fully resolved url
		src: 'https://www.example.com/image.png',
		//Natural height and width in pixels
		height: 10,
		width: 100,
		//Size, in ems, for the width of the image as rendered. (The height will maintain aspect ratio)
		emSize: 10.0,
		//If the file is an uload, the path in the upload bucket. This is usef
		uploadPath: 'path/to/upload/image.png',
		//If set, the location where the original was found, for citations, etc.
		original: 'https://www.example.com/image.png',
		alt: 'Text that shows up in alt tag',
		//Must be one of the values in LEGAL_IMAGE_POSITIONS
		position: 'top-left',
	}
	//Other images may follow
]

*/

const IMAGE_POSITION_TOP_LEFT = 'top-left';
const IMAGE_POSITION_TOP_RIGHT = 'top-right';

const DEFAULT_IMAGE_POSITION = IMAGE_POSITION_TOP_LEFT;

//Each one is the style property/values to set on image eles with that value.
export const LEGAL_IMAGE_POSITIONS = {
	[IMAGE_POSITION_TOP_LEFT]: {
		float: 'left'
	},
	[IMAGE_POSITION_TOP_RIGHT]: {
		float: 'right'
	},
};

const DEFAULT_IMAGE = {
	src: '',
	emSize: 15.0,
	width: undefined,
	height: undefined,
	position: DEFAULT_IMAGE_POSITION,
	uploadPath: '',
	original: '',
	alt: '',
};

//getImagesFromCard gets the images from a card, filling in every item as a default.
export const getImagesFromCard = (card) => {
	if (!card) return [];
	const images = card.images || [];
	//Just in case, worst case pretend like there aren't images
	if (!Array.isArray(images)) return [];
	return images.map(img => ({...DEFAULT_IMAGE, ...img}));
};

export const srcSeemsValid = (src) => {
	src = src.toLowerCase();
	if (src.startsWith('https://')) return true;
	if (src.startsWith('http://')) return true;
	return false;
};

export const getImageDimensionsForImageAtURL = async (url) => {
	const imgEle = document.createElement('img');
	imgEle.src = url;
	let p = new Promise((resolve, reject) => {
		imgEle.addEventListener('load', () => {
			resolve();
		});
		imgEle.addEventListener('error', () => {
			reject();
		});
	});
	imgEle.style.display = 'none';
	document.body.append(imgEle);
	try {
		await p;
	} catch(err) {
		console.warn(err);
		return null;
	}
	const result = {
		height: imgEle.naturalHeight,
		width: imgEle.naturalWidth
	};
	imgEle.remove();
	return result;
};

//Returns a new images block with the given image added. If index is undefined,
//will add a new item to end.z
export const addImageWithURL = (imagesBlock, src, uploadPath = '', index) => {
	if (!imagesBlock) imagesBlock = [];
	let result = [...imagesBlock];
	if (index === undefined) {
		result.push({...DEFAULT_IMAGE});
		index = result.length - 1;
	}
	const imgItem = {...result[index]};
	imgItem.src = src;
	imgItem.uploadPath = uploadPath;
	result[index] = imgItem;
	return result;
};

export const moveImageAtIndex = (imagesBlock, index, isRight) => {
	if (index < 0 || index >= imagesBlock.length) return imagesBlock;
	if (!isRight && index < 1) return imagesBlock;
	if (isRight && index > imagesBlock.length - 2) return imagesBlock;
	const result = [...imagesBlock];
	const ele = result.splice(index, 1)[0];
	const spliceIndex = isRight ? index + 1: index - 1;
	result.splice(spliceIndex, 0, ele);
	return result;
};

export const removeImageAtIndex = (imagesBlock, index) => {
	const result = [];
	for (let i = 0; i < imagesBlock.length; i++) {
		if (i == index) continue;
		result.push(imagesBlock[i]);
	}
	return result;
};

export const changeImagePropertyAtIndex = (imagesBlock, index, property, value) => {
	if (index < 0 || index >= imagesBlock.length) return imagesBlock;
	const result = [...imagesBlock];
	const item = {...result[index]};
	item[property] = value;
	result[index] = item;
	return result;
};

export const imageBlocksEquivalent = (oneCard, twoCard) => {
	const one = getImagesFromCard(oneCard);
	const two = getImagesFromCard(twoCard);
	if (one.length != two.length) return false;
	for (let i = 0; i < one.length; i++) {
		const oneImg = one[i];
		const twoImg = two[i];
		if (Object.keys(oneImg).length != Object.keys(twoImg).length) return false;
		for (const imgKey of Object.keys(oneImg)) {
			if (oneImg[imgKey] != twoImg[imgKey]) return false;
		}
	}
	return true;
};