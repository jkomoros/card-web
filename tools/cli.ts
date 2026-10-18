import { spawnSync } from 'child_process';
import fs from 'fs';
import process from 'process';
import prompts from 'prompts';

import {
	devProdConfig,
	selectedProjectID,
	CHANGE_ME_SENTINEL,
	verifyPermissionsLegal,
	runSync,
	runBackground,
} from './util.js';

import { deployFirebase } from './deploy-firebase.js';
import { setLastDeployConfig } from './deploy-config.js';
import { configureQdrant } from './qdrant.js';
import {
	generateFavicon as generateFaviconImpl,
	injectFaviconMarkups as injectFaviconMarkupsImpl,
	checkForFaviconUpdate as checkForFaviconUpdateImpl,
} from './favicon.js';

// --- Config loading ---

let config;
try {
	config = devProdConfig();
} catch (_err) {
	console.log('config.SECRET.json didn\'t exist. Check README.md on how to create one');
	process.exit(1);
}

const projectConfig = config.prod;
const devProjectConfig = config.dev;

const CONFIG_INCLUDES_DEV = config.devProvided;

const REGION = projectConfig.region || 'us-central1';

const FIREBASE_PROD_PROJECT = projectConfig.firebase.projectId;
if (!FIREBASE_PROD_PROJECT) throw new Error('Missing prod firebase projectId in config');
const FIREBASE_DEV_PROJECT = devProjectConfig.firebase.projectId;
if (!FIREBASE_DEV_PROJECT) throw new Error('Missing dev firebase projectId in config');

const BACKUP_BUCKET_NAME = projectConfig.backup_bucket_name && projectConfig.backup_bucket_name !== CHANGE_ME_SENTINEL ? projectConfig.backup_bucket_name : '';

const APP_TITLE = projectConfig.app_title ? projectConfig.app_title : 'Cards Web';

const TWITTER_HANDLE = projectConfig.twitter_handle && projectConfig.twitter_handle !== CHANGE_ME_SENTINEL ? projectConfig.twitter_handle : '';
const DISABLE_TWITTER = projectConfig.disable_twitter || false;
const ENABLE_TWITTER = !!TWITTER_HANDLE && !DISABLE_TWITTER;

const OPENAI_API_KEY = projectConfig.openai_api_key || '';
const OPENAI_ENABLED = OPENAI_API_KEY !== '';

const ANTHROPIC_API_KEY = projectConfig.anthropic_api_key || '';
const ANTHROPIC_ENABLED = ANTHROPIC_API_KEY !== '';

const SEO_ENABLED = projectConfig.seo;

const DO_TAG_RELEASES = projectConfig.tag_releases || false;

const USER_TYPE_ALL_PERMISSIONS = projectConfig.permissions?.all || {};
const USER_TYPE_ANONYMOUS_PERMISSIONS = projectConfig.permissions?.anonymous || {};
const USER_TYPE_SIGNED_IN_PERMISSIONS = projectConfig.permissions?.signed_in || {};
const USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS = projectConfig.permissions?.signed_in_domain || {};

// --- Permissions validation at startup ---

verifyPermissionsLegal(USER_TYPE_ALL_PERMISSIONS);
verifyPermissionsLegal(USER_TYPE_ANONYMOUS_PERMISSIONS);
verifyPermissionsLegal(USER_TYPE_SIGNED_IN_PERMISSIONS);
verifyPermissionsLegal(USER_TYPE_SIGNED_IN_DOMAIN_PERMISSIONS);

// --- Helpers ---

const pad = (num: number): string => {
	let str = '' + num;
	if (str.length < 2) {
		str = '0' + str;
	}
	return str;
};

const releaseTag = (): string => {
	const d = new Date();
	return 'deploy-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + '-' + pad(d.getMinutes());
};

const RELEASE_TAG = releaseTag();

const runCommand = (cmd: string, args: string[]): void => {
	runSync(cmd, args);
};

// --- Individual command functions ---

const injectConfig = (): void => {
	runCommand('npm', ['run', 'generate:config']);
};

const configureEnvironment = (): void => {
	runCommand('npm', ['run', 'generate:env']);
};

const build = (): void => {
	runCommand('npm', ['run', 'build']);
};

const generateSeoPages = (): void => {
	runCommand('npm', ['run', 'generate:seo:pages']);
};

