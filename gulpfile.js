/*eslint-env node*/

import gulp from 'gulp';
import { spawnSync, exec, spawn } from 'child_process';
import prompts from 'prompts';
import fs from 'fs';
import process from 'process';
import {QdrantClient} from '@qdrant/js-client-rest';

import {
	devProdConfig,
	selectedProjectID,
} from './tools/util.js';

let config;
try {
	config = devProdConfig();
} catch(err) {
	console.log('config.SECRET.json didn\'t exist. Check README.md on how to create one');
	process.exit(1);
}

const projectConfig = config.prod;
const devProjectConfig = config.dev;

const CONFIG_FIREBASE_PROD = projectConfig.firebase;
const CONFIG_FIREBASE_DEV = devProjectConfig.firebase;
const CONFIG_INCLUDES_DEV = config.devProvided;

const REGION = projectConfig.region || 'us-central1';

//Duplicated from `functions/src/embedding.ts`;
const EMBEDDING_TYPES = {
	'openai.com-text-embedding-ada-002': {
		length: 1536,
		provider: 'openai.com',
		model: 'text-embedding-ada-002'
	}
};

const DEFAULT_EMBEDDING_TYPE = 'openai.com-text-embedding-ada-002';
const DEFAULT_EMBEDDING_TYPE_INFO = EMBEDDING_TYPES[DEFAULT_EMBEDDING_TYPE];
const PAYLOAD_CARD_ID_KEY = 'card_id';
const PAYLOAD_VERSION_KEY = 'extraction_version';
const QDRANT_BASE_COLLECTION_NAME = DEFAULT_EMBEDDING_TYPE;
const QDRANT_DEV_COLLECTION_NAME = 'dev-' + QDRANT_BASE_COLLECTION_NAME;
const QDRANT_PROD_COLLECTION_NAME = 'prod-' + QDRANT_BASE_COLLECTION_NAME;

//Also in tools/util.ts
const CHANGE_ME_SENTINEL = 'CHANGE-ME';

//Also in tools/util.ts, for some reason it doesn't want to import it
const CONFIG_EXTRA_FILE = 'config.EXTRA.json';

const FIREBASE_PROD_PROJECT = CONFIG_FIREBASE_PROD.projectId;
const FIREBASE_DEV_PROJECT = CONFIG_FIREBASE_DEV.projectId;

const BACKUP_BUCKET_NAME = projectConfig.backup_bucket_name && projectConfig.backup_bucket_name != CHANGE_ME_SENTINEL ? projectConfig.backup_bucket_name : ''; 

const APP_TITLE = projectConfig.app_title ? projectConfig.app_title : 'Cards Web';

const TWITTER_HANDLE = projectConfig.twitter_handle && projectConfig.twitter_handle != CHANGE_ME_SENTINEL ? projectConfig.twitter_handle : '';
const DISABLE_TWITTER = projectConfig.disable_twitter || false;
const ENABLE_TWITTER = TWITTER_HANDLE && !DISABLE_TWITTER;

const OPENAI_API_KEY = projectConfig.openai_api_key || '';
const OPENAI_ENABLED = OPENAI_API_KEY != '';

const QDRANT_INFO = projectConfig.qdrant || {};
const QDRANT_CLUSTER_URL = QDRANT_INFO.cluster_url && QDRANT_INFO.cluster_url != CHANGE_ME_SENTINEL ? QDRANT_INFO.cluster_url : '';
const QDRANT_API_KEY = QDRANT_INFO.api_key && QDRANT_INFO.api_key != CHANGE_ME_SENTINEL ? QDRANT_INFO.api_key : '';
const QDRANT_ENABLED = OPENAI_ENABLED && QDRANT_CLUSTER_URL && QDRANT_API_KEY;

if (QDRANT_API_KEY && !OPENAI_ENABLED) {
	console.warn('Qdrant is configured but openai_api_key is not');
}

const SEO_ENABLED = projectConfig.seo;

const DO_TAG_RELEASES = projectConfig.tag_releases || false;

