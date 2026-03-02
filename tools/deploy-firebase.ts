import { spawnSync } from 'child_process';

type DeployFlags = {
	openaiEnabled: boolean;
	anthropicEnabled: boolean;
	enableTwitter: boolean;
};

export const deployFirebase = (flags: DeployFlags): void => {
	const baseFunctions = [
		'emailAdminOnMessage',
		'emailAdminOnStar',
		'legal'
	];

	if (flags.openaiEnabled) {
		baseFunctions.push(
			'openai',
			'updateCardEmbedding',
			'reindexCardEmbeddings',
			'similarCards',
			'semanticSort'
		);
	}

	if (flags.anthropicEnabled) {
		baseFunctions.push('anthropic');
	}

	if (flags.openaiEnabled || flags.anthropicEnabled) {
		baseFunctions.push('cleanupOldEmbeddings');
	}

	if (flags.openaiEnabled || flags.anthropicEnabled) {
		baseFunctions.push('chat');
	}

	if (flags.enableTwitter) {
		runCommand('firebase deploy');
		return;
	}

	const deployCmd = 'firebase deploy --only hosting,storage,firestore,functions:' + baseFunctions.join(',functions:');
	runCommand(deployCmd);
};

const runCommand = (cmd: string): void => {
	console.log('Running ' + cmd);
	const parts = cmd.split(' ');
	const result = spawnSync(parts[0], parts.slice(1), { stdio: 'inherit' });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`Command failed with exit code ${result.status}`);
};
