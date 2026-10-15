# Building HuntBot — diagram sources

Source files for the images on the AI-generated **Building HuntBot** page
(`/projects/building-huntbot`, a `project` document in Prismic). The page is meant
to be updated as the site changes.

| File | Image on the page |
|---|---|
| `hero.html` | Highlight + meta image |
| `system-map.html` | "The system at a glance" |
| `life-of-a-message.html` | "Life of a message" (the chat pipeline) |
| `timeline.py` → `timeline.html` | "How HuntBot got here" (commits per month) |

## Updating

1. Edit the HTML (or the `ROWS` in `timeline.py` — get commit counts with
   `git log --format='%ad' --date=format:'%Y-%m' | sort | uniq -c`).
2. Run `./render.sh` (pass a Chromium path if `chromium` isn't on your PATH). It
   renders each file at 2x into a PNG next to it. Needs Python with Pillow.
3. Upload the new PNG to Prismic and swap it into the page's image slice, then
   update the text and the "Last updated" date in the AI-generated note at the top.

Styling lives in `_shared.css` and uses the site's own Favorit and EB Garamond
fonts from `src/lib/assets/fonts`, with the stone grays and the `mud` accent from
`tailwind.config.js`.
