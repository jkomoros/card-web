// These reference constants are now in shared/card-fields.ts
// Re-exporting here for backwards compatibility
import {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
} from '../shared/card-fields.js';

export {
	REFERENCES_INFO_CARD_PROPERTY,
	REFERENCES_INFO_INBOUND_CARD_PROPERTY,
	REFERENCES_CARD_PROPERTY,
	REFERENCES_INBOUND_CARD_PROPERTY
};

export const FIND_CARD_OPEN = 'FIND_CARD_OPEN';
export const FIND_CARD_TO_LINK = 'FIND_CARD_TO_LINK';
export const FIND_CARD_TO_REFERENCE = 'FIND_CARD_TO_REFERENCE';
export const FIND_CARD_TO_PERMISSION = 'FIND_CARD_TO_PERMISSION';

export const COLORS = {
	INDIAN_RED: '#CD5C5C',
	DARK_KHAKI: '#BDB76B',
	LIME_GREEN: '#32CD32',
	DARK_CYAN: '#008B8B',
	NAVY: '#000080',
	SANDY_BROWN: '#F4A460',
	GOLD: '#FFD700',
	DARK_MAGENTA: '#8B008B',
	ROYAL_BLUE: '#4169E1',
	//The following were not traditionally tag_colors.
	DARK_GREEN: '#006400',
	FIRE_BRICK: '#B22222'
	//TODO: 7f7f7f is also used in one location. Pop out?
} as const;

//Colors that are used for special purposes
export const COLOR_LIGHT_FIRE_BRICK = '#CC9494';