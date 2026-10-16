# שורה ביום — PWA

A Hebrew, right-to-left daily journal for one short line and an optional photo, with separate lowest/highest mood ratings for the same day, habit check-ins, weight entries, and trend graphs.

## Install on your phone

Open the published page in the browser below, then add it to your home screen. It works offline after the first load.

- **iPhone:** Open in Safari, tap **Share → Add to Home Screen**, then tap **Add**.
- **Android:** Open in Chrome, tap **⋮ → Install app** or **Add to Home screen**, then confirm.

## Export and import

Use **הורדת גיבוי** at the bottom of the app to save a JSON backup containing journal entries, mood ratings, habits, weight records, and photos. On another device, open the app and choose **ייבוא מקובץ**. Import adds new dates and replaces entries on matching dates, including their photos; other dates remain untouched. Keep the backup somewhere safe if you want to move the journal between devices.

## GitHub Pages

This repository includes a GitHub Actions workflow that publishes the static app from `site/`. In the repository settings, choose **Settings → Pages → Build and deployment → GitHub Actions**. After a merge to `main`, the app will be available at:

`https://gefenrose.github.io/moodly/`

## Privacy and storage

Journal entries and photos are stored locally in the browser on this device. They are not uploaded to GitHub or a server, and they do not sync between devices unless you choose to move a backup file. Clearing browser data can remove the journal, so keep a backup before clearing it.
