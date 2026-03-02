import fs from 'fs';

import {
	CONFIG_EXTRA_FILE,
	selectedProjectID,
} from './util.js';

interface ExtraConfig {
	[key: string]: {
		last_deploy_affecting_rendering?: string;
		[otherKey: string]: unknown;
	};
}

export const setLastDeployConfig = async (releaseTag: string, devProjectId: string): Promise<void> => {
	const projectID = await selectedProjectID();
	const isDev = projectID === devProjectId;

	const data = fs.existsSync(CONFIG_EXTRA_FILE) ? fs.readFileSync(CONFIG_EXTRA_FILE).toString() : '{}';
	const result: ExtraConfig = JSON.parse(data) as ExtraConfig;
	const key = isDev ? 'dev' : 'prod';
	const subObj = result[key] || {};
	subObj.last_deploy_affecting_rendering = releaseTag;
	result[key] = subObj;
	fs.writeFileSync(CONFIG_EXTRA_FILE, JSON.stringify(result, null, '\t'));
};
