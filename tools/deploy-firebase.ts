import { runSync } from './util.js';

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
		runSync('firebase', ['deploy']);
		return;
	}

	const target = 'hosting,storage,firestore,functions:' + baseFunctions.join(',functions:');
	runSync('firebase', ['deploy', '--only', target]);
};
