// Which build this code *is*, as opposed to which build the host is offering.
//
// The two can differ, and that is the whole point of this file: a browser or a
// service worker can still be running yesterday's JavaScript while the server
// happily reports today's version. GitHub Pages serves everything with
// `max-age=600` and no revalidation, so there is a ten-minute window after
// every deploy where a phone runs old code — and the build line on the menu,
// which reads version.json with `cache: "no-store"`, was showing the new
// number the whole time. Comparing the two is what catches it.
//
// tools/build-static.mjs rewrites the string below when it publishes. "dev"
// means nobody stamped it: running from the repo or served by the Node server,
// where there is nothing to compare against.
export const BUILD = "dev";
