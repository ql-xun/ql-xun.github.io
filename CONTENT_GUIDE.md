# Hobbies and Thoughts content guide

The two standalone pages read the editable data files below:

- `hobbies.html` reads `content/hobbies.json`.
- `thoughts.html` reads `content/thoughts.json`.

Both files must contain a JSON array. An empty array (`[]`) keeps its standalone
page available and displays a neutral “Content coming soon / 内容待补充” message.

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

### Add a location-based photo gallery

Add a `gallery` array to a hobby when several photographs should be grouped by
place. Each place needs a bilingual `location`, an optional four-digit `year`,
and one or more `photos`. The location and year are rendered as a small caption
below every photograph.

```json
"gallery": [
  {
    "location": {
      "en": "Jiuzhaigou",
      "zh": "九寨沟"
    },
    "year": "2026",
    "photos": [
      {
        "src": "images/hobbies/hiking/jiuzhaigou-overlook-2026.webp",
        "alt": {
          "en": "Turquoise lakes and forested mountains viewed from above",
          "zh": "从观景台俯瞰碧湖与群山"
        },
        "orientation": "wide"
      },
      {
        "src": "images/hobbies/hiking/jiuzhaigou-portrait-2026.webp",
        "alt": {
          "en": "A hiking portrait beside a turquoise lake",
          "zh": "在碧湖旁拍摄的徒步照片"
        },
        "orientation": "portrait"
      }
    ]
  }
]
```

Use `wide` for landscape photographs, `portrait` for vertical photographs, and
`standard` for ordinary 4:3 photographs. The photograph opens at full size
when selected. For faster loading and better privacy, use optimized WebP files
without embedded location metadata. The full-resolution JPG files inside
`images/hobbies/hiking/` remain local and are excluded from Git.

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
- Give every gallery photograph a meaningful bilingual `alt` description.
- Run `python scripts/check_site_contract.py` before publishing. The GitHub workflow runs the same validation automatically.

## Local preview

Run this command from the repository root:

```bash
python -m http.server 8080
```

Then open `http://127.0.0.1:8080/`. Opening `index.html` directly as a `file://` URL will not load the JSON files.