const USER_TYPE_ALL_PERMISSIONS = projectConfig.permissions && projectConfig.permissions.all || {};
const USER_TYPE_ANONYMOUS_PERMISSIONS = projectConfig.permissions && projectConfig.permissions.anonymous || {};
const USER_TYPE_SIGNED_IN_PERMISSIONS = projectConfig.permissions && projectConfig.permissions.signed_in || {};
const USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS = projectConfig.permissions && projectConfig.permissions.signed_in_domain || {};

const verifyPermissionsLegal = (permissions) => {
	for (const [key, val] of Object.entries(permissions)) {
		if (key == 'admin') {
			throw new Error('Permissions objects may not list admin privileges for all users of a given type; it must be on the user object in firestore directly');
		}
		if (!val) {
			throw new Error('Permissions objects may only contain true keys');
		}
	}
};

verifyPermissionsLegal(USER_TYPE_ALL_PERMISSIONS);
verifyPermissionsLegal(USER_TYPE_ANONYMOUS_PERMISSIONS);
verifyPermissionsLegal(USER_TYPE_SIGNED_IN_PERMISSIONS);
verifyPermissionsLegal(USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS);

const makeExecExecutor = cmd => {
	return function (cb) {
		console.log('Running ' + cmd);
		exec(cmd, function (err, stdout, stderr) {
			console.log(stdout);
			console.log(stderr);
			cb(err);
		});
	};
};

const makeExecutor = cmdAndArgs => {
	return (cb) => {
		const splitCmd = cmdAndArgs.split(' ');
		const cmd = splitCmd[0];
		const args = splitCmd.slice(1);
		const result = spawnSync(cmd, args, {
			stdio: 'inherit'
		});
		cb(result.error);
	};
};

const makeBackgroundExecutor = cmdAndArgs => {
	return (cb) => {
		const splitCmd = cmdAndArgs.split(' ');
		const cmd = splitCmd[0];
		const args = splitCmd.slice(1);
		const result = spawn(cmd, args, {
			//Drop stdin, stdout, stderr on the floor
			stdio: 'ignore',
			detached: true
		});

		// This ensures that the parent process can exit independently of the child
		result.unref();

		cb();
	};
};

const BUILD_TASK = 'build';
const BUILD_OPTIONALLY = 'build-optionally';
const ASK_IF_WANT_BUILD = 'ask-if-want-build';
const GENERATE_SEO_PAGES = 'generate-seo-pages';
const GENERATE_SEO_PAGES_OPTIONALLY = 'generate-seo-pages-optionally';
const ASK_IF_WANT_SEO_PAGES = 'ask-if-want-seo-pages';
const FIREBASE_ENSURE_PROD_TASK = 'firebase-ensure-prod';
const FIREBASE_DEPLOY_TASK = 'firebase-deploy';
const FIREBASE_SET_CONFIG_LAST_DEPLOY_AFFECTING_RENDERING = 'firebase-set-config-last-deploy-affecting-rendering';
const GCLOUD_ENSURE_PROD_TASK = 'gcloud-ensure-prod';
const GCLOUD_BACKUP_TASK = 'gcloud-backup';
const MAKE_TAG_TASK = 'make-tag';
const PUSH_TAG_TASK = 'push-tag';
const CONFIGURE_API_KEYS_IF_SET = 'configure-api-keys-if-set';
const CONFIGURE_API_KEYS = 'configure-api-keys';
const SET_LAST_DEPLOY_IF_AFFECTS_RENDERING = 'set-last-deploy-if-affects-rendering';
const ASK_IF_DEPLOY_AFFECTS_RENDERING = 'ask-if-deploy-affects-rendering';
const ASK_BACKUP_MESSAGE = 'ask-backup-message';
const SET_UP_CORS = 'set-up-cors';
const CONFIGURE_QDRANT = 'configure-qdrant';
const CONFIGURE_ENVIRONMENT = 'configure-environment';