const generateSeoPagesOptionally = (): void => {
	if (!SEO_ENABLED) {
		console.log('Skipping SEO because it\'s not enabled');
		return;
	}
	generateSeoPages();
};

const mount = (): void => {
	runCommand('npx', ['tsx', 'tools/mount.ts']);
};

const mountDryRun = (): void => {
	runCommand('npx', ['tsx', 'tools/mount.ts', '--dry-run']);
};

const firebaseEnsureProd = (): void => {
	runCommand('firebase', ['use', FIREBASE_PROD_PROJECT]);
};

const firebaseEnsureDev = (): void => {
	runCommand('firebase', ['use', FIREBASE_DEV_PROJECT]);
};

const gcloudEnsureProd = (): void => {
	runCommand('gcloud', ['config', 'set', 'project', FIREBASE_PROD_PROJECT]);
};

const gcloudEnsureDev = (): void => {
	runCommand('gcloud', ['config', 'set', 'project', FIREBASE_DEV_PROJECT]);
};

const firebaseDeploy = (): void => {
	deployFirebase({
		openaiEnabled: OPENAI_ENABLED,
		anthropicEnabled: ANTHROPIC_ENABLED,
		enableTwitter: ENABLE_TWITTER,
	});
};

const setConfigLastDeploy = async (): Promise<void> => {
	await setLastDeployConfig(RELEASE_TAG, FIREBASE_DEV_PROJECT);
};

const configureQdrantCommand = async (): Promise<void> => {
	await configureQdrant(projectConfig, devProjectConfig, CONFIG_INCLUDES_DEV, OPENAI_ENABLED);
};

//Starts after `--cursor <id>` when given, to resume a walk that stopped.
const reindexCursorArg = (): string | null => {
	const index = process.argv.indexOf('--cursor');
	return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
};

const reindexResumeHint = (projectId : string, cursor : string | null) : string =>
	`resume with: npx tsx tools/cli.ts reindex${projectId === FIREBASE_DEV_PROJECT ? ':dev' : ''} --cursor ${cursor || '<start>'}`;

const reindexCardEmbeddings = async (startCursor : string | null = null): Promise<void> => {
	const qdrantInfo = projectConfig.qdrant;
	const qdrantIsEnabled = OPENAI_ENABLED && qdrantInfo?.api_key && qdrantInfo?.cluster_url;
	if (!qdrantIsEnabled) {
		console.log('Skipping reindexing cards because qdrant is not enabled');
		return;
	}

	const projectId = await selectedProjectID();
	const url = 'https://' + REGION + '-' + projectId + '.cloudfunctions.net/reindexCardEmbeddings';
	//Page by page, reported, and loud on failure (#783): the function used to
	//be fired in the background with curl and never read, and had been dying
	//out of memory on every deploy since Sept 20 without anyone seeing it.
	console.log('Reindexing card embeddings page by page via ' + url);
	let cursor : string | null = startCursor;
	let page = 0;
	const totals = {processed: 0, touched: 0, reused: 0, embedded: 0, failed: 0};
	const startedAt = Date.now();
	for (;;) {
		page++;
		//The resume hint comes FIRST and the body is collapsed to one line:
		//the deploy's banner prints the first line of the error, and a 503
		//HTML body would otherwise push the cursor out of it. A fetch that
		//throws (the 300 s headers timeout, a reset) carries the hint too.
		let response : Response;
		try {
			response = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(cursor ? {cursor} : {})});
		} catch (err) {
			throw new Error(`reindexCardEmbeddings page ${page} failed (${reindexResumeHint(projectId, cursor)}): ${String(err).replace(/\s+/g, ' ')}`);
		}
		if (!response.ok) throw new Error(`reindexCardEmbeddings page ${page} failed (${reindexResumeHint(projectId, cursor)}): HTTP ${response.status} ${(await response.text()).replace(/\s+/g, ' ').slice(0, 500)}`);
		const result = await response.json() as {nextCursor : string | null, processed : number, touched : number, reused : number, embedded : number, failed : number, failures : string[]};
		for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += result[key] || 0;
		console.log(`  page ${page}: ${result.processed} cards (touched ${result.touched}, reused ${result.reused}, embedded ${result.embedded}, failed ${result.failed}) — ${totals.processed} so far, ${Math.round((Date.now() - startedAt) / 1000)}s`);
		for (const failure of result.failures || []) console.warn('    ' + failure);
		if (!result.nextCursor) break;
		cursor = result.nextCursor;
	}
	console.log(`Reindex complete: ${totals.processed} cards, touched ${totals.touched}, reused ${totals.reused}, embedded ${totals.embedded}, failed ${totals.failed}, ${Math.round((Date.now() - startedAt) / 1000)}s`);
	if (totals.failed) throw new Error(`reindexCardEmbeddings: ${totals.failed} card(s) failed; see the lines above`);
};

