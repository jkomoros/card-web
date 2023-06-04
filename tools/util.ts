import {
	Config
} from './types.js';

import fs from 'fs';

const PROJECT_CONFIG = 'config.SECRET.json';

export const getProjectConfig = () : Config => {

	if (!fs.existsSync(PROJECT_CONFIG)) {
		console.log(PROJECT_CONFIG + ' didn\'t exist. Check README.md on how to create one');
		throw new Error('No project config');
	}
	return JSON.parse(fs.readFileSync(PROJECT_CONFIG).toString()) as Config;
};