const GCLOUD_ENSURE_DEV_TASK = 'gcloud-ensure-dev';
const FIREBASE_ENSURE_DEV_TASK = 'firebase-ensure-dev';
const FIREBASE_DELETE_FIRESTORE_IF_SAFE_TASK = 'firebase-delete-firestore-if-safe';
const FIREBASE_DELETE_FIRESTORE_TASK = 'DANGEROUS-firebase-delete-firestore';
const GCLOUD_RESTORE_TASK = 'gcloud-restore';
const GSUTIL_RSYNC_UPLOADS = 'gsutil-rsync-uploads';
const REINDEX_CARD_EMBEDDINGS = 'reindex-card-embeddings';

const WARN_MAINTENANCE_TASKS = 'warn-maintenance-tasks';

const REGENERATE_FILES_FROM_CONFIG_TASK = 'inject-config';

gulp.task(REGENERATE_FILES_FROM_CONFIG_TASK, makeExecutor('npm run generate:config'));

gulp.task(CONFIGURE_ENVIRONMENT, makeExecutor('npm run generate:env'));

const pad = (num) => {
	let str =  '' + num;
	if (str.length < 2) {
		str = '0' + str;
	}
	return str;
};

const releaseTag = () =>{
	const d = new Date();
	//need to pad all items to ensure that the lexicographic sorting is in the rihgt order
	return 'deploy-' + d.getFullYear() + '-' + pad((d.getMonth() + 1)) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + '-' + pad(d.getMinutes());
};

const RELEASE_TAG = releaseTag();

//Will be set by FIREBASE_USE_PROD and FIREBASE_USE_DEV_TASK to ensure they
//don't get run again
let firebase_is_prod = undefined;
const firebaseUseProd = makeExecutor('firebase use ' + FIREBASE_PROD_PROJECT);
const firebaseUseDev = makeExecutor('firebase use ' + FIREBASE_DEV_PROJECT);

gulp.task(FIREBASE_ENSURE_PROD_TASK, (cb) => {
	if (firebase_is_prod) {
		console.log('Already using prod');
		cb();
		return;
	}
	firebase_is_prod = true;
	firebaseUseProd(cb);
});

gulp.task(FIREBASE_ENSURE_DEV_TASK, (cb) => {
	if (firebase_is_prod === false) {
		console.log('Already using dev');
		cb();
		return;
	}
	firebase_is_prod = false;
	firebaseUseDev(cb);
});

gulp.task(FIREBASE_DELETE_FIRESTORE_IF_SAFE_TASK, async (cb) => {
	const task = gulp.task(FIREBASE_DELETE_FIRESTORE_TASK);
	if (FIREBASE_DEV_PROJECT == FIREBASE_PROD_PROJECT) {
		const response = await prompts({
			type:'confirm',
			name: 'value',
			initial: false,
			message: 'You don\'t have a dev configuration. Do you really want to delete all prod data?',
		});
	
		if(!response.value) {
			process.exit(1);
		}
	}
	task(cb);
});

//Will be set by GCLOUD_USE_PROD and GCLOUD_USE_DEV_TASK to ensure they
//don't get run again
let gcloud_is_prod = undefined;
const gcloudUseProd = makeExecutor('gcloud config set project ' + FIREBASE_PROD_PROJECT);
const gcloudUseDev = makeExecutor('gcloud config set project ' + FIREBASE_DEV_PROJECT);

gulp.task(GCLOUD_ENSURE_PROD_TASK, (cb) => {
	if (gcloud_is_prod) {
		console.log('Already using prod');
		cb();
		return;
	}
	gcloud_is_prod = true;
	gcloudUseProd(cb);
});

gulp.task(GCLOUD_ENSURE_DEV_TASK, (cb) => {
	if (gcloud_is_prod === false) {
		console.log('Already using dev');
		cb();
		return;
	}
	gcloud_is_prod = false;
	gcloudUseDev(cb);
});

