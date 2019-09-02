# complexity-compendium
This project is the webapp that powers https://thecompendium.cards

The project is messy, with lots of intricate details and designs captured as a messy collection of issues. This is to [minimize my activation energy](https://thecompendium.cards/c/incremental-work-minimizes-activation-cost) for this hobby project, but it might be overwhelming for others. Nevertheless, please feel free to comment and participate!

## New webapp

### Developing

`polymer serve`

### Deploying
`gulp deploy`

If you want to also tag release and backup (recommended), run:

`gulp release`

### Backing up

Instructions are here: https://firebase.google.com/docs/firestore/manage-data/export-import (see that for initial set up)

Run `gcloud config set project complexity-compendium`

Run `gcloud beta firestore export gs://complexity-compendium-backup`

Also can just run `gulp backup`

### Restoring a back up

Every so often it makes sense to reset the dev database with the most recent prod backup.

Do that with `gulp reset-dev`.

That does some combination of the following:

Run `gcloud config set project dev-complexity-compendium` (if running in devmode)

Run `gcloud beta firestore import gs://complexity-compendium-backup/[EXPORT_PREFIX]/` where EXPORT-PREFIX is the name of the folder you want to import.

### Setting up a new computer

`npm install -g firebase-tools`

`npm install`


### Setting up a new deployment
Currently a number of things are hard-coded (see #164 for more).

The function that sends e-mails to admins requires set-up.

First, get an account with Postmark and set it up. Then configure the config with:

```
firebase use <NAME-OF-PROJECT>
firebase functions:config:set postmark.key="YOUR-SECRET-KEY-HERE"
firebase functions:config:set email.to="emailaccountyouwantalertssentto@gmail.com"
firebase functions:config:set email.from="emailaccountitshouldcomefrom@gmail.com"
```

Note that you'll have to do this both the dev and prod servers, by using the different names of projects in the first line. 

### Design

The compendium-app reads from the URL and then calls navigate() based on it. Navigate figures out which view needs to be ensured it is loaded, and then sets state.app.page to that viewer, state.app.location to the entire location, and state.app.pageExtra to the stuff after the first part of page, so e.g. '/c/this-stuff-is/included-in-page-extra'.

That then causes card-view to be activated, with a different page-extra, which it then tells the store to show a specific card. It also checks to ensure that the URL showing is the actual card name; if not it silently updates it.

When you want to navigate to a card, you use actions/navigateToCard, which uses history.pushState, and then calls the router to extract out the URL and operate.
