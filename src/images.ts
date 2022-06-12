import {
	ImageInfo,
	ImageBlock,
	CardLike,
	ImagePositionType,
	ImageInfoStringProperty,
	ImageInfoNumberProperty,
	ImageInfoImagePositionTypeProperty,
	ImageInfoProperty,
	ImageInfoPropertyValue
} from './types.js';

import {
	IMAGE_POSITION_TOP_LEFT,
	IMAGE_POSITION_TOP_RIGHT,
	IMAGE_POSITION_LEFT,
	IMAGE_POSITION_RIGHT
} from './type_constants.js';

import {
	TypedObject
} from './typed_object.js';

const DEFAULT_IMAGE_POSITION = IMAGE_POSITION_TOP_LEFT;

//A distinctive thing to stand in for "the image's margin value" when setting
//styles.
const MARGIN_SENTINEL = {
	__margin__: true,
};

type CSSPositionPropertyName = 'float' | 'clear' | 'marginRight' | 'marginBottom' | 'marginLeft';

type ImagePositionConfiguration = {
	[type in CSSPositionPropertyName]+?: string | typeof MARGIN_SENTINEL
}

//Each one is the style property/values to set on image eles with that value.
export const LEGAL_IMAGE_POSITIONS : {[type in ImagePositionType]: ImagePositionConfiguration} = {
	[IMAGE_POSITION_TOP_LEFT]: {
		float: 'left',
		marginRight: MARGIN_SENTINEL,
		marginBottom: MARGIN_SENTINEL,
	},
	[IMAGE_POSITION_LEFT]: {
		float: 'left',
		clear: 'left',
		marginRight: MARGIN_SENTINEL,
		marginBottom: MARGIN_SENTINEL,
	},
	[IMAGE_POSITION_TOP_RIGHT]: {
		float: 'right',
		marginLeft: MARGIN_SENTINEL,
		marginBottom: MARGIN_SENTINEL,
	},
	[IMAGE_POSITION_RIGHT]: {
		float: 'right',
		clear: 'right',
		marginLeft: MARGIN_SENTINEL,
		marginBottom: MARGIN_SENTINEL,
	},
};

export const DEFAULT_IMAGE : ImageInfo = {
	src: '',
	emSize: 15.0,
	margin: 1.0,
	width: undefined,
	height: undefined,
	position: DEFAULT_IMAGE_POSITION,
	uploadPath: '',
	original: '',
	alt: '',
};

export const setImageProperties = (img : ImageInfo, ele : HTMLImageElement) : void => {
	ele.src = img.src;
	ele.alt = img.alt || '';
	const styleInfo = LEGAL_IMAGE_POSITIONS[img.position] || {};
	for (let [property, value] of TypedObject.entries(styleInfo)) {
		//Tedhnically it's possible that value is not LITERALLY MARGIN_SENTINEL but that should be rare
		const finalValue : string = value == MARGIN_SENTINEL ? '' + img.margin + 'em' : value as string;
		ele.style[property] = finalValue;
	}
	if (img.width !== undefined) ele.width = img.width;
	if (img.height !== undefined) ele.height = img.height;
	if (img.emSize !== undefined) ele.style.width = '' + img.emSize + 'em';
};

//getImagesFromCard gets the images from a card, filling in every item as a default.
export const getImagesFromCard = (card : CardLike) : ImageBlock => {
	if (!card) return [];
	const images = card.images || [];
	//Just in case, worst case pretend like there aren't images
	if (!Array.isArray(images)) return [];
	return images.map(img => ({...DEFAULT_IMAGE, ...img}));
};

export const srcSeemsValid = (src : string) : boolean => {
	src = src.toLowerCase();
	if (src.startsWith('https://')) return true;
	if (src.startsWith('http://')) return true;
	return false;
};

type imageDimensions = {
	height : number,
	width : number,
}

export const getImageDimensionsForImageAtURL = async (url : string) : Promise<imageDimensions> => {
	const imgEle = document.createElement('img');
	imgEle.src = url;
	let p = new Promise<void>((resolve, reject) => {
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
export const addImageWithURL = (imagesBlock : ImageBlock, src : string, uploadPath = '', index : number) => {
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

export const moveImageAtIndex = (imagesBlock : ImageBlock, index : number, isRight : boolean) => {
	if (index < 0 || index >= imagesBlock.length) return imagesBlock;
	if (!isRight && index < 1) return imagesBlock;
	if (isRight && index > imagesBlock.length - 2) return imagesBlock;
	const result = [...imagesBlock];
	const ele = result.splice(index, 1)[0];
	const spliceIndex = isRight ? index + 1: index - 1;
	result.splice(spliceIndex, 0, ele);
	return result;
};

export const removeImageAtIndex = (imagesBlock : ImageBlock, index : number) => {
	const result = [];
	for (let i = 0; i < imagesBlock.length; i++) {
		if (i == index) continue;
		result.push(imagesBlock[i]);
	}
	return result;
};

const isImagePositionTypeProperty = (property : ImageInfoProperty): property is ImageInfoImagePositionTypeProperty => {
	return property == 'position';
}

const isStringTypeProperty = (property : ImageInfoProperty, value : ImageInfoPropertyValue): property is ImageInfoStringProperty => {
	return typeof value == 'string' && !isImagePositionTypeProperty(property);
}

export function changeImagePropertyAtIndex(imagesBlock : ImageBlock, index : number, property : ImageInfoStringProperty, value : string) : ImageBlock;
export function changeImagePropertyAtIndex(imagesBlock : ImageBlock, index : number, property : ImageInfoNumberProperty, value : number) : ImageBlock;
export function changeImagePropertyAtIndex(imagesBlock : ImageBlock, index : number, property : ImageInfoImagePositionTypeProperty, value : ImagePositionType) : ImageBlock;
export function changeImagePropertyAtIndex(imagesBlock : ImageBlock, index : number, property : ImageInfoProperty, value : ImageInfoPropertyValue) : ImageBlock {
	if (index < 0 || index >= imagesBlock.length) return imagesBlock;
	const result = [...imagesBlock];
	const item = {...result[index]};
	if (isImagePositionTypeProperty(property)) {
		item[property] = value as ImagePositionType;
	} else if (isStringTypeProperty(property, value)) {
		item[property] = value as string;
	} else if (typeof value == 'number') {
		item[property as ImageInfoNumberProperty] = value as number;
	}
	
	result[index] = item;
	return result;
};

export const imageBlocksEquivalent = (oneCard : CardLike, twoCard : CardLike) : boolean => {
	const one = getImagesFromCard(oneCard);
	const two = getImagesFromCard(twoCard);
	if (one.length != two.length) return false;
	for (let i = 0; i < one.length; i++) {
		const oneImg = one[i];
		const twoImg = two[i];
		if (Object.keys(oneImg).length != Object.keys(twoImg).length) return false;
		for (const imgKey of TypedObject.keys(oneImg)) {
			if (oneImg[imgKey] != twoImg[imgKey]) return false;
		}
	}
	return true;
};