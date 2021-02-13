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