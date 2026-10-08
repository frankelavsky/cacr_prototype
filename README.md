# NLC Child-Centered Governance dashboard, instructions for maintenance

`src/` is the whole site: plain HTML, CSS, and JavaScript with no build step and no runtime dependencies. Copy or serve that folder as-is, at the bare minimum (see bottom subsection for a little more details on copying/serving/using this repo).

## Updating the data

The main thing asked of me since making this has been "how will we be able to update the data down the road?"

Below are the different ways to update the data (manually or via github actions build process). It's relatively easy, but I also can't promise how things will go once this repo gets handed off, either. For now and for me, it's as simple as pasting in a new file and running a single line of code from the terminal. In the web team's environment, it could work entirely differently.

But what is happening here when "updating the data" is we are preparing the data that is given to us for use in our map and table online, which involves making sure the data can display on the map as well as use a format that can be opened in in JavaScript (an Excel file won't work by itself). So "updating the data" isn't referencing the fact that the research team has new data, but steps for the web (or equivalent) team to bring the new, updated data from the research team into this dashboard UI we've built.

Conceptually, we are converting from an Excel file into all the data we actually need for map/table rendering. There are basically two ways to make this happen (I prefer the first, but you do you):

### Manually updating

You need [Node.js](https://nodejs.org) 20 or newer. 

1. Clone the repo locally (assuming a copy of the repo has been made by your team already). Run `npm install` once. (It may report security warnings for the `xlsx` package but that package only reads the survey spreadsheet during the update and is not part of the published site.)
2. Put the new survey spreadsheet in `data/source/` and remove the old one. Filename is irrelevant but keep exactly one `.xlsx` file there. Its data must be on a sheet named `Database_Dataset`, with the same column names as before (annoying, but check this to make absolutely sure it is the same). **Note**: Do not simply add a spreadsheet of only-new responses and delete the old one. The new spreadsheet must also contain all the old responses that you still want to display and they must be all within the same sheet named `Database_Dataset`.
3. Run `npm run data`.
4. Read the summary it prints: cities added and removed, and the headline numbers before and after. Check that the changes are what you expect.
5. You may want to just check the `index.html` file in `src/` looks as expected (open it or run it in a local server, however you have this set up on your end).
6. Publish the updated `src/ccg-data.js` and `src/us-cities.json` (this is a push or PR to your own repo - see step 1, or this involves copy+pasting the files out into wherever they should live in your own ecosystem).

The spreadsheet's file name does not matter; the update uses whichever `.xlsx` is in `data/source/`. The same goes for the Census places file: any one file whose name contains `Gaz_place` and ends in `.txt` (currently `2025_Gaz_place_national.txt`). The two output files must keep their names, because the page loads them by name.

Practice names, definitions and "Learn more" links are in `data/source/practices.json`. Edit them there and run `npm run data`.

Numbers in the page text (such as how many cities were surveyed) update by themselves. Wording that describes findings, such as the "About this data" notes, should be re-read by a person after each update.

#### If the update stops

New data is not written when the update stops, and the message says what to fix:

- **Unexpected value** in a row and column: the spreadsheet has an answer the dashboard does not know, such as a new answer option or a typo. Fix the cell, or ask a developer to add the new option near the top of `scripts/build-data.mjs`.
- **Missing these columns**: a column was renamed or removed in the spreadsheet. Restore the original column name.
- **Could not be matched to the gazetteer**: the dashboard cannot find where a city is. Add an entry for it to `data/source/geo-overrides.json`, following the existing entries.
- **Duplicate city+state**: the same city appears twice in the spreadsheet.

### Updating via GitHub

If the repository is on GitHub (as it is now, or put back onto GitHub later), a pull request that changes `data/source/` with a new Excel file rebuilds the data automatically, adds the regenerated files to the pull request, and shows the summary
on the workflow run. This is because of .github/workflows and the update-data.yml file.

## Updating the interface

The HTML's content (aside from what is data-driven aka the map and table) primarily lives in `src/index.html`, however `data/source/practices.json` also contains information about the 5 practices, including links. If the links, definitions, or anything else changes, those are handled by directly editing that file. A new build will need to be run via `npm run data` or equivalent if the practices json file changes.

Now, the way the interface is built from the data is more complex than everything previously mentioned, but can be done by simply going into the `src/ccg-dashboard.js` file. All of the logic for rendering statically is handled there. This website isn't engineered as a rocketship and is intentionally built entirely via vanilla JS in order to make it as portable as possible into another ecosystem (if needed), or as a fast, performant little iframe.

## Using this repo

This repo can be used in a variety of ways. Currently it hosts as a link via github.io. However, it is likely that this prototype ecosystem isn't what is intended for the final form (this repo is managed by me, the consultant, and any future changes require governance through me, which I cannot maintain). This means that *at the very least* the files in `src/` will need to be moved elsewhere.

However, I recommend moving this whole repo into an equivalent GitHub repo that can be managed by the web team. Feel free to fork it or download it and make it your own. Having the whole repo allows you to build the data (see above section) as new data comes in, manage privacy/access, and so on.

In terms of getting the html/css/js from this repo's `src/` folder into some end format (Drupal or otherwise), you can either copy+paste the parent-most div or relevant parts within the HTML file into your own, and move the JS/CSS files into a sibling location (make note of path changes, of course), or you can keep the files in `src/` together and put them into their own repo that ends up hosted somewhere as an `<iframe>` you can place into your main site. The latter can be accomplished from the same repo you copy over that has everything in it (including the build process) or simply a repo of just these 5 files. Up to you all.

## Bigger changes in the future?

It's been discussed that we might want to do more with new data as it comes in: start drawing line charts, crunching numbers about change, and so on. That work is outside of the scope of the current dashboard and would require new visualizations and a new data build process. It's not a huge lift, so I'd be happy to discuss what that might look like down the road while still ensuring this is mobile friendly, fast-as-possible on low-bandwidth, and accessible for people with disabilities.