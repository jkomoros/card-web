/* eslint-disable no-undef */
//The purpose of this file is entirely to re-export the variables in
//config.secret.js so they can be imported via node modules in the cloud
//function.

//It shoudl not be necessary to modify this file. 

import {
	FIREBASE_DEV_CONFIG,
	FIREBASE_PROD_CONFIG
} from './config.SECRET.js';

exports.FIREBASE_DEV_CONFIG = FIREBASE_DEV_CONFIG;
exports.FIREBASE_PROD_CONFIG = FIREBASE_PROD_CONFIG;