const configureQdrantCollection = async (client, collectionName) => {

	let collectionInfo = null;
	try {
		collectionInfo = await client.getCollection(collectionName);
	} catch(e) {
		//A 400 is the way it siganls that it doesn't exist.
		if (e.status !== 404) {
			throw e;
		}
	}

	if (!collectionInfo) {
		//Needs to be created
		const size = DEFAULT_EMBEDDING_TYPE_INFO.length;
		console.log(`Creating ${collectionName}`);
		await client.createCollection(collectionName, {
			vectors: {
				size,
				distance: 'Cosine'
			}
		});
	}

	if (!collectionInfo || !collectionInfo.payload_schema[PAYLOAD_CARD_ID_KEY]) {
		//Need to index card_id
		console.log(`Creating index for ${collectionName}.${PAYLOAD_CARD_ID_KEY}`);
		await client.createPayloadIndex(collectionName, {
			field_name: PAYLOAD_CARD_ID_KEY,
			field_schema: 'keyword'
		});
	}

	if (!collectionInfo || !collectionInfo.payload_schema[PAYLOAD_VERSION_KEY]) {
		//Need to index version
		console.log(`Creating index for ${collectionName}.${PAYLOAD_VERSION_KEY}`);
		await client.createPayloadIndex(collectionName, {
			field_name: PAYLOAD_VERSION_KEY,
			field_schema: 'integer'
		});
	}

};

gulp.task(CONFIGURE_QDRANT, async (cb) => {

	//TODO: consider splitting into a dev and prod deploy? The deploy is easy
	//enough that it's fine to do both at the same time.

	if (!QDRANT_ENABLED) {
		console.log('Skipping qdrant deploy because it\'s not configured');
		cb();
		return;
	}
	const client = new QdrantClient({
		url: QDRANT_CLUSTER_URL,
		apiKey: QDRANT_API_KEY
	});

	if (CONFIG_INCLUDES_DEV) {
		await configureQdrantCollection(client, QDRANT_DEV_COLLECTION_NAME);
	}
	await configureQdrantCollection(client, QDRANT_PROD_COLLECTION_NAME);
	cb();
});

gulp.task(REINDEX_CARD_EMBEDDINGS, async (cb) => {
	if (!QDRANT_ENABLED) {
		console.log('Skipping reindexing cards because qdrant is not enabled');
		cb();
		return;
	}

	const projectId = await selectedProjectID();

	const url = 'https://' + REGION + '-' + projectId + '.cloudfunctions.net/reindexCardEmbeddings';
	console.log('Running in the background: ' + url);
	const task = makeBackgroundExecutor('curl -X POST ' + url);
	task(cb);
});

gulp.task(BUILD_TASK, makeExecutor('npm run build'));

gulp.task(GENERATE_SEO_PAGES, makeExecutor('npm run generate:seo:pages'));

gulp.task(FIREBASE_DEPLOY_TASK, makeExecutor(ENABLE_TWITTER ? 'firebase deploy' : 'firebase deploy --only hosting,storage,firestore,functions:emailAdminOnMessage,functions:emailAdminOnStar,functions:legal' + (OPENAI_ENABLED ? ',functions:openai,functions:updateCardEmbedding,functions:reindexCardEmbeddings,functions:similarCards' : '')));

gulp.task(FIREBASE_SET_CONFIG_LAST_DEPLOY_AFFECTING_RENDERING, async (cb) => {
	const projectID = await selectedProjectID();
	const isDev = projectID == devProjectConfig.firebase.projectId;
	const data = fs.existsSync(CONFIG_EXTRA_FILE) ? fs.readFileSync(CONFIG_EXTRA_FILE).toString() : '{}';
	const result = JSON.parse(data);
	const key = isDev ? 'dev' : 'prod';
	const subObj = result[key] || {};
	subObj.last_deploy_affecting_rendering = RELEASE_TAG;
	//Just in case this was created
	result[key] = subObj;
	fs.writeFileSync(CONFIG_EXTRA_FILE, JSON.stringify(result, null, '\t'));
	cb();
	return;
});

//If there is no dev then we'll just set it twice, no bigge
gulp.task(SET_UP_CORS, gulp.series(
	makeExecutor('gsutil cors set cors.json gs://' + CONFIG_FIREBASE_DEV.storageBucket),
	makeExecutor('gsutil cors set cors.json gs://' + CONFIG_FIREBASE_PROD.storageBucket),
));