//The deploy's reindex: reported, never fatal to the deploy. Hosting, rules
//and functions have already shipped by the time this runs, and a release
//tags afterwards; a card that cannot be embedded (the function's own
//comment expects some) must not turn a finished deploy into an exit 1 with
//no tag. The standalone `reindex` command keeps the throw.
const reindexAfterDeploy = async (): Promise<void> => {
	try {
		await reindexCardEmbeddings();
	} catch (err) {
		const projectId = await selectedProjectID();
		console.log('');
		console.log('  ******************************************************************');
		console.log('  *  The deploy itself completed. The embedding REINDEX did not:');
		console.log('  *  ' + String(err).replace(/\s+/g, ' ').slice(0, 700));
		console.log(`  *  Rerun it on its own: npx tsx tools/cli.ts reindex${projectId === FIREBASE_DEV_PROJECT ? ':dev' : ''} [--cursor <id>]`);
		console.log('  ******************************************************************');
		console.log('');
	}
};

const cleanupOldEmbeddings = async (): Promise<void> => {
	const qdrantInfo = projectConfig.qdrant;
	const qdrantIsEnabled = OPENAI_ENABLED && qdrantInfo?.api_key && qdrantInfo?.cluster_url;
	if (!qdrantIsEnabled) {
		console.log('Skipping cleanup old embeddings because qdrant is not enabled');
		return;
	}

	const projectId = await selectedProjectID();
	const versionsToDelete = process.env.VERSIONS_TO_DELETE ? process.env.VERSIONS_TO_DELETE.split(',').map(v => parseInt(v.trim())) : [0];
	console.log(`Will delete embedding versions: ${versionsToDelete.join(', ')}`);

	const url = 'https://' + REGION + '-' + projectId + '.cloudfunctions.net/cleanupOldEmbeddings';
	console.log('Running in the background: ' + url);
	const data = JSON.stringify({ versions: versionsToDelete });
	runBackground('curl', ['-X', 'POST', '-H', 'Content-Type: application/json', '-d', data, url]);
};

const setUpCors = (): void => {
	runCommand('gsutil', ['cors', 'set', 'cors.json', 'gs://' + devProjectConfig.firebase.storageBucket]);
	runCommand('gsutil', ['cors', 'set', 'cors.json', 'gs://' + projectConfig.firebase.storageBucket]);
};

const gcloudBackup = (backupMessage: string): void => {
	if (!BACKUP_BUCKET_NAME) {
		console.log('Skipping backup since no backup_bucket_name set');
		return;
	}
	runCommand('gcloud', ['beta', 'firestore', 'export', 'gs://' + BACKUP_BUCKET_NAME + '/' + RELEASE_TAG + (backupMessage ? '-' + backupMessage : '')]);
};

