import * as fs from 'fs';

const CONFIG_PATH = 'config.SECRET.json';

const run = () => {
	const file = fs.readFileSync(CONFIG_PATH).toString();
	const json = JSON.parse(file);
	console.log(json);
};

(async() => {
	run();
})();

