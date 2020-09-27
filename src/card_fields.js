
export const TEXT_FIELD_BODY = 'body';
export const TEXT_FIELD_TITLE = 'title';
export const TEXT_FIELD_SUBTITLE = 'subtitle';

export const TEXT_FIELD_CONFIGURATION = {
	[TEXT_FIELD_BODY]: {
		html: true,
		container: 'section',
	},
	[TEXT_FIELD_TITLE]: {
		html: false,
		container: 'h1',
	},
	[TEXT_FIELD_SUBTITLE]: {
		html: false,
		container: 'h2',
	}
};