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
		//calculateIDF was DELETED from source (the worker now computes IDF over
		//the visible corpus; docs/visible-corpus-idf-design.md) — but omitting a
		//function from a deploy does NOT undeploy it: any project where it is
		//already live keeps running it (and keeps its IAM surface) until it is
		//removed explicitly. It must be deleted with
		//`firebase functions:delete calculateIDF` on BOTH projects (dev and
		//prod).
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