gulp.task(GCLOUD_BACKUP_TASK, cb => {
	if (!BACKUP_BUCKET_NAME) {
		console.log('Skipping backup since no backup_bucket_name set');
		cb();
		return;
	}
	//BACKUP_MESSAGE won't be known until later
	const task = makeExecutor('gcloud beta firestore export gs://' + BACKUP_BUCKET_NAME + '/' + RELEASE_TAG + (BACKUP_MESSAGE ? '-' + BACKUP_MESSAGE : ''));
	task(cb);
});

gulp.task(MAKE_TAG_TASK, makeExecutor('git tag ' + RELEASE_TAG));

gulp.task(PUSH_TAG_TASK, makeExecutor('git push origin ' + RELEASE_TAG));

gulp.task(FIREBASE_DELETE_FIRESTORE_TASK, makeExecutor('firebase firestore:delete --all-collections --force'));

//run doesn't support sub-commands embedded in the command, so use exec.
gulp.task(GCLOUD_RESTORE_TASK, cb => {
	if (!BACKUP_BUCKET_NAME) {
		cb(new Error('Cannot restore backup, no config.backup_bucket_name set'));
		return;
	}
	const task = makeExecExecutor('gcloud beta firestore import $(gsutil ls gs://' + BACKUP_BUCKET_NAME + ' | tail -n 1)');
	task(cb);
});

gulp.task(GSUTIL_RSYNC_UPLOADS, makeExecutor('gsutil rsync -r gs://' + CONFIG_FIREBASE_PROD.storageBucket + '/uploads gs://' + CONFIG_FIREBASE_DEV.storageBucket + '/uploads'));

let BACKUP_MESSAGE = '';

gulp.task(ASK_BACKUP_MESSAGE, async (cb) => {
	//Backups won't be used
	if (!BACKUP_BUCKET_NAME) {
		cb();
		return;
	}
	if (BACKUP_MESSAGE) {
		console.log('Backup message already set');
		cb();
		return;
	}
	const response = await prompts({
		type: 'text',
		name: 'value',
		message: 'Optional message for backup (for example to explain the reason why backup was run)'
	});

	let message = response.value;
	message = message.split(' ').join('-');
	if (!message.match('^[A-Za-z0-9-]*$')) {
		cb('Message contained illegal characters');
		return;
	}
	BACKUP_MESSAGE = message;
	cb();
});

let deployAffectsRendering = undefined;

gulp.task(ASK_IF_DEPLOY_AFFECTS_RENDERING, async (cb) => {
	if (deployAffectsRendering !== undefined) {
		console.log('Already asked if deploy affects rendering');
		cb();
		return;
	}
	const response = await prompts({
		type:'confirm',
		name: 'value',
		initial: false,
		message: 'Could the webapp in this deploy possibly affect rendering of cards?',
	});

	deployAffectsRendering = response.value;
	cb();

});

gulp.task(CONFIGURE_API_KEYS, makeExecutor('firebase functions:config:set openai.api_key=' + OPENAI_API_KEY));

gulp.task(CONFIGURE_API_KEYS_IF_SET, (cb) => {
	const task = gulp.task(CONFIGURE_API_KEYS);
	if (!OPENAI_API_KEY) {
		console.log('Skipping uploading of api keys because they weren\'t set');
		cb();
		return;
	}
	task(cb);
});

gulp.task(SET_LAST_DEPLOY_IF_AFFECTS_RENDERING, (cb) => {
	const task = gulp.task(FIREBASE_SET_CONFIG_LAST_DEPLOY_AFFECTING_RENDERING);
	if (!deployAffectsRendering) {
		console.log('Skipping setting config because deploy doesn\'t affect rendering');
		cb();
		return;
	}
	task(cb);
});

let wantsToSkipBuild = undefined;

