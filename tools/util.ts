import {
	Config,
	FirebaseProdDevOptions
} from './types.js';

import fs from 'fs';
import { exec } from 'child_process';

import {
	FirebaseOptions
} from 'firebase/app';

const PROJECT_CONFIG = 'config.SECRET.json';

const runCommand = async (command : string) : Promise<string> => {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout.trim());
		});
	});
};

const selectedProjectID = async () : Promise<string> => {
	//Oddly enough firebase use I guess does something special for stderr and
	//stdout, because this just returns the direct project ID.
	const result = await runCommand('firebase use');
	return result;
};

export const getFirebaseConfig = async (config : Config) : Promise<FirebaseOptions> => {

	const {prod, dev} = devProdFirebaseConfig(config);

	//We have both prod and dev and need to select which one to use.
	const projectID = await selectedProjectID();
	if (prod?.projectId == projectID) return prod;
	if (dev?.projectId == projectID) return dev;
	throw new Error(`Neither prod nor dev options matched projectid ${projectID}`);
};

export const devProdFirebaseConfig = (config : Config) : Required<FirebaseProdDevOptions> => {
	if (!config.firebase) {
		throw new Error('No firebase property');
	}
	if ('apiKey' in config.firebase) {
		return {
			prod: config.firebase,
			dev: config.firebase,
			devConfigured: false
		};
	}
	const fb = config.firebase as FirebaseProdDevOptions;
	if (!fb.prod) throw new Error('No prod');
	const prod = fb.prod;
	const dev = fb.dev || prod;
	if (!prod && !dev) throw new Error('No sub configs provided');
	return {
		prod,
		dev,
		devConfigured: fb.dev != undefined
	};
};

export const getProjectConfig = () : Config => {

	if (!fs.existsSync(PROJECT_CONFIG)) {
		console.log(PROJECT_CONFIG + ' didn\'t exist. Check README.md on how to create one');
		throw new Error('No project config');
	}
	return JSON.parse(fs.readFileSync(PROJECT_CONFIG).toString()) as Config;
};