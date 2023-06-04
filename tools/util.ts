import {
	Config,
	FirebaseProdDevOptions
} from './types.js';

import fs from 'fs';

const PROJECT_CONFIG = 'config.SECRET.json';

export const devProdFirebaseConfig = (config : Config) : Required<FirebaseProdDevOptions> => {
	if ('apiKey' in config.firebase) {
		return {prod: config.firebase, dev: config.firebase};
	}
	const fb = config.firebase as FirebaseProdDevOptions;
	if (!fb.prod) throw new Error('No prod');
	const prod = fb.prod;
	const dev = fb.dev || prod;
	return {prod, dev};
};

export const getProjectConfig = () : Config => {

	if (!fs.existsSync(PROJECT_CONFIG)) {
		console.log(PROJECT_CONFIG + ' didn\'t exist. Check README.md on how to create one');
		throw new Error('No project config');
	}
	return JSON.parse(fs.readFileSync(PROJECT_CONFIG).toString()) as Config;
};