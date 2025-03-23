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

export interface TokenizerImplementation {
	computeTokens: (text: string | string[]) => Promise<number>;
}

type providerInfo = {
	tokenizer: TokenizerImplementation
}

export const PROVIDER_INFO: {[provider in modelProvider]: providerInfo} = {
	'openai': {
		tokenizer: {
			computeTokens: async (_text: string | string[]) => {
				throw new Error('OpenAI tokenizer not installed.');
			}
		}
	},
	'anthropic': {
		tokenizer: {
			computeTokens: async (text: string | string[]) => {
				// A more accurate conservative client-side estimate for Anthropic token count
				// Claude's tokenizer (based on BPE) is similar to OpenAI's but with some differences
				// This method uses the following heuristics for a conservative estimate:
				// - Whitespace and punctuation are usually 1 token each
				// - Common English words are often 1 token
				// - Longer words are typically broken into multiple tokens
				// - Non-ASCII characters often consume more tokens
				// - The ratio is typically 0.4 tokens per character for English text (higher than OpenAI's 0.25-0.3)
				// - We'll use 0.5 tokens per character as a conservative estimate
				
				if (typeof text === 'string') text = [text];
				
				let totalTokens = 0;
				
				for (const str of text) {
					// Count characters
					const charCount = str.length;

					// Count whitespace (spaces, tabs, newlines)
					const whitespaceCount = (str.match(/\s/g) || []).length;

					// Count punctuation
					const punctuationCount = (str.match(/[.,!?;:'"()[\]{}]/g) || []).length;

					// Count non-ASCII characters (which typically use more tokens)
					// eslint-disable-next-line no-control-regex
					const nonAsciiCount = (str.match(/[^\x00-\x7F]/g) || []).length;
					
					// Base token estimate: characters * 0.5 (conservative ratio for English text)
					let tokenEstimate = charCount * 0.5;
					
					// Add extra for non-ASCII characters (they often use more tokens)
					tokenEstimate += nonAsciiCount * 0.5;
					
					// Ensure we count at least one token per whitespace/punctuation
					// (this helps account for token boundaries at these points)
					tokenEstimate = Math.max(tokenEstimate, whitespaceCount + punctuationCount);
					
					totalTokens += Math.ceil(tokenEstimate);
				}
				
				// Add a 10% safety margin for any edge cases
				return Math.ceil(totalTokens * 1.1);
			}
		}
	}
};


export const DEFAULT_OPENAI_MODEL = 'gpt-4o';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-3-7-sonnet-latest';

export const CARD_SEPARATOR = '\n-----\n';