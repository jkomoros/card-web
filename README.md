# complexity-compendium
This project is the webapp that powers https://thecompendium.cards

The project is messy, with lots of intricate details and designs captured as a messy collection of issues. This is to [minimize my activation energy](https://thecompendium.cards/c/incremental-work-minimizes-activation-cost) for this hobby project, but it might be overwhelming for others. Nevertheless, please feel free to comment and participate!

## New webapp

### Developing

`polymer serve`

### Deploying
`polymer build`
`firebase use complexity-compendium`
`firebase deploy`

Do a backup (descrbied in next section)

`git tag deploy-2018-12-31-1` (where last number is the number of deploys today)
`git push origin deploy-2018-12-31-1`

### Backing up

Instructions are here: https://firebase.google.com/docs/firestore/manage-data/export-import (see that for initial set up)

Run `gcloud config set project complexity-compendium`

Run `gcloud beta firestore export gs://complexity-compendium-backup`

### Restoring a back up

Run `gcloud config set project dev-complexity-compendium` (if running in devmode)

Run `gcloud beta firestore import gs://complexity-compendium-backup/[EXPORT_PREFIX]/` where EXPORT-PREFIX is the name of the folder you want to import.

### Setting up a new computer

`npm install -g firebase-tools`

`npm install`

### Design

The compendium-app reads from the URL and then calls navigate() based on it. Navigate figures out which view needs to be ensured it is loaded, and then sets state.app.page to that viewer, state.app.location to the entire location, and state.app.pageExtra to the stuff after the first part of page, so e.g. '/c/this-stuff-is/included-in-page-extra'.

That then causes card-view to be activated, with a different page-extra, which it then tells the store to show a specific card. It also checks to ensure that the URL showing is the actual card name; if not it silently updates it.

When you want to navigate to a card, you use actions/navigateToCard, which uses history.pushState, and then calls the router to extract out the URL and operate.
