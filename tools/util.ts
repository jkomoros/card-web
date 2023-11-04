import {
	Config,
	ExpandedConfig,
	ModeConfig
} from './types.js';

import fs from 'fs';
import { exec } from 'child_process';

const PROJECT_CONFIG = 'config.SECRET.json';

//Also in gulpfile and functsions/src/common.ts
const CHANGE_ME_SENTINEL = 'CHANGE-ME';

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

export const selectedProjectID = async () : Promise<string> => {
	//Oddly enough firebase use I guess does something special for stderr and
	//stdout, because this just returns the direct project ID.
	const result = await runCommand('firebase use');
	return result;
};

export const getActiveConfig = async () : Promise<ModeConfig> => {

	const {prod, dev} = devProdConfig();

	//We have both prod and dev and need to select which one to use.
	const projectID = await selectedProjectID();
	if (prod.firebase.projectId == projectID) return prod;
	if (dev.firebase.projectId == projectID) return dev;
	throw new Error(`Neither prod nor dev options matched projectid ${projectID}`);
};

const replaceChangeMe = (obj : AnyObject) : AnyObject => {
	const result = {...obj};
	for (const key of Object.keys(obj)) {
		const val = obj[key];
		if (typeof val == 'object' && val) {
			result[key] = val;
		} else if(typeof val == 'string' && val == CHANGE_ME_SENTINEL) {
			result[key] = '';
		}
	}
	return result;
};

export const devProdConfig = () : ExpandedConfig => {
	const config = getProjectConfig();

	const rawBase = replaceChangeMe(config.base) as ModeConfig;
	const rawProd = replaceChangeMe(config.prod || {}) as ModeConfig;
	const rawDev = replaceChangeMe(config.dev || {}) as ModeConfig;

	const prod = deepMerge(rawBase, rawProd) as ModeConfig;
	const dev = deepMerge(rawBase, rawDev) as ModeConfig;
	const devProvided = config.dev !== undefined;
	return {
		prod: {...prod, is_dev: false},
		dev: {...dev, is_dev: true},
		devProvided
	};
};

type AnyObject = { [key: string]: unknown };

const deepMerge = (base: AnyObject, overlay: AnyObject): AnyObject => {
	const result: AnyObject = { ...base };

	for (const key in overlay) {
		if (
			typeof overlay[key] === 'object' &&
			!Array.isArray(overlay[key]) &&
			overlay[key] !== null &&
			base[key] &&
			typeof base[key] === 'object'
		) {
			result[key] = deepMerge(base[key] as AnyObject, overlay[key] as AnyObject);
		} else {
			result[key] = overlay[key];
		}
	}
	return result;
};

const getProjectConfig = () : Config => {

	if (!fs.existsSync(PROJECT_CONFIG)) {
		console.log(PROJECT_CONFIG + ' didn\'t exist. Check README.md on how to create one');
		throw new Error('No project config');
	}
	return JSON.parse(fs.readFileSync(PROJECT_CONFIG).toString()) as Config;
};