//The app shell's PUBLISHED entry module. index.TEMPLATE.html loads this name,
//tsc emits it for source serve (`npm start`), and rollup uses it as the bundle
//input so the built tree carries the same name — one name everywhere, which is
//what test/dev-serve pins.
//
//Why this stub exists at all: the entry must NOT be card-web-app.js. master's
//service worker precached that stable name and answers it cache-first, so a
//deploy that kept the name would hand returning clients the OLD bundle while
//the new service worker sat waiting — see the entry comment in
//rollup.config.js. The rename used to live only in rollup's entryFileNames,
//which left tsc emitting nothing under the published name and `npm start`
//booting to a blank page with a single 404.
import './card-web-app.js';
