import * as fs from 'fs';
import * as process from 'process';
import { exec } from 'child_process';
import { FirebaseOptions } from 'firebase/app';

const CONFIG_PATH = 'config.SECRET.json';

type FirebaseProdDevOptions = {
	prod?: FirebaseOptions,
	dev?: FirebaseOptions
};

type Config = {
	seo : boolean;
	firebase: FirebaseProdDevOptions | FirebaseOptions;
};

const runCommand = async (command : string) : Promise<string> => {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout.trim());
		});
	});
};

const selectedProjectID = async () : Promise<string> => {
	//Oddly enough firebase use I guess does something special for stderr and
	//stdout, because this just returns the direct project ID.
	const result = await runCommand('firebase use');
	return result;
};

const getFirebaseConfig = async (config : Config) : Promise<FirebaseOptions> => {
	if (!config.firebase) throw new Error('No firebase property');
	if ('apiKey' in config.firebase) {
		return config.firebase;
	}
	const fb = config.firebase as FirebaseProdDevOptions;
	const prod = fb.prod;
	const dev = fb.dev;
	//We need to detect whether to use the prod or dev config.
	if (!prod && dev) return dev;
	if (!dev && prod) return prod;
	if (!dev && !prod) throw new Error('No sub configs provided');
	//We have both prod and dev and need to select which one to use.
	const projectID = await selectedProjectID();
	if (prod?.projectId == projectID) return prod;
	if (dev?.projectId == projectID) return dev;
	throw new Error(`Neither prod nor dev options matched projectid ${projectID}`);
};

const run = async () => {
	const file = fs.readFileSync(CONFIG_PATH).toString();
	const json = JSON.parse(file) as Config;
	if (!json.seo) {
		console.log('SEO mode is not enabled in config');
		process.exit(0);
	}
	const firebaseConfig = await getFirebaseConfig(json);
	//TODO: actually fetch the items
	console.log(firebaseConfig);
};

(async() => {
	run();
})();

