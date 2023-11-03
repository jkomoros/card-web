import {
	FirebaseOptions
} from 'firebase/app';

import {
	TabConfigInput,
	TabConfigOverrides,
	UserPermissionsCore
} from '../src/types_simple.js';

export type FirebaseProdDevOptions = {
	prod?: FirebaseOptions,
	dev?: FirebaseOptions,
	//Whether dev was passed explicitly
	devConfigured?: boolean
};

export type Config = {
	app_title : string;
	app_description : string;
	seo : boolean;
	google_analytics? : string;
	twitter_handle? : string;
	openai_api_key? : string;
	qdrant?: {
		cluster_url: string,
		api_key: string
	},
	disable_persistence? : boolean;
	disable_anonymous_login? : boolean;
	disable_service_worker? : boolean;
	disable_callable_cloud_functions? : boolean;
	tabs? : TabConfigInput;
	tab_overrides? : TabConfigOverrides;
	//TODO: type this more tightly
	region? : string;
	user_domain? : string;
	permissions? : {
		all? : UserPermissionsCore;
		anonymous? : UserPermissionsCore;
		signed_in? : UserPermissionsCore;
		signed_in_domain? : UserPermissionsCore;
	}
	firebase: FirebaseProdDevOptions | FirebaseOptions;
};