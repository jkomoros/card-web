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
		//NOTE: omitting a function from a deploy does NOT undeploy it — a live
		//function keeps running (schedule, IAM surface and all) until removed
		//explicitly. When calculateIDF left this list (the worker now computes
		//IDF over the visible corpus; docs/visible-corpus-idf-design.md), the
		//live copy was removed with `firebase functions:delete calculateIDF`
		//on both projects on 2026-08-15. Follow the same two steps for any
		//future removal.
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
