import {
	BULK_IMPORT_DIALOG_CLOSE,
	BULK_IMPORT_DIALOG_OPEN,
	BULK_IMPORT_SET_BODIES,
	SomeAction
} from '../actions.js';

export const openBulkImportDialog = () : SomeAction => ({
	type : BULK_IMPORT_DIALOG_OPEN,
});

export const closeBulkImportDialog = () : SomeAction =>  ({
	type: BULK_IMPORT_DIALOG_CLOSE
});

const extractTopLevelULs = (ele : HTMLElement) : HTMLUListElement[] => {
	const result : HTMLUListElement[] = [];
	for (const child of ele.children) {
		if (child.tagName === 'UL') {
			result.push(child as HTMLUListElement);
			continue;
		}
		if (child.children.length && child instanceof HTMLElement) {
			result.push(...extractTopLevelULs(child));
		}
	}
	return result;
};

const processUL = (ul : HTMLUListElement) : string => {
	//TODO: process and simplify
	return ul.innerHTML;
};

const extractBodies = (content : string) : string[] => {
	const ele = document.createElement('div');
	ele.innerHTML = content;
	const uls = extractTopLevelULs(ele);
	return uls.map(processUL);
};

export const processBulkImportContent = (content : string) : SomeAction => {
	const bodies = extractBodies(content);
	return {
		type: BULK_IMPORT_SET_BODIES,
		bodies
	};
};