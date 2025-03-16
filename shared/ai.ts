import {
	AIModelName
} from './types.js';


type modelProvider = 'openai' | 'anthropic';

type modelInfo = {
	maxTokens: number,
	provider: modelProvider
};

export const MODEL_INFO : {[name in AIModelName]: modelInfo} = {
	'gpt-4o': {
		maxTokens: 128000,
		provider: 'openai'
	},
	'claude-3-7-sonnet-latest': {
		maxTokens: 200000,
		provider: 'anthropic'
	}
};

export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-7-sonnet-latest';