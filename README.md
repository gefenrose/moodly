# שורה ביום — PWA

A Hebrew, right-to-left daily journal for one short line and an optional photo, with separate lowest/highest mood ratings for the same day, habit check-ins, weight entries, and trend graphs.

## Use on iPhone

Open the published page in Safari, tap **Share → Add to Home Screen**, then open it from the new icon. It works offline after the first load.

## GitHub Pages

This repository includes a GitHub Actions workflow that publishes the static app from `site/`. In the repository settings, choose **Settings → Pages → Build and deployment → GitHub Actions**. After a merge to `main`, the app will be available at:

`https://gefenrose.github.io/moodly/`

## Privacy and storage

Journal entries and photos are stored locally in the browser on this device. They are not uploaded to GitHub or a server, and they do not sync between devices. Clearing Safari's website data can remove the journal, so keep that in mind before clearing browser storage.
