# Qinglin Xun - Homepage

Personal homepage for Qinglin Xun, hosted with GitHub Pages at
[ql-xun.github.io](https://ql-xun.github.io/).

## Local preview

```bash
python -m http.server 8080
```

Then open `http://127.0.0.1:8080/`.

## Updating the site

- Main page: `index.html`
- Hobbies page: `hobbies.html`
- Thoughts page: `thoughts.html`
- Styles: `assets/css/site.css`
- Language and content loader: `assets/js/site.js`
- Profile photo: `images/Qinglin.png`
- Hobbies data: `content/hobbies.json`
- Thoughts data: `content/thoughts.json`
- Downloadable CV: `cv/Qinglin-Xun-CV.pdf`
- Content editing instructions: `CONTENT_GUIDE.md`
- GitHub Pages workflow: `.github/workflows/static.yml`

The Hobbies and Thoughts pages are data-driven so they can be updated
without editing page markup. Copy the valid examples in `content/examples/`
and follow `CONTENT_GUIDE.md`. Hobbies can also contain responsive photo
galleries grouped by location, with the location and year shown beneath each
photograph.

The page is based on the open-source
[Academic Homepage Template](https://github.com/w-r-s/academic-homepage-template).