gulp.task(ASK_IF_WANT_BUILD, async (cb) => {
	if (wantsToSkipBuild !== undefined) {
		console.log('Already asked if the user wants a build');
		cb();
		return;
	}
	const response = await prompts({
		type:'confirm',
		name: 'value',
		initial: false,
		message: 'Do you want to skip building, because the build output is already up to date?',
	});

	wantsToSkipBuild = response.value;
	cb();

});

let wantsToSkipSEO = undefined;

gulp.task(ASK_IF_WANT_SEO_PAGES, async (cb) => {
	if (wantsToSkipSEO !== undefined) {
		console.log('Already asked if the user wants an SEO');
		cb();
		return;
	}
	if (!SEO_ENABLED) {
		console.log('SEO not enabled in config.SECRET.json');
		cb();
		return;
	}
	const response = await prompts({
		type:'confirm',
		name: 'value',
		initial: false,
		message: 'Do you want to skip SEO generation? This can take a long time and only needs to be re-run if published card content has changed.',
	});

	wantsToSkipSEO = response.value;
	cb();

});

gulp.task(WARN_MAINTENANCE_TASKS, (cb) => {
	console.log(`******************************************************************
*                 WARNING 
*     You may need to run maintenance tasks. 
*     Go to https://<YOUR-APPS-DOMAIN>/maintenance
*     Ensure you're logged in as an admin
*     Hard refresh (Ctrl-Shift-R)
*     Run any maintenance tasks it tells you to.
*
******************************************************************`);
	cb();
});

gulp.task(BUILD_OPTIONALLY, async (cb) => {
	const task = gulp.task(BUILD_TASK);
	if (wantsToSkipBuild) {
		console.log('Skipping build because the user asked to skip it');
		cb();
		return;
	}
	task(cb);
});

gulp.task(GENERATE_SEO_PAGES_OPTIONALLY, async (cb) => {
	const task = gulp.task(GENERATE_SEO_PAGES);
	if (wantsToSkipSEO) {
		console.log('Skipping SEO because the user asked to skip it');
		cb();
		return;
	}
	task(cb);
});

gulp.task('set-up-deploy',
	gulp.series(
		SET_UP_CORS,
		FIREBASE_ENSURE_PROD_TASK,
		makeExecutor('firebase deploy --only firestore,storage')
	)
);

gulp.task('dev-deploy',
	gulp.series(
		REGENERATE_FILES_FROM_CONFIG_TASK,
		ASK_IF_WANT_BUILD,
		ASK_IF_WANT_SEO_PAGES,
		ASK_IF_DEPLOY_AFFECTS_RENDERING,
		BUILD_OPTIONALLY,
		GENERATE_SEO_PAGES_OPTIONALLY,
		FIREBASE_ENSURE_DEV_TASK,
		SET_LAST_DEPLOY_IF_AFFECTS_RENDERING,
		CONFIGURE_API_KEYS_IF_SET,
		CONFIGURE_QDRANT,
		CONFIGURE_ENVIRONMENT,
		FIREBASE_DEPLOY_TASK,
		REINDEX_CARD_EMBEDDINGS
	)
);

gulp.task('deploy', 
	gulp.series(
		REGENERATE_FILES_FROM_CONFIG_TASK,
		ASK_IF_WANT_BUILD,
		ASK_IF_WANT_SEO_PAGES,
		ASK_IF_DEPLOY_AFFECTS_RENDERING,
		BUILD_OPTIONALLY,
		GENERATE_SEO_PAGES_OPTIONALLY,
		FIREBASE_ENSURE_PROD_TASK,
		SET_LAST_DEPLOY_IF_AFFECTS_RENDERING,
		CONFIGURE_API_KEYS_IF_SET,
		CONFIGURE_QDRANT,
		CONFIGURE_ENVIRONMENT,
		FIREBASE_DEPLOY_TASK,
		WARN_MAINTENANCE_TASKS,
		REINDEX_CARD_EMBEDDINGS
	)
);

gulp.task('backup', 
	gulp.series(
		ASK_BACKUP_MESSAGE,
		GCLOUD_ENSURE_PROD_TASK,
		GCLOUD_BACKUP_TASK,
	)
);

