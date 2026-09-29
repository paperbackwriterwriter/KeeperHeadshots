# Keeper Headshots

See README.md for how the app works and how to run it.

## QA passes

A QA pass is not finished until the layout has been checked at phone sizes:

1. Run `bash scripts/dev/layout-ci.sh chromium <outDir>` (see README, "Layout audit"). The "Layout" GitHub workflow also runs it in Chromium and WebKit on every push to main; check its result, and its screenshot artifact, after each deploy. Fix everything it reports, or confirm it's a false alarm and correct the audit so it stops reporting it.
2. Look at every screenshot in `<outDir>/shots` at both 390 and 1280px, section by section; crop tall pages rather than skimming them. Check especially:
   - items in a row that are unevenly spaced or skewed to one side;
   - one item wrapped alone onto its own line;
   - buttons in a group at different sizes, or not filling their row;
   - text cut off or squeezed one word per line;
   - cards in a row at different heights.
3. Run `bash scripts/dev/ci.sh`.

After changing a landing page's markup, regenerate the prerendered HTML: `BASE=http://localhost:PORT npm run -s prerender`.
