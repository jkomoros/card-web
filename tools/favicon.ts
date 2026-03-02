import fs from 'fs';
import { createRequire } from 'module';

// gulp-real-favicon provides generateFavicon and checkForUpdates with callback APIs
// that don't actually need gulp streams.
import realFavicon from 'gulp-real-favicon';

const require = createRequire(import.meta.url);

const FAVICON_DATA_FILE = 'favicon_data.json';

interface FaviconData {
	version: string;
	favicon: {
		html_code: string[];
	};
}

const readFaviconData = (): FaviconData => {
	return JSON.parse(fs.readFileSync(FAVICON_DATA_FILE).toString()) as FaviconData;
};

export const generateFavicon = (appTitle: string): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		realFavicon.generateFavicon({
			masterPicture: 'logo.svg',
			dest: 'images/',
			iconsPath: '/images',
			design: {
				ios: {
					pictureAspect: 'backgroundAndMargin',
					backgroundColor: '#ffffff',
					margin: '14%',
					assets: {
						ios6AndPriorIcons: false,
						ios7AndLaterIcons: false,
						precomposedIcons: false,
						declareOnlyDefaultIcon: true
					}
				},
				desktopBrowser: {
					design: 'raw'
				},
				windows: {
					pictureAspect: 'whiteSilhouette',
					backgroundColor: '#603cba',
					onConflict: 'override',
					assets: {
						windows80Ie10Tile: false,
						windows10Ie11EdgeTiles: {
							small: false,
							medium: true,
							big: false,
							rectangle: false
						}
					}
				},
				androidChrome: {
					pictureAspect: 'shadow',
					themeColor: '#ffffff',
					manifest: {
						name: appTitle,
						display: 'standalone',
						orientation: 'notSet',
						onConflict: 'override',
						declared: true
					},
					assets: {
						legacyIcon: false,
						lowResolutionIcons: false
					}
				},
				safariPinnedTab: {
					pictureAspect: 'silhouette',
					themeColor: '#5e2b97'
				}
			},
			settings: {
				scalingAlgorithm: 'Mitchell',
				errorOnImageTooSmall: false,
				readmeFile: false,
				htmlCodeFile: false,
				usePathAsIs: false
			},
			markupFile: FAVICON_DATA_FILE
		}, (err: unknown) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
};

export const injectFaviconMarkups = (): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		const faviconData = readFaviconData();
		const htmlMarkups: string[] = faviconData.favicon.html_code;
		const fileContent = fs.readFileSync('index.html');

		// Use rfg-api directly — the gulp-real-favicon injectFaviconMarkups
		// returns a gulp stream, but rfg-api exposes a callback-based version.
		const rfg = require('rfg-api').init();
		rfg.injectFaviconMarkups(fileContent, htmlMarkups, {}, (err: unknown, html: string) => {
			if (err) {
				reject(err);
				return;
			}
			fs.writeFileSync('index.html', html);
			resolve();
		});
	});
};

export const checkForFaviconUpdate = (): Promise<void> => {
	return new Promise<void>((resolve, reject) => {
		const currentVersion = readFaviconData().version;
		realFavicon.checkForUpdates(currentVersion, (err: unknown) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
};
