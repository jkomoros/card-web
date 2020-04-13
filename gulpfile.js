/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

/*eslint-env node*/

const gulp = require('gulp');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const del = require('del');
const spawnSync = require('child_process').spawnSync;
//Only used for `reset-dev` because htat uses subcommands
const exec = require('child_process').exec;
const prompts = require('prompts');

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

const FIREBASE_PROD_PROJECT = 'complexity-compendium';
const FIREBASE_DEV_PROJECT = 'dev-complexity-compendium';

const POLYMER_BUILD_TASK = 'polymer-build';
const POLYMER_BUILD_OPTIONALLY = 'polymer-build-optionally';
const ASK_IF_WANT_POLYMER_BUILD = 'ask-if-want-polymer-build';
const FIREBASE_ENSURE_PROD_TASK = 'firebase-ensure-prod';
const FIREBASE_DEPLOY_TASK = 'firebase-deploy';
const FIREBASE_SET_CONFIG_LAST_DEPLOY_AFFECTING_RENDERING = 'firebase-set-config-last-deploy-affecting-rendering';
const GCLOUD_ENSURE_PROD_TASK = 'gcloud-ensure-prod';
const GCLOUD_BACKUP_TASK = 'gcloud-backup';
const MAKE_TAG_TASK = 'make-tag';
const PUSH_TAG_TASK = 'push-tag';
const SET_LAST_DEPLOY_IF_AFFECTS_RENDERING = 'set-last-deploy-if-affects-rendering';
const ASK_IF_DEPLOY_AFFECTS_RENDERING = 'ask-if-deploy-affects-rendering';
const ASK_BACKUP_MESSAGE = 'ask-backup-message';

const GCLOUD_ENSURE_DEV_TASK = 'gcloud-ensure-dev';
const FIREBASE_ENSURE_DEV_TASK = 'firebase-ensure-dev';
const FIREBASE_DELETE_FIRESTORE_TASK = 'DANGEROUS-firebase-delete-firestore';
const GCLOUD_RESTORE_TASK = 'gcloud-restore';

const pad = (num) => {
	let str =  '' + num;
	if (str.length < 2) {
		str = '0' + str;
	}
	return str;
};

const releaseTag = () =>{
	let d = new Date();
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

gulp.task(POLYMER_BUILD_TASK, makeExecutor('polymer build'));

gulp.task(FIREBASE_DEPLOY_TASK, makeExecutor('firebase deploy'));

gulp.task(FIREBASE_SET_CONFIG_LAST_DEPLOY_AFFECTING_RENDERING, makeExecutor('firebase functions:config:set site.last_deploy_affecting_rendering=' + RELEASE_TAG));

gulp.task(GCLOUD_BACKUP_TASK, cb => {
	//BACKUP_MESSAGE won't be known until later
	const task = makeExecutor('gcloud beta firestore export gs://complexity-compendium-backup/' + RELEASE_TAG + (BACKUP_MESSAGE ? '-' + BACKUP_MESSAGE : ''));
	task(cb);
});

gulp.task(MAKE_TAG_TASK, makeExecutor('git tag ' + RELEASE_TAG));

gulp.task(PUSH_TAG_TASK, makeExecutor('git push origin ' + RELEASE_TAG));

gulp.task(FIREBASE_DELETE_FIRESTORE_TASK, makeExecutor('firebase firestore:delete --all-collections --yes'));

//run doesn't support sub-commands embedded in the command, so use exec.
gulp.task(GCLOUD_RESTORE_TASK, makeExecExecutor('gcloud beta firestore import $(gsutil ls gs://complexity-compendium-backup | tail -n 1)'));

let BACKUP_MESSAGE = '';

gulp.task(ASK_BACKUP_MESSAGE, async (cb) => {
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

gulp.task(SET_LAST_DEPLOY_IF_AFFECTS_RENDERING, (cb) => {
	let task = gulp.task(FIREBASE_SET_CONFIG_LAST_DEPLOY_AFFECTING_RENDERING);
	if (!deployAffectsRendering) {
		console.log('Skipping setting config because deploy doesn\'t affect rendering');
		cb();
		return;
	}
	task(cb);
});

let wantsToSkipPolymerBuild = undefined;

gulp.task(ASK_IF_WANT_POLYMER_BUILD, async (cb) => {
	if (wantsToSkipPolymerBuild !== undefined) {
		console.log('Already asked if the user wants a polymer build');
		cb();
		return;
	}
	const response = await prompts({
		type:'confirm',
		name: 'value',
		initial: false,
		message: 'Do you want to skip building, because the polymer build output is already up to date?',
	});

	wantsToSkipPolymerBuild = response.value;
	cb();

});

gulp.task(POLYMER_BUILD_OPTIONALLY, async (cb) => {
	let task = gulp.task(POLYMER_BUILD_TASK);
	if (wantsToSkipPolymerBuild) {
		console.log('Skipping polymer build because the user asked to skip it');
		cb();
		return;
	}
	task(cb);
});

gulp.task('dev-deploy',
	gulp.series(
		ASK_IF_WANT_POLYMER_BUILD,
		POLYMER_BUILD_OPTIONALLY,
		ASK_IF_DEPLOY_AFFECTS_RENDERING,
		FIREBASE_ENSURE_DEV_TASK,
		SET_LAST_DEPLOY_IF_AFFECTS_RENDERING,
		FIREBASE_DEPLOY_TASK
	)
);

gulp.task('deploy', 
	gulp.series(
		ASK_IF_WANT_POLYMER_BUILD,
		POLYMER_BUILD_OPTIONALLY,
		ASK_IF_DEPLOY_AFFECTS_RENDERING,
		FIREBASE_ENSURE_PROD_TASK,
		SET_LAST_DEPLOY_IF_AFFECTS_RENDERING,
		FIREBASE_DEPLOY_TASK
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

gulp.task('release', 
	gulp.series(
		//Ask at the beginning so the user can walk away after running
		ASK_IF_DEPLOY_AFFECTS_RENDERING,
		ASK_BACKUP_MESSAGE,
		ASK_IF_WANT_POLYMER_BUILD,
		'backup',
		'deploy',
		'tag-release'
	)
);

gulp.task('reset-dev',
	gulp.series(
		GCLOUD_ENSURE_DEV_TASK,
		FIREBASE_ENSURE_DEV_TASK,
		FIREBASE_DELETE_FIRESTORE_TASK,
		GCLOUD_RESTORE_TASK,
	)
);

/**
 * Cleans the prpl-server build in the server directory.
 */
gulp.task('prpl-server:clean', () => {
	return del('server/build');
});

/**
 * Copies the prpl-server build to the server directory while renaming the
 * node_modules directory so services like App Engine will upload it.
 */
gulp.task('prpl-server:build', () => {
	const pattern = 'node_modules';
	const replacement = 'node_assets';

	return gulp.src('build/**')
		.pipe(rename(((path) => {
			path.basename = path.basename.replace(pattern, replacement);
			path.dirname = path.dirname.replace(pattern, replacement);
		})))
		.pipe(replace(pattern, replacement))
		.pipe(gulp.dest('server/build'));
});

gulp.task('prpl-server', gulp.series(
	'prpl-server:clean',
	'prpl-server:build'
));

var realFavicon = require ('gulp-real-favicon');
var fs = require('fs');

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
					name: 'The Compendium',
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