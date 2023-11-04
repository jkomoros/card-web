import {
	FirebaseOptions
} from 'firebase/app';

import {
	TabConfigInput,
	TabConfigOverrides,
	UserPermissionsCore
} from '../src/types_simple.js';

export type ExpandedConfig = {
	dev: ExpandedModeConfig,
	prod: ExpandedModeConfig,
	devProvided : boolean
};

export type ModeConfig = {
	app_title : string;
	app_description : string;
	//The domain where this webapp resides. Currently not used very broadly.
	site_domain? : string;
	seo : boolean;
	google_analytics? : string;
	disable_twitter? : boolean;
	twitter_handle? : string;
	openai_api_key? : string;
	qdrant?: {
		cluster_url: string,
		api_key: string
	},
	email?: {
		postmark_key: string,
		to_address: string,
		from_address: string
	},
	twitter? : {
		access_token_key: string,
		consumer_key: string,
		access_token_secret: string,
		consumer_secret: string
	},
	backup_bucket_name? : string,
	tag_releases? : boolean;
	disable_persistence? : boolean;
	disable_anonymous_login? : boolean;
	disable_service_worker? : boolean;
	disable_callable_cloud_functions? : boolean;
	tabs? : TabConfigInput;
	tab_overrides? : TabConfigOverrides;
	//TODO: type this more tightly
	region? : string;
	//The domain of users that should be considered in signed_in_domain.
	user_domain? : string;
	permissions? : {
		all? : UserPermissionsCore;
		anonymous? : UserPermissionsCore;
		signed_in? : UserPermissionsCore;
		signed_in_domain? : UserPermissionsCore;
	}
	firebase: FirebaseOptions;
};

export type ExpandedModeConfig = ModeConfig & {
	//The dev config will have is_dev:true, and the prod one will not
	is_dev: boolean
};

//When this changes, run `npm run generate:schema`
export type Config = {
	base: ModeConfig,
	prod? : ModeConfig,
	dev? : ModeConfig
};