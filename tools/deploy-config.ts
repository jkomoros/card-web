import fs from 'fs';

import {
	CONFIG_EXTRA_FILE,
	selectedProjectID,
	devProdConfig,
} from './util.js';

export const setLastDeployConfig = async (releaseTag: string): Promise<void> => {
	const projectID = await selectedProjectID();
	const { dev } = devProdConfig();
	const isDev = projectID === dev.firebase.projectId;

	const data = fs.existsSync(CONFIG_EXTRA_FILE) ? fs.readFileSync(CONFIG_EXTRA_FILE).toString() : '{}';
	const result = JSON.parse(data);
	const key = isDev ? 'dev' : 'prod';
	const subObj = result[key] || {};
	subObj.last_deploy_affecting_rendering = releaseTag;
	result[key] = subObj;
	fs.writeFileSync(CONFIG_EXTRA_FILE, JSON.stringify(result, null, '\t'));
};
