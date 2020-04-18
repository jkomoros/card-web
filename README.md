# Card Web
This project is the webapp that powers https://thecompendium.cards

The project is messy, with lots of intricate details and designs captured as a messy collection of issues. This is to [minimize my activation energy](https://thecompendium.cards/c/incremental-work-minimizes-activation-cost) for this hobby project, but it might be overwhelming for others. Nevertheless, please feel free to comment and participate!

The app currently has a number of constants and configuration that are spedcific
to the production instance hard-coded. If you have any interest in standing up an instance on your own, issue #164 tracks the work to make it fully general. Please chime in there and I'll prioritize that work!

## Getting set up

### First Run

Download this repository and cd into it.

Run `npm install` to install all of the dependencies.

Run `npm install -g firebase-tools`

Run `cp config.SAMPLE.json config.SECRET.json`

Go to https://console.firebase.google.com. Create a new project. On the project overview, where it says "Get started by adding Firebase to your app", tap the web icon.  Give it a nickname. Tap set up. In the code snippet that appears, copy the JSON blob that is assigned to the `firebaseConfig` variable.

Paste that JSON blob in your `config.SECRET.json` file, where the sample "firebase" value is. You might have to change the formatting to make it valid JSON.

Run `gulp inject-config`. This copies the config you just set into various static files in the project.

Go back to the Firebase console. Go to the project overview for your app. Tap the Database item in the navigation to the right. Tap 'Create Database'. Choose Production Mode. Tap next. Pick the location (the default is fine for US). Tap Done.

In the navigation to the right, go to Authentication. Tap 'Set up sign-in method'. Next to the Google row, tap the edit icon. **Toggle the Enable toggle**. Give the project a descriptive name and pick an email. (You can change these both later). Hit Save.

Run `gulp set-up-deploy`

Run `npm run start` to run the server.

Visit https://localhost:8081/maintenance in your browser.

On the page that loads, tap the button that says "Sign in with your Google account". **Sign in with the account you want to be the super-user admin for the web app**.

You now must configure the app so that that user is an admin.

Go to https://console.firebase.google.com. Go to the Authentication tab. You should see a single row with your username. Copy the User UID (the copy button next to it will copy it for you without whitespace).

Now go to the database tab. Tap 'Start Collection'. Name it `permissions` and hit next. Into the Document ID field, paste your uid you copied in the last step. Add a field called `admin`, set it to Boolean, and leave the value as true.

Load https://localhost:8081/maintenance again in your browser. You should see a number of buttons. Tap **Initial SetUp**.

Once it completes, tab the 'About' tab. You're now set up, and can start editing the starter cards that were added in each section!

### Config

config.SECRET.json is where most of the configuration for your webapp. There's a
sample one at config.SAMPLE.json. Copy it over:

`cp config.SAMPLE.json config.SECRET.json`

That file shouldl never be committed. The `.gitignore` file will help prevent
you from accidentally committing it.

That config file has to be injected and copied to lots of static files. To do
that, run:

`gulp inject-config`

That will create a number of files throughout the repo (all excluded from commits via `.gitignore`) for the proper functioning of the webapp. **Re-run gulp inject-config every time you change that config file**

See the section entitled **Config file keys** for more on the different keys and how they're interpreted.

## Config file keys

### firebase

The firebase key is where you put the firebase config.

If you only have a prod configuration, you can just put the config right here.

If you have a prod and dev sub configuration, then you can have two sub keys,
firebase.dev and firebase.prod, each of which have their own config.

### firebase.dev

This is where your firebase project config should go for the dev version of the project. This is the 'staging' server with throw-away data.

### firebase.prod

This is where your firebase project config should go for the prod version of the project, with real data and visible to the world.

### app_title

The name of your app, to show up in the titlebar of the web page, the web app
header, and in the manifest. If the string starts with 'The ' then the The will
be rendered a lighter color in the header.

### twitter_handle (optional)

If you have a twitter bot configured, the handle of the bot (not including @). Emits metadata in index.html, but also used as a signal for whether the cloud functions related to twitter bots need to be deployed (they require billing to be enabled).

### backup_bucket_name (optional)

The name of the bucket within google cloud storage to store and retrieve buckets from.

You need to create this bucket within your project. (If you have both dev and
prod projects it should be within the prod project).

Required if you want to backup or restore a backup

## Deploying
`gulp release`

## Backing up

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

## Favicons

When logo.svg has changed, run `gulp generate-favicon`. Then merge the values in images/site.webmanifest into /manifest.json

TODO: make the manifest.json output be merged automatically in that flow

When index.html has changed, run `gulp inject-favicon-markups`, then manually change the point to the manifest ot be to `manifest.json` instead of `/images/site.webmanifest`

TODO: make the favicon injection be part of the build flow

## Setting up a new deployment
Currently a number of things are hard-coded (see #164 for more).

The function that sends e-mails to admins requires set-up.

First, get an account with Postmark and set it up. Then configure the config with:

```
firebase use <NAME-OF-PROJECT>
firebase functions:config:set postmark.key="YOUR-SECRET-KEY-HERE"
firebase functions:config:set email.to="emailaccountyouwantalertssentto@gmail.com"
firebase functions:config:set email.from="emailaccountitshouldcomefrom@gmail.com"
firebase functions:config:set site.domain="thecompendium.cards"
```

If you also want to set up auto-tweeting, you'll need to set additional values,
with the values for your app (generated from the specific bot account you want
to tweet from) from here: https://developer.twitter.com/en/apps
```
firebase functions:config:set twitter.consumer_key="YOUR-SECRET-KEY"
firebase functions:config:set twitter.consumer_secret="YOUR-SECRET-KEY"
firebase functions:config:set twitter.access_token_key="YOUR-SECRET-KEY"
firebase functions:config:set twitter.access_token_secret="YOUR-SECRET-KEY"
```
If your firebase project name starts with `dev-` or ends with `-dev` then it
will update the db and pretend like it tweeted, but not actually post anything
to twitter.

Note that you'll have to do this both the dev and prod servers, by using the different names of projects in the first line. 

To send a tweet outside of the normal schedule, load up the Firebase functions console, tap the three dots next to the autoTweet function, choose View in Cloud Scheduler, and hit 'Run Now'.

## Design

The card-web-app reads from the URL and then calls navigate() based on it. Navigate figures out which view needs to be ensured it is loaded, and then sets state.app.page to that viewer, state.app.location to the entire location, and state.app.pageExtra to the stuff after the first part of page, so e.g. '/c/this-stuff-is/included-in-page-extra'.

That then causes card-view to be activated, with a different page-extra, which it then tells the store to show a specific card. It also checks to ensure that the URL showing is the actual card name; if not it silently updates it.

When you want to navigate to a card, you use actions/navigateToCard, which uses history.pushState, and then calls the router to extract out the URL and operate.
