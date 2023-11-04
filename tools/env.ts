import fs from 'fs';
import path from 'path';

import {
	devProdConfig
} from './util.js';

import {
	ExpandedModeConfig
} from './types.js';

//The values of these are duplicated in functions/src/common.ts
const OPENAI_API_KEY_VAR = 'OPENAI_API_KEY';
const SITE_DOMAIN_VAR = 'SITE_DOMAIN';
const LAST_DEPLOY_AFFECTING_RENDERING_VAR = 'LAST_DEPLOY_AFFECTING_RENDERING';
const TWITTER_ACCESS_TOKEN_SECRET_VAR = 'TWITTER_ACCESS_TOKEN_SECRET';
const TWITTER_CONSUMER_SECRET_VAR = 'TWITTER_CONSUMER_SECRET';
const TWITTER_ACCESS_TOKEN_KEY_VAR = 'TWITTER_ACCESS_TOKEN_KEY';
const TWITTER_CONSUMER_KEY_VAR = 'TWITTER_CONSUMER_KEY';
const EMAIL_POSTMARK_KEY_VAR = 'EMAIL_POSTMARK_KEY';
const EMAIL_TO_ADDRESS_VAR = 'EMAIL_TO_ADDRESS';
const EMAIL_FROM_ADDRESS_VAR = 'EMAIL_FROM_ADDRESS';
const QDRANT_CLUSTER_URL_VAR = 'QDRANT_CLUSTER_URL';
const QDRANT_API_KEY_VAR = 'QDRANT_API_KEY';

const envLine = (key : string, val = '') : string => {
	//TODO: escape any " in val
	return `${key}="${val}"`;
};

const generateModeEnv = (config : ExpandedModeConfig) : void => {
	const projectID = config.firebase.projectId;
	if (!projectID) throw new Error('No project ID');

	const lines : string[] = [];

	lines.push(envLine(OPENAI_API_KEY_VAR, config.openai_api_key));
	lines.push(envLine(SITE_DOMAIN_VAR, config.site_domain));
	lines.push(envLine(LAST_DEPLOY_AFFECTING_RENDERING_VAR, config.last_deploy_affecting_rendering));
	lines.push(envLine(TWITTER_ACCESS_TOKEN_SECRET_VAR, config.twitter?.access_token_secret));
	lines.push(envLine(TWITTER_CONSUMER_SECRET_VAR, config.twitter?.consumer_secret));
	lines.push(envLine(TWITTER_ACCESS_TOKEN_KEY_VAR, config.twitter?.access_token_key));
	lines.push(envLine(TWITTER_CONSUMER_KEY_VAR, config.twitter?.consumer_key));
	lines.push(envLine(EMAIL_POSTMARK_KEY_VAR, config.email?.postmark_key));
	lines.push(envLine(EMAIL_TO_ADDRESS_VAR, config.email?.to_address));
	lines.push(envLine(EMAIL_FROM_ADDRESS_VAR, config.email?.from_address));
	lines.push(envLine(QDRANT_CLUSTER_URL_VAR, config.qdrant?.cluster_url));
	lines.push(envLine(QDRANT_API_KEY_VAR, config.qdrant?.api_key));

	const filePath = path.join('functions', '.env.' + projectID);
	fs.writeFileSync(filePath, lines.join('\n'));
};

const generateEnv = () : void => {

	const config = devProdConfig();
	if (config.devProvided) {
		generateModeEnv(config.dev);
	}
	generateModeEnv(config.prod);
};

(async() => {
	generateEnv();
})();