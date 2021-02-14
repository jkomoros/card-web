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
		original: 'https://www.example.com/image.png'
	}
	//Other images may follow
]

*/

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

export const DEFAULT_IMG_EM_SIZE = 15.0;

//Returns a new images block with the given image added. If index is undefined,
//will add a new item to end.z
export const addImageWithURL = (imagesBlock, src, uploadPath = '', index) => {
	if (!imagesBlock) imagesBlock = [];
	let result = [...imagesBlock];
	if (index === undefined) {
		result.push({
			emSize: DEFAULT_IMG_EM_SIZE,
		});
		index = result.length - 1;
	}
	const imgItem = {...result[index]};
	imgItem.src = src;
	imgItem.uploadPath = uploadPath;
	result[index] = imgItem;
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

export const imageBlocksEquivalent = (one, two) => {
	if (one == two) return true;
	if (!one || !two) return false;
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