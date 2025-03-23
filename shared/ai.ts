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
			computeTokens: async (text: string | string[]) => {
				// Conservative token estimation for OpenAI models
				// Using a character-based heuristic that errs on the side of overestimation
				// OpenAI tokenizers typically yield about 0.25-0.30 tokens per character for English text
				// We'll use 0.4 tokens per character as a conservative estimate
				
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
					
					// Base token estimate: characters * 0.4 (conservative ratio for English text)
					let tokenEstimate = charCount * 0.4;
					
					// Add extra for non-ASCII characters (they often use more tokens)
					tokenEstimate += nonAsciiCount * 0.5;
					
					// Ensure we count at least one token per whitespace/punctuation
					tokenEstimate = Math.max(tokenEstimate, whitespaceCount + punctuationCount);
					
					totalTokens += Math.ceil(tokenEstimate);
				}
				
				// Add a 15% safety margin (OpenAI's tokenizer can vary more than Anthropic's)
				return Math.ceil(totalTokens * 1.15);
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
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL;

export const CARD_SEPARATOR = '\n-----\n';

type FitPromptArguments = {
	prefix?: string,
	delimiter?: string,
	items?: string[],
	suffix?: string,
	//if this is not defined but modelName is, will use the type for modelName.
	maxTokenLength?: number,
	modelName? : AIModelName
};

const DEFAULT_FIT_PROMPT : Required<Omit<FitPromptArguments, 'maxTokenLength'>> = {
	prefix: '',
	delimiter: CARD_SEPARATOR,
	items: [],
	suffix: '',
	modelName: DEFAULT_MODEL,
};

const computeTokenCount = async (text : string | string[], model : AIModelName) : Promise<number> => {
	const modelInfo = MODEL_INFO[model];
	if (!modelInfo) throw new Error('Unknown model: ' + model);
	const providerInfo = PROVIDER_INFO[modelInfo.provider];
	if (!providerInfo) throw new Error('Unknown provider: ' + modelInfo.provider);
	return providerInfo.tokenizer.computeTokens(text);
};

export const fitPrompt = async (args: FitPromptArguments) : Promise<[prompt: string, maxItemIndex : number]> => {
	const options = {
		...DEFAULT_FIT_PROMPT,
		...args
	};
	if (options.maxTokenLength === undefined) {
		options.maxTokenLength = options.modelName ? MODEL_INFO[options.modelName].maxTokens : 4000;
	}
	const modelName = options.modelName || DEFAULT_MODEL;
	const nonItemsTokenCount = await computeTokenCount([options.prefix, options.suffix, options.delimiter], modelName);
	let itemsTokenCount = 0;
	let result = options.prefix + options.delimiter;
	let i = 0;
	while ((itemsTokenCount + nonItemsTokenCount) < options.maxTokenLength) {
		if (options.items.length <= i) break;
		const item = options.items[i];
		itemsTokenCount += await computeTokenCount([item, options.delimiter], modelName);
		if ((itemsTokenCount + nonItemsTokenCount) >= options.maxTokenLength) break;
		result += item + options.delimiter;
		i++;
	}
	result += options.suffix;
	return [result, i];
};