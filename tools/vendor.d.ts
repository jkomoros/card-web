declare module 'prompts' {
	interface PromptObject {
		type: string;
		name: string;
		message: string;
		initial?: unknown;
	}
	function prompts(questions: PromptObject | PromptObject[]): Promise<Record<string, unknown>>;
	export = prompts;
}

declare module 'gulp-real-favicon' {
	interface GenerateFaviconParams {
		masterPicture: string;
		dest: string;
		iconsPath: string;
		design: unknown;
		settings: unknown;
		markupFile: string;
	}
	function generateFavicon(params: GenerateFaviconParams, callback: (err?: unknown) => void): void;
	function injectFaviconMarkups(htmlMarkups: string[]): NodeJS.ReadWriteStream;
	function checkForUpdates(currentVersion: string, callback: (err?: unknown) => void): void;
	export { generateFavicon, injectFaviconMarkups, checkForUpdates };
}

declare module 'rfg-api' {
	interface RfgApi {
		injectFaviconMarkups(
			fileContent: Buffer | string,
			htmlCode: string[],
			opts: object,
			callback: (err: unknown, html: string) => void
		): void;
	}
	function init(): RfgApi;
	export { init };
}
