import fs from 'fs';
import path from 'path';

import {
	devProdConfig
} from './util.js';

import {
	ExpandedModeConfig
} from './types.js';

// Import shared constants instead of duplicating them
import {
	OPENAI_API_KEY_VAR,
	ANTHROPIC_API_KEY_VAR,
	SITE_DOMAIN_VAR,
	LAST_DEPLOY_AFFECTING_RENDERING_VAR,
	TWITTER_ACCESS_TOKEN_SECRET_VAR,
	TWITTER_CONSUMER_SECRET_VAR,
	TWITTER_ACCESS_TOKEN_KEY_VAR,
	TWITTER_CONSUMER_KEY_VAR,
	EMAIL_POSTMARK_KEY_VAR,
	EMAIL_TO_ADDRESS_VAR,
	EMAIL_FROM_ADDRESS_VAR,
	QDRANT_CLUSTER_URL_VAR,
	QDRANT_API_KEY_VAR
} from '../shared/env-constants.js';

const envLine = (key : string, val = '') : string => {
	//TODO: escape any " in val
	return `${key}="${val}"`;
};

const generateModeEnv = (config : ExpandedModeConfig) : void => {
	const projectID = config.firebase.projectId;
	if (!projectID) throw new Error('No project ID');

	const lines : string[] = [];

	lines.push(envLine(OPENAI_API_KEY_VAR, config.openai_api_key));
	lines.push(envLine(ANTHROPIC_API_KEY_VAR, config.anthropic_api_key));
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