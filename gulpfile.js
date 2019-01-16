/**
@license
Copyright (c) 2018 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at http://polymer.github.io/LICENSE.txt
The complete set of authors may be found at http://polymer.github.io/AUTHORS.txt
The complete set of contributors may be found at http://polymer.github.io/CONTRIBUTORS.txt
Code distributed by Google as part of the polymer project is also
subject to an additional IP rights grant found at http://polymer.github.io/PATENTS.txt
*/

const gulp = require('gulp');
const rename = require('gulp-rename');
const replace = require('gulp-replace');
const del = require('del');
const run = require('gulp-run-command').default;
const exec = require('child_process').exec;

const makeExecutor = cmd => {
	return function (cb) {
		console.log("Running " + cmd)
		exec(cmd, function (err, stdout, stderr) {
			console.log(stdout);
			console.log(stderr);
			cb(err);
		})
	};
}

const FIREBASE_PROD_PROJECT = 'complexity-compendium';
const FIREBASE_DEV_PROJECT = 'dev-complexity-compendium';

const POLYMER_BUILD_TASK = 'polymer-build';
const FIREBASE_USE_PROD_TASK = 'firebase-use-prod';
const FIREBASE_DEPLOY_TASK = 'firebase-deploy';
const GCLOUD_USE_PROD_TASK = 'gcloud-use-prod';
const GCLOUD_BACKUP_TASK = 'gcloud-backup';
const MAKE_TAG_TASK = 'make-tag';
const PUSH_TAG_TASK = 'push-tag';

const GCLOUD_USE_DEV_TASK = 'gcloud-use-dev';
const FIREBASE_USE_DEV_TASK = 'firebase-use-dev';
const FIREBASE_DELETE_FIRESTORE_TASK = 'DANGEROUS-firebase-delete-firestore';
const GCLOUD_RESTORE_TASK = 'gcloud-restore'

const pad = (num) => {
	let str =  '' + num;
	if (str.length < 2) {
		str = "0" + str;
	}
	return str
}

const releaseTag = () =>{
	let d = new Date();
	return 'deploy-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + "-" + d.getHours() + "-" + pad(d.getMinutes());
}

const RELEASE_TAG = releaseTag();


gulp.task(POLYMER_BUILD_TASK, run('polymer build'));

gulp.task(FIREBASE_USE_PROD_TASK, run('firebase use ' + FIREBASE_PROD_PROJECT ));

gulp.task(FIREBASE_DEPLOY_TASK, run('firebase deploy'));

gulp.task(GCLOUD_USE_PROD_TASK, run('gcloud config set project ' + FIREBASE_PROD_PROJECT));

gulp.task(GCLOUD_BACKUP_TASK, run('gcloud beta firestore export gs://complexity-compendium-backup'));

gulp.task(MAKE_TAG_TASK, run('git tag "' + RELEASE_TAG + '"'));

gulp.task(PUSH_TAG_TASK, run('git push origin "' + RELEASE_TAG + '"'));

gulp.task(GCLOUD_USE_DEV_TASK, run('gcloud config set project ' + FIREBASE_DEV_PROJECT));

gulp.task(FIREBASE_USE_DEV_TASK, run('firebase use ' + FIREBASE_DEV_PROJECT));

gulp.task(FIREBASE_DELETE_FIRESTORE_TASK, run('firebase firestore:delete --all-collections --yes'));

//run doesn't support sub-commands embedded in the command, so use exec.
gulp.task(GCLOUD_RESTORE_TASK, makeExecutor(('gcloud beta firestore import $(gsutil ls gs://complexity-compendium-backup | tail -n 1)')));

gulp.task('deploy', 
	gulp.series(
		POLYMER_BUILD_TASK,
		FIREBASE_USE_PROD_TASK,
		FIREBASE_DEPLOY_TASK
	)
);

gulp.task('backup', 
	gulp.series(
		GCLOUD_USE_PROD_TASK,
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
		'backup',
		'deploy',
		'tag-release'
	)
);

gulp.task('reset-dev',
	gulp.series(
		GCLOUD_USE_DEV_TASK,
		FIREBASE_USE_DEV_TASK,
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
