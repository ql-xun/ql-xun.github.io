# Hobbies and Thoughts content guide

The homepage reads the two editable data files below:

- `content/hobbies.json`
- `content/thoughts.json`

Both files must contain a JSON array. An empty array (`[]`) keeps the section visible and displays a neutral “Content coming soon / 内容待补充” message.

## Add a hobby

1. Open `content/examples/hobbies.example.json`.
2. Copy the object between `{` and `}` into the array in `content/hobbies.json`.
3. Replace the English and Chinese title and description.
4. If an image is needed, place it in `images/hobbies/` and update `image`.
5. Leave `image` empty (`""`) when no image is needed. In that case, `image_alt` may also stay empty.
6. Leave `link.url` empty when the card does not need a link.

Example with two hobbies:

```json
[
  {
    "title": { "en": "Photography", "zh": "摄影" },
    "description": {
      "en": "English description.",
      "zh": "中文介绍。"
    },
    "image": "images/hobbies/photography.jpg",
    "image_alt": {
      "en": "Landscape photograph",
      "zh": "风景照片"
    },
    "link": {
      "url": "",
      "label": { "en": "Learn more", "zh": "了解更多" }
    }
  },
  {
    "title": { "en": "Running", "zh": "跑步" },
    "description": {
      "en": "English description.",
      "zh": "中文介绍。"
    },
    "image": "",
    "image_alt": { "en": "", "zh": "" },
    "link": {
      "url": "",
      "label": { "en": "Learn more", "zh": "了解更多" }
    }
  }
]
```

## Add a thought or advice note

1. Open `content/examples/thoughts.example.json`.
2. Copy its object into the array in `content/thoughts.json`.
3. Use the `YYYY-MM-DD` date format so entries remain easy to sort.
4. Fill in both language versions of `title` and `body`.
5. Images and links are optional and follow the same rules as Hobbies.

Example:

```json
[
  {
    "date": "2026-10-10",
    "title": {
      "en": "Choosing a research problem",
      "zh": "如何选择研究问题"
    },
    "body": {
      "en": "English note or advice.",
      "zh": "中文思考或建议。"
    },
    "image": "",
    "image_alt": { "en": "", "zh": "" },
    "link": {
      "url": "",
      "label": { "en": "Read more", "zh": "阅读全文" }
    }
  }
]
```

## JSON rules

- Use double quotes around every key and text value.
- Separate objects with commas, but do not add a comma after the last object.
- Keep both `en` and `zh` fields.
- Use `/` in image paths, not Windows backslashes.
- Run `python scripts/check_site_contract.py` before publishing. The GitHub workflow runs the same validation automatically.

## Local preview

Run this command from the repository root:

```bash
python -m http.server 8080
```

Then open `http://127.0.0.1:8080/`. Opening `index.html` directly as a `file://` URL will not load the JSON files.
