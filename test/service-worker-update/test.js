/*eslint-env node*/

import assert from 'assert';
import fs from 'fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('service-worker update safety', () => {
	it('never reloads directly from the registration bootstrap', () => {
		const template = read('index.TEMPLATE.html');
		const registrationBlock = template.slice(template.indexOf('/* SERVICE-WORKER-START*/'), template.indexOf('/* SERVICE-WORKER-END */'));
		assert.doesNotMatch(registrationBlock, /location\.reload\(\)/);
		assert.doesNotMatch(registrationBlock, /reg\.waiting\s*\|\|\s*!navigator\.serviceWorker\.controller/);
		assert.match(registrationBlock, /card-web-service-worker-update/);
	});

	it('waits for an explicit application activation message', () => {
		const config = read('workbox-config.cjs');
		assert.match(config, /skipWaiting:\s*false/);
		assert.match(config, /maximumFileSizeToCacheInBytes:\s*5\s*\*\s*1024\s*\*\s*1024/);
		const app = read('src/components/card-web-app.ts');
		assert.match(app, /selectEditingCardHasUnsavedChanges/);
		assert.match(app, /selectPendingModificationCount/);
		assert.match(app, /inFlightMutationCount/);
		assert.match(app, /BroadcastChannel/);
		assert.match(app, /controllerchange/);
		assert.match(app, /postMessage\(\{type: 'SKIP_WAITING'\}\)/);
		assert.match(app, /beforeunload/);
	});

	it('regenerates SEO shells before the build copies them into hosting output', () => {
		const cli = read('tools/cli.ts');
		for (const workflowName of ['devDeploy', 'deploy']) {
			const start = cli.indexOf(`const ${workflowName} =`);
			const end = cli.indexOf('\n};', start);
			const workflow = cli.slice(start, end);
			assert.ok(start >= 0 && end > start);
			assert.ok(workflow.indexOf('generateSeoPagesOptionally();') < workflow.indexOf('build();'));
		}
	});
});