const gcloudRestore = (): void => {
	if (!BACKUP_BUCKET_NAME) {
		throw new Error('Cannot restore backup, no config.backup_bucket_name set');
	}
	// Need to use shell for the subcommand
	console.log('Running gcloud restore...');
	//`gsutil ls | tail -n 1` is ALPHABETICAL: a manually named export sorting
	//after "deploy-" (the bucket held dev-enterprise-migration-2026-04-12)
	//would be restored instead of the newest backup. Backups are named by
	//RELEASE_TAG, which starts with "deploy-" and embeds the date, so the
	//last "deploy-" entry is the newest.
	const result = spawnSync('bash', ['-c', 'gcloud beta firestore import $(gsutil ls gs://' + BACKUP_BUCKET_NAME + ' | grep "/deploy-" | tail -n 1)'], {
		stdio: 'inherit'
	});
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Restore failed with exit code ${result.status}`);
};

const gsutilRsyncUploads = (): void => {
	runCommand('gsutil', ['rsync', '-r', 'gs://' + projectConfig.firebase.storageBucket + '/uploads', 'gs://' + devProjectConfig.firebase.storageBucket + '/uploads']);
};

const firebaseDeleteFirestoreIfSafe = async (): Promise<void> => {
	if (FIREBASE_DEV_PROJECT === FIREBASE_PROD_PROJECT) {
		const response = await prompts({
			type: 'confirm',
			name: 'value',
			initial: false,
			message: 'You don\'t have a dev configuration. Do you really want to delete all prod data?',
		});

		if (!response.value) {
			process.exit(1);
		}
	}
	runCommand('firebase', ['firestore:delete', '--all-collections', '--force']);
};

const warnMaintenance = (): void => {
	console.log(`******************************************************************
*                 WARNING
*     You may need to run maintenance tasks.
*     Go to https://<YOUR-APPS-DOMAIN>/maintenance
*     Ensure you're logged in as an admin
*     Hard refresh (Ctrl-Shift-R)
*     Run any maintenance tasks it tells you to.
*
******************************************************************`);
};

const makeTag = (): void => {
	runCommand('git', ['tag', RELEASE_TAG]);
};

const pushTag = (): void => {
	runCommand('git', ['push', 'origin', RELEASE_TAG]);
};

const askBackupMessage = async (cliMessage?: string): Promise<string> => {
	if (!BACKUP_BUCKET_NAME) {
		return '';
	}
	if (cliMessage !== undefined) {
		return cliMessage;
	}
	const response = await prompts({
		type: 'text',
		name: 'value',
		message: 'Optional message for backup (for example to explain the reason why backup was run)'
	});

	let message: string = (response.value as string) || '';
	message = message.split(' ').join('-');
	if (!message.match('^[A-Za-z0-9-]*$')) {
		throw new Error('Message contained illegal characters');
	}
	return message;
};

//Record WHICH COMMIT was deployed, and publish it so a live check can verify
//rather than assume.
//
//The habit this exists to break: deploying from the working tree and committing
//afterwards, which leaves the deployed build a few minutes older than HEAD. It
//has now happened repeatedly, and once caused a post-deploy verification to
//test the PREVIOUS build and report a working fix as broken — the review caught
//it twice. "The deployed build is HEAD" was an assumption every verify step
//made and nothing checked.
//
//Also warns when the tree is DIRTY, which is worse than lagging: the deployed
//build then corresponds to no commit at all, so nobody can reproduce it later.
const writeDeployStamp = (): void => {
	const git = (args: string[]): string => {
		const result = spawnSync('git', args, {encoding: 'utf8'});
		return result.status === 0 ? (result.stdout || '').trim() : '';
	};
	const commit = git(['rev-parse', 'HEAD']);
	const short = git(['rev-parse', '--short', 'HEAD']);
	const subject = git(['log', '-1', '--format=%s']);
	//DIRTY means "this build contains work that is not committed", which is a
	//reproducibility problem. It deliberately does NOT mean "git status is not
	//empty": build artifacts and the reviewers' untracked notes live here
	//permanently, so a plain --porcelain check fired on literally every deploy —
	//and a warning that always fires is one nobody reads, which is worse than no
	//warning at all. Count tracked modifications, plus untracked files under the
	//SOURCE trees, since a new .ts nobody committed does change the build.
	const trackedChanges = git(['status', '--porcelain', '--untracked-files=no']);
	const untrackedSources = git(['ls-files', '--others', '--exclude-standard', 'src', 'shared', 'tools', 'test']);
	const dirty = trackedChanges !== '' || untrackedSources !== '';
	const stamp = {commit, short, subject, dirty, deployedAt: new Date().toISOString()};
	try {
		fs.mkdirSync('build', {recursive: true});
		fs.writeFileSync('build/deploy-stamp.json', JSON.stringify(stamp, null, 2));
	} catch (err) {
		console.warn('could not write build/deploy-stamp.json: ' + String(err));
	}
	console.log('');
	console.log('  DEPLOYING ' + (short || '(unknown commit)') + (subject ? ' — ' + subject : ''));
	if (dirty) {
		console.log('  WARNING: uncommitted work is IN this build, so it matches no commit.');
		console.log('           Whoever verifies this deploy cannot reproduce what is running.');
		if (trackedChanges) console.log('           modified: ' + trackedChanges.split('\n').slice(0, 5).join(', '));
		if (untrackedSources) console.log('           untracked source files: ' + untrackedSources.split('\n').slice(0, 5).join(', '));
	}
	console.log('  Verify with: curl -s https://<host>/deploy-stamp.json');
	console.log('');
};

// --- Composite workflows ---

const setUpDeploy = (): void => {
	setUpCors();
	firebaseEnsureProd();
	runCommand('firebase', ['deploy', '--only', 'firestore,storage']);
};

const devDeploy = async (): Promise<void> => {
	injectConfig();
	generateSeoPagesOptionally();
	build();
	writeDeployStamp();
	firebaseEnsureDev();
	await setConfigLastDeploy();
	await configureQdrantCommand();
	configureEnvironment();
	firebaseDeploy();
	await reindexAfterDeploy();
};

const deploy = async (): Promise<void> => {
	injectConfig();
	generateSeoPagesOptionally();
	build();
	writeDeployStamp();
	firebaseEnsureProd();
	await setConfigLastDeploy();
	await configureQdrantCommand();
	configureEnvironment();
	firebaseDeploy();
	await reindexAfterDeploy();
	//After the reindex, so ~100 page lines do not scroll it away.
	warnMaintenance();
};

const backup = async (cliMessage?: string): Promise<void> => {
	const message = await askBackupMessage(cliMessage);
	gcloudEnsureProd();
	gcloudBackup(message);
};

const tagRelease = (): void => {
	makeTag();
	pushTag();
};

const release = async (): Promise<void> => {
	const message = await askBackupMessage();
	// Pass the already-collected message to backup to avoid re-prompting
	await backup(message);
	await deploy();
	if (DO_TAG_RELEASES) {
		tagRelease();
	}
};

const resetDev = async (): Promise<void> => {
	gcloudEnsureDev();
	firebaseEnsureDev();
	await firebaseDeleteFirestoreIfSafe();
	gcloudRestore();
	gsutilRsyncUploads();
};

// --- Help ---

const COMMANDS: { name: string; description: string }[] = [
	{ name: 'help', description: 'Show this help message' },
	{ name: 'deploy', description: 'Build and deploy to production' },
	{ name: 'dev-deploy', description: 'Build and deploy to dev' },
	{ name: 'release', description: 'Backup, deploy to prod, and optionally tag' },
	{ name: 'backup', description: 'Backup prod firestore (--message <msg>)' },
	{ name: 'reindex', description: 'Reindex card embeddings on prod, page by page, reporting each page (--cursor <id> resumes)' },
	{ name: 'reindex:dev', description: 'Same against dev' },
	{ name: 'tag-release', description: 'Create and push a git deploy tag' },
	{ name: 'reset-dev', description: 'Reset dev firestore from latest prod backup' },
	{ name: 'set-up-deploy', description: 'Set up CORS and deploy firestore/storage rules' },
	{ name: 'inject-config', description: 'Generate config files from config.SECRET.json' },
	{ name: 'configure-environment', description: 'Generate .env files for cloud functions' },
	{ name: 'build', description: 'Run the build pipeline' },
	{ name: 'generate-seo-pages', description: 'Generate SEO pages for published cards' },
	{ name: 'mount', description: 'Run mount sync' },
	{ name: 'mount-dry-run', description: 'Run mount sync in dry-run mode' },
	{ name: 'firebase-ensure-prod', description: 'Switch firebase to prod project' },
	{ name: 'firebase-ensure-dev', description: 'Switch firebase to dev project' },
	{ name: 'firebase-deploy', description: 'Deploy to firebase (hosting, functions, etc.)' },
	{ name: 'set-config-last-deploy', description: 'Write release tag to config.EXTRA.json' },
	{ name: 'gcloud-ensure-prod', description: 'Switch gcloud to prod project' },
	{ name: 'gcloud-ensure-dev', description: 'Switch gcloud to dev project' },
	{ name: 'gcloud-backup', description: 'Export firestore to backup bucket' },
	{ name: 'gcloud-restore', description: 'Import latest backup into firestore' },
	{ name: 'gsutil-rsync-uploads', description: 'Sync uploads from prod to dev storage' },
	{ name: 'configure-qdrant', description: 'Set up qdrant collections and indices' },
	{ name: 'reindex-card-embeddings', description: 'Trigger background reindexing of card embeddings' },
	{ name: 'cleanup-old-embeddings', description: 'Trigger background cleanup of old embeddings' },
	{ name: 'set-up-cors', description: 'Set CORS config on storage buckets' },
	{ name: 'firebase-delete-firestore-if-safe', description: 'Delete all firestore data (with safety prompt)' },
	{ name: 'warn-maintenance', description: 'Print maintenance task reminder' },
	{ name: 'make-tag', description: 'Create a local git deploy tag' },
	{ name: 'push-tag', description: 'Push the deploy tag to origin' },
	{ name: 'generate-favicon', description: 'Generate favicon images from logo.svg' },
	{ name: 'inject-favicon-markups', description: 'Inject favicon markup into index.html' },
	{ name: 'check-for-favicon-update', description: 'Check if favicon generator has updates' },
];

const showHelp = (): void => {
	console.log('Usage: npx tsx tools/cli.ts <command>\n');
	console.log('Commands:');
	const maxLen = Math.max(...COMMANDS.map(c => c.name.length));
	for (const cmd of COMMANDS) {
		console.log('  ' + cmd.name.padEnd(maxLen + 2) + cmd.description);
	}
	console.log('');
};

// --- Command dispatch ---

const main = async (): Promise<void> => {
	const args = process.argv.slice(2);
	const command = args[0] || '--help';

	switch (command) {
	case 'help':
	case '--help':
	case '-h':
		showHelp();
		break;
	case 'inject-config':
		injectConfig();
		break;
	case 'configure-environment':
		configureEnvironment();
		break;
	case 'build':
		build();
		break;
	case 'generate-seo-pages':
		generateSeoPages();
		break;
	case 'mount':
		mount();
		break;
	case 'mount-dry-run':
		mountDryRun();
		break;
	case 'firebase-ensure-prod':
		firebaseEnsureProd();
		break;
	case 'firebase-ensure-dev':
		firebaseEnsureDev();
		break;
	case 'gcloud-ensure-prod':
		gcloudEnsureProd();
		break;
	case 'gcloud-ensure-dev':
		gcloudEnsureDev();
		break;
	case 'firebase-deploy':
		firebaseDeploy();
		break;
	case 'set-config-last-deploy':
		await setConfigLastDeploy();
		break;
	case 'configure-qdrant':
		await configureQdrantCommand();
		break;
	case 'reindex-card-embeddings':
		await reindexCardEmbeddings();
		break;
	case 'cleanup-old-embeddings':
		await cleanupOldEmbeddings();
		break;
	case 'set-up-cors':
		setUpCors();
		break;
	case 'gcloud-backup': {
		gcloudEnsureProd();
		const msgIdx = args.indexOf('--message');
		const msg = msgIdx >= 0 ? args[msgIdx + 1] || '' : '';
		gcloudBackup(msg);
		break;
	}
	case 'gcloud-restore':
		gcloudEnsureDev();
		gcloudRestore();
		break;
	case 'gsutil-rsync-uploads':
		gsutilRsyncUploads();
		break;
	case 'firebase-delete-firestore-if-safe':
		firebaseEnsureDev();
		await firebaseDeleteFirestoreIfSafe();
		break;
	case 'warn-maintenance':
		warnMaintenance();
		break;
	case 'make-tag':
		makeTag();
		break;
	case 'push-tag':
		pushTag();
		break;
	case 'generate-favicon':
		await generateFaviconImpl(APP_TITLE);
		break;
	case 'inject-favicon-markups':
		await injectFaviconMarkupsImpl();
		break;
	case 'check-for-favicon-update':
		await checkForFaviconUpdateImpl();
		break;
		// Composite workflows
	case 'set-up-deploy':
		setUpDeploy();
		break;
	case 'dev-deploy':
		await devDeploy();
		break;
	case 'deploy':
		await deploy();
		break;
	case 'backup': {
		const msgIdx = args.indexOf('--message');
		const msg = msgIdx >= 0 ? args[msgIdx + 1] : undefined;
		await backup(msg);
		break;
	}
	case 'tag-release':
		tagRelease();
		break;
	case 'release':
		await release();
		break;
	case 'reindex':
		firebaseEnsureProd();
		await reindexCardEmbeddings(reindexCursorArg());
		break;
	case 'reindex:dev':
		firebaseEnsureDev();
		await reindexCardEmbeddings(reindexCursorArg());
		break;
	case 'reset-dev':
		await resetDev();
		break;
	default:
		console.error(`Unknown command: ${command}`);
		console.error('Run with --help to see available commands');
		process.exit(1);
	}
};

main().catch(err => {
	console.error(err);
	process.exit(1);
});
