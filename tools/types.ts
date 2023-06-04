import {
	FirebaseOptions
} from 'firebase/app';

export type FirebaseProdDevOptions = {
	prod?: FirebaseOptions,
	dev?: FirebaseOptions
};

export type Config = {
	app_title : string;
	app_description : string;
	seo : boolean;
	firebase: FirebaseProdDevOptions | FirebaseOptions;
};