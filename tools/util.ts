import {
	Config,
	ExpandedConfig,
	ModeConfig
} from './types.js';

import fs from 'fs';
import { exec, spawnSync, spawn } from 'child_process';

//Overridable so CI can generate from the checked-in config.SAMPLE.json. The
//real config.SECRET.json is gitignored, and ~14 modules import the file this
//generates — so without an override a clean checkout cannot even typecheck,
//which made the CI workflow decorative: every run died at the build step.
//
//An env var rather than `cp config.SAMPLE.json config.SECRET.json` in the
//workflow, because that copy is a destructive footgun the moment anyone runs
//the CI steps locally over their real credentials.
const PROJECT_CONFIG = process.env.CARD_WEB_CONFIG_FILE || 'config.SECRET.json';
export const CONFIG_EXTRA_FILE = 'config.EXTRA.json';

export const CHANGE_ME_SENTINEL = 'CHANGE-ME';

export const verifyPermissionsLegal = (permissions: object) : void => {
	for (const [key, val] of Object.entries(permissions)) {
		if (key == 'admin') {
			throw new Error('Permissions objects may not list admin privileges for all users of a given type; it must be on the user object in firestore directly');
		}
		if (!val) {
			throw new Error('Permissions objects may only contain true keys');
		}
	}
};

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

	const extraFile = fs.existsSync(CONFIG_EXTRA_FILE) ? fs.readFileSync(CONFIG_EXTRA_FILE).toString() : '{}';
	const mainFile = fs.readFileSync(PROJECT_CONFIG).toString();

	const main = JSON.parse(mainFile) as Config;
	const extra = JSON.parse(extraFile) as Config;

	return deepMerge(extra, main) as Config;
};

export const runSync = (cmd: string, args: string[]): void => {
	console.log('Running ' + cmd + ' ' + args.join(' '));
	const result = spawnSync(cmd, args, { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.signal) throw new Error(`Command killed by signal ${result.signal}`);
	if (result.status !== 0) throw new Error(`Command failed with exit code ${result.status}`);
};

export const runBackground = (cmd: string, args: string[]): void => {
	const child = spawn(cmd, args, {
		stdio: 'ignore',
		detached: true
	});
	child.unref();
};