gulp.task('tag-release', 
	gulp.series(
		MAKE_TAG_TASK,
		PUSH_TAG_TASK
	)
);

gulp.task('maybe-tag-release', (cb) => {
	const task = gulp.task('tag-release');
	if (!DO_TAG_RELEASES) {
		cb();
		return;
	}
	task(cb);
});

gulp.task('release', 
	gulp.series(
		//Ask at the beginning so the user can walk away after running
		ASK_IF_DEPLOY_AFFECTS_RENDERING,
		ASK_BACKUP_MESSAGE,
		ASK_IF_WANT_BUILD,
		'backup',
		'deploy',
		'maybe-tag-release'
	)
);

gulp.task('reset-dev',
	gulp.series(
		GCLOUD_ENSURE_DEV_TASK,
		FIREBASE_ENSURE_DEV_TASK,
		FIREBASE_DELETE_FIRESTORE_IF_SAFE_TASK,
		GCLOUD_RESTORE_TASK,
		GSUTIL_RSYNC_UPLOADS
	)
);

import realFavicon from 'gulp-real-favicon';

// File where the favicon markups are stored
var FAVICON_DATA_FILE = 'favicon_data.json';

// Generate the icons. This task takes a few seconds to complete.
// You should run it at least once to create the icons. Then,
// you should run it whenever RealFaviconGenerator updates its
// package (see the check-for-favicon-update task below).
gulp.task('generate-favicon', function(done) {
	realFavicon.generateFavicon({
		masterPicture: 'logo.svg',
		dest: 'images/',
		iconsPath: '/images',
		design: {
			ios: {
				pictureAspect: 'backgroundAndMargin',
				backgroundColor: '#ffffff',
				margin: '14%',
				assets: {
					ios6AndPriorIcons: false,
					ios7AndLaterIcons: false,
					precomposedIcons: false,
					declareOnlyDefaultIcon: true
				}
			},
			desktopBrowser: {
				design: 'raw'
			},
			windows: {
				pictureAspect: 'whiteSilhouette',
				backgroundColor: '#603cba',
				onConflict: 'override',
				assets: {
					windows80Ie10Tile: false,
					windows10Ie11EdgeTiles: {
						small: false,
						medium: true,
						big: false,
						rectangle: false
					}
				}
			},
			androidChrome: {
				pictureAspect: 'shadow',
				themeColor: '#ffffff',
				manifest: {
					name: APP_TITLE,
					display: 'standalone',
					orientation: 'notSet',
					onConflict: 'override',
					declared: true
				},
				assets: {
					legacyIcon: false,
					lowResolutionIcons: false
				}
			},
			safariPinnedTab: {
				pictureAspect: 'silhouette',
				themeColor: '#5e2b97'
			}
		},
		settings: {
			scalingAlgorithm: 'Mitchell',
			errorOnImageTooSmall: false,
			readmeFile: false,
			htmlCodeFile: false,
			usePathAsIs: false
		},
		markupFile: FAVICON_DATA_FILE
	}, function() {
		done();
	});
});

// Inject the favicon markups in your HTML pages. You should run
// this task whenever you modify a page. You can keep this task
// as is or refactor your existing HTML pipeline.
gulp.task('inject-favicon-markups', function() {
	return gulp.src([ 'index.html' ])
		.pipe(realFavicon.injectFaviconMarkups(JSON.parse(fs.readFileSync(FAVICON_DATA_FILE)).favicon.html_code))
		.pipe(gulp.dest('.'));
});

// Check for updates on RealFaviconGenerator (think: Apple has just
// released a new Touch icon along with the latest version of iOS).
// Run this task from time to time. Ideally, make it part of your
// continuous integration system.
gulp.task('check-for-favicon-update', function(done) {
	var currentVersion = JSON.parse(fs.readFileSync(FAVICON_DATA_FILE)).version;
	realFavicon.checkForUpdates(currentVersion, function(err) {
		if (err) {
			throw err;
		}
	});
	done();
});