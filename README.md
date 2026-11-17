# Legend

Legend is a desktop catalogue for photographs exported from Lightroom Classic. Lightroom does the editing. Legend records what each photo is, where it was taken, which shoot it belongs to, and how it is classified. In a later version it will export that record as JSON for the websites.

Legend never changes an image file. It only reads them.

## Version 0.1: what works

- **Libraries.** You can create and open a library. Every change is saved straight away. The library takes a backup daily, before upgrades, and before any edit to more than 500 photos. It keeps the last 30 backups. You can also export the whole catalogue to a JSON backup.
- **Import.** You import a folder of exported JPEGs, optionally with subfolders. Photos are matched by raw key, so importing again never loses your work. A re-exported file keeps all its fields.
- **Variants.** Legend asks you to choose when two files share a raw key.
- **Seeding from Lightroom.** On first import, a photo's title, caption, rating, keywords, GPS position and capture time come from its embedded data. Keyword roots are mapped: Gallery goes to Keywords, Stories to Story, Fieldcraft to Technique. The Country, State, City and Location fields fill the Location hierarchy.
- **Views.** There are grid, table and single views. Thumbnails and previews are cached and made in the background.
- **Finding photos.**
  - Filter columns where each column can be any hierarchy, the shoot, year, month, time of day, rating, status, camera or lens. The columns narrow each other.
  - Text search, filters for missing fields, flags and minimum rating.
  - Sort and group by any hierarchy level.
  - Saved filters.
- **Inspector.** You can edit one photo or many. When editing many, a field shows "Multiple values" if the photos differ. Text fields can be replaced, added to at the start or end, or edited with find and replace.
- **Copy and paste fields.** A checklist chooses which fields to paste. "Paste again" repeats the last choice.
- **Undo and redo.** Every action is one undo step, including bulk edits. Each photo keeps a history of its changes.
- **Hierarchies.** There is a general engine plus an explorer where you can rename, drag to move, merge, retire, set alternate names, add descriptions and map positions, and import or export a text outline. There is also a cross view (one hierarchy against another, showing counts) and a tidy-up report.
- **Shoots and naming.** You can create shoots and subgroups and assign names (MALM-00001). Codes and IDs are never reused. A name registry screen shows them all and exports to CSV.
- **Map.** You can drag pins, place a whole selection with one click, type or paste coordinates, restore the camera position, and use a location entry's position. Legend suggests the nearest location entry. Subgroup anchors are shown and can be dragged.

## Not yet built (next round)

Ready checks, sites, the JSON export for websites, the "Check library" tool, restoring from a JSON backup, and splitting a shoot by time gaps.

## Installing on Windows

Run `Legend-Setup-x.y.z.exe`. It installs for your user only, so no administrator rights are needed. It adds a desktop shortcut and a Start menu entry.

Every push of a version tag (for example `v0.1.0`) to GitHub builds the installer automatically on a Windows machine. The installer is attached to the release under **Releases**. You can also run the build by hand from the **Actions** tab ("Build Windows installer", then "Run workflow").

## Building it yourself (optional)

You need Node.js 22 or newer. In a terminal in this folder:

```
npm install
npm run dist
```

The installer appears in the `dist` folder.

## Where things are stored

| What | Where |
|---|---|
| The catalogue | `library.sqlite` inside the library folder you chose (for example `Photos.legendlib`) |
| Thumbnails and previews | `thumbs` inside the library folder |
| Automatic backups | `backups` inside the library folder |
| Logs (imports, errors) | `logs` inside the library folder |
| Window size, panel layout, recent libraries | your Windows user profile (`%APPDATA%\Legend`) |
| Image files | wherever Lightroom exported them. Legend stores their paths |

The library format carries a version number. A newer Legend upgrades an older library automatically, taking a backup first. Upgrades only add to the catalogue and never remove anything.

## Development

```
npm run dev        # run with live reload
npm test           # automated tests, including the 100,000-photo speed checks
npm run typecheck
```

The code is laid out as follows:

- `src/main`: the database, import, thumbnails and the request handlers.
- `src/renderer`: the interface.
- `src/shared`: types used by both.
