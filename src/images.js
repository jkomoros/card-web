//card.images is an imagesBlock. It has the following shape:
/*
{
	//May be any valid field name
	body: [
		{
			//Must always be set to a fully resolved url
			src: 'https://www.example.com/image.png',
			//Natural height and width in pixels
			height: 10,
			width: 100,
			//If the file is an uload, the path in the upload bucket. This is usef
			uploadPath: 'path/to/upload/image.png',
		}
		//Other images may follow
	]
}

*/

//Returns a new images block with the given image added
export const addImageWithURL = (imagesBlock, fieldName, src, uploadPath = '') => {
	if (!imagesBlock) imagesBlock = {};
	const result = {...imagesBlock};
	const existingFieldNameBlock = result[fieldName] || [];
	const imgItem = {
		src,
		uploadPath
	};
	result[fieldName] = [...existingFieldNameBlock, imgItem];
	return result;
};

export const imageBlocksEquivalent = (one, two) => {
	if (one == two) return true;
	if (!one || !two) return false;
	if (Object.keys(one).length != Object.keys(two).length) return false;
	for (const key of Object.keys(one)) {
		const oneImgs = one[key];
		const twoImgs = two[key];
		if (oneImgs.length != twoImgs.length) return false;
		for (let i = 0; i < oneImgs.length; i++) {
			const oneImg = oneImgs[i];
			const twoImg = twoImgs[i];
			if (Object.keys(oneImg).length != Object.keys(twoImg).length) return false;
			for (const imgKey of Object.keys(oneImg)) {
				if (oneImg[imgKey] != twoImg[imgKey]) return false;
			}
		}
	}
	return true;
};