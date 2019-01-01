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

const FIREBASE_PROD_PROJECT = 'complexity-compendium';
const FIREBASE_DEV_PROJECT = 'dev-complexity-compendium';

const POLYMER_BUILD_TASK = 'polymer-build';
const FIREBASE_USE_PROD_TASK = 'firebase-use-prod';
const FIREBASE_DEPLOY_TASK = 'firebase-deploy';
const GCLOUD_USE_PROD_TASK = 'gcloud-use-prod';
const GCLOUD_BACKUP_TASK = 'gcloud-backup';

gulp.task(POLYMER_BUILD_TASK, run('polymer build'));

gulp.task(FIREBASE_USE_PROD_TASK, run('firebase use ' + FIREBASE_PROD_PROJECT ));

gulp.task(FIREBASE_DEPLOY_TASK, run('firebase deploy'));

gulp.task(GCLOUD_USE_PROD_TASK, run('gcloud config set project ' + FIREBASE_PROD_PROJECT));

gulp.task(GCLOUD_BACKUP_TASK, run('gcloud beta firestore export gs://complexity-compendium-backup'));

gulp.task('backup', 
  gulp.series(
    GCLOUD_USE_PROD_TASK,
    GCLOUD_BACKUP_TASK,
  )
);

gulp.task('deploy', 
  gulp.series(
    POLYMER_BUILD_TASK,
    FIREBASE_USE_PROD_TASK,
    FIREBASE_DEPLOY_TASK,
    'backup'
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
