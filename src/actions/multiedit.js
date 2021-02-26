export const MULTI_EDIT_DIALOG_OPEN = 'MULTI_EDIT_DIALOG_OPEN';
export const MULTI_EDIT_DIALOG_CLOSE ='MULTI_EDIT_DIALOG_CLOSE';

export const openMultiEditDialog = () => {
	return {
		type: MULTI_EDIT_DIALOG_OPEN
	};
};

export const closeMultiEditDialog = () => {
	return {
		type: MULTI_EDIT_DIALOG_CLOSE
	};
};