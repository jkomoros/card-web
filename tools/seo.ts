import * as fs from 'fs';
import * as process from 'process';
import { FirebaseOptions } from 'firebase/app';

const CONFIG_PATH = 'config.SECRET.json';

type Config = {
	seo : boolean;
	firebase: {
		prod: FirebaseOptions,
		dev: FirebaseOptions
	} | FirebaseOptions;
};

const run = () => {
	const file = fs.readFileSync(CONFIG_PATH).toString();
	const json = JSON.parse(file) as Config;
	if (!json.seo) {
		console.log('SEO mode is not enabled in config');
		process.exit(0);
	}
	console.log('SEO mode is enabled in config');
};

(async() => {
	run();
})();

