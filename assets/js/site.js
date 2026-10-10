(function () {
  "use strict";

  const storageKey = "qlx-site-language";
  const root = document.documentElement;
  const toggle = document.getElementById("languageToggle");
  const backToTop = document.getElementById("backToTop");
  const page = root.dataset.page || "home";
  const contentVersion = "20261011-3";
  const chineseRegions = new Set(["CN", "HK", "MO", "TW"]);
  const queryLanguage = new URLSearchParams(window.location.search).get("lang");
  let savedLanguage = null;

  try {
    savedLanguage = window.localStorage.getItem(storageKey);
  } catch (_) {
    // Local storage can be unavailable in privacy-restricted browsers.
  }

  function normalizeLanguage(value) {
    return value && value.toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  function applyLanguage(language, remember) {
    const selected = normalizeLanguage(language);
    root.dataset.lang = selected;
    root.lang = selected === "zh" ? "zh-CN" : "en";
    toggle.textContent = selected === "zh" ? "English" : "中文";
    toggle.setAttribute("aria-label", selected === "zh" ? "Switch to English" : "切换至中文");
    const titles = {
      home: { en: "Qinglin Xun | Academic Homepage", zh: "荀清林｜学术主页" },
      hobbies: { en: "Hobbies | Qinglin Xun", zh: "兴趣爱好｜荀清林" },
      thoughts: { en: "Thoughts & Advice | Qinglin Xun", zh: "思考与建议｜荀清林" }
    };
    document.title = titles[page][selected];

    document.querySelectorAll("[data-alt-en][data-alt-zh]").forEach(function (image) {
      image.alt = selected === "zh" ? image.dataset.altZh : image.dataset.altEn;
    });

    if (remember) {
      try {
        window.localStorage.setItem(storageKey, selected);
      } catch (_) {
        // Local storage can be unavailable in privacy-restricted browsers.
      }
    }
  }

  function bilingualElement(tagName, className, values) {
    const element = document.createElement(tagName);
    if (className) element.className = className;

    const english = document.createElement("span");
    english.className = "lang-en";
    english.textContent = values.en;

    const chinese = document.createElement("span");
    chinese.className = "lang-zh";
    chinese.textContent = values.zh;

    element.append(english, chinese);
    return element;
  }

  function appendImage(card, item) {
    if (!item.image) return;
    const image = document.createElement("img");
    image.className = "reflection-image";
    image.src = item.image;
    image.loading = "lazy";
    image.dataset.altEn = item.image_alt.en;
    image.dataset.altZh = item.image_alt.zh;
    image.alt = root.dataset.lang === "zh" ? item.image_alt.zh : item.image_alt.en;
    card.appendChild(image);
  }

  function appendLink(card, link) {
    if (!link || !link.url) return;
    const anchor = bilingualElement("a", "reflection-link", link.label);
    anchor.href = link.url;
    if (/^https?:\/\//i.test(link.url)) {
      anchor.target = "_blank";
      anchor.rel = "noopener";
    }
    card.appendChild(anchor);
  }

  function appendGallery(card, gallery) {
    if (!Array.isArray(gallery) || !gallery.length) return;

    card.classList.add("hobby-card--gallery");
    const galleryContainer = document.createElement("div");
    galleryContainer.className = "hobby-gallery";

    gallery.forEach(function (place) {
      const placeSection = document.createElement("section");
      placeSection.className = "hobby-place";
      if (place.photos.length > 1) placeSection.classList.add("hobby-place--multi");

      const photos = document.createElement("div");
      photos.className = "hobby-photo-grid";
      photos.dataset.count = String(place.photos.length);

      place.photos.forEach(function (photo) {
        const figure = document.createElement("figure");
        figure.className = "hobby-photo hobby-photo--" + (photo.orientation || "standard");

        const photoLink = document.createElement("a");
        photoLink.className = "hobby-photo-link";
        photoLink.href = photo.src;
        photoLink.target = "_blank";
        photoLink.rel = "noopener";

        const image = document.createElement("img");
        image.src = photo.src;
        image.loading = "lazy";
        image.decoding = "async";
        image.dataset.altEn = photo.alt.en;
        image.dataset.altZh = photo.alt.zh;
        image.alt = root.dataset.lang === "zh" ? photo.alt.zh : photo.alt.en;
        photoLink.appendChild(image);

        const caption = bilingualElement("figcaption", "hobby-photo-caption", {
          en: place.location.en + (place.year ? ", " + place.year : ""),
          zh: place.location.zh + (place.year ? "，" + place.year : "")
        });
        figure.append(photoLink, caption);
        photos.appendChild(figure);
      });

      placeSection.appendChild(photos);
      galleryContainer.appendChild(placeSection);
    });

    card.appendChild(galleryContainer);
  }

  function renderHobby(item) {
    const card = document.createElement("article");
    card.className = "reflection-card hobby-card";
    appendImage(card, item);
    card.appendChild(bilingualElement("h3", "", item.title));
    card.appendChild(bilingualElement("p", "", item.description));
    appendGallery(card, item.gallery);
    appendLink(card, item.link);
    return card;
  }

  function renderThought(item) {
    const card = document.createElement("article");
    card.className = "reflection-card";
    appendImage(card, item);
    if (item.date) {
      const date = document.createElement("p");
      date.className = "reflection-meta";
      date.textContent = item.date;
      card.appendChild(date);
    }
    card.appendChild(bilingualElement("h3", "", item.title));
    card.appendChild(bilingualElement("p", "", item.body));
    appendLink(card, item.link);
    return card;
  }

  function emptyState() {
    return bilingualElement(
      "p",
      "content-state",
      { en: "Content coming soon.", zh: "内容待补充。" }
    );
  }

  function errorState() {
    return bilingualElement(
      "p",
      "content-state",
      { en: "This section is temporarily unavailable.", zh: "该板块暂时无法加载。" }
    );
  }

  function loadCollection(url, containerId, renderItem) {
    const container = document.getElementById(containerId);
    if (!container) return Promise.resolve();
    return fetch(url, { headers: { Accept: "application/json" } })
      .then(function (response) {
        if (!response.ok) throw new Error("Unable to load " + url);
        return response.json();
      })
      .then(function (items) {
        container.replaceChildren();
        if (!items.length) {
          container.appendChild(emptyState());
          return;
        }
        items.forEach(function (item) {
          container.appendChild(renderItem(item));
        });
      })
      .catch(function () {
        container.replaceChildren(errorState());
      });
  }

  const explicitLanguage = queryLanguage === "zh" || queryLanguage === "en" ? queryLanguage : null;
  const browserLanguage = normalizeLanguage(navigator.language || "en");
  applyLanguage(explicitLanguage || savedLanguage || browserLanguage, Boolean(explicitLanguage));

  if (toggle) {
    toggle.addEventListener("click", function () {
      applyLanguage(root.dataset.lang === "zh" ? "en" : "zh", true);
    });
  }

  if (backToTop) {
    backToTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function updateBackToTop() {
    if (backToTop) backToTop.classList.toggle("visible", window.scrollY > 320);
  }

  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();

  loadCollection("content/hobbies.json?v=" + contentVersion, "hobbiesContent", renderHobby);
  loadCollection("content/thoughts.json?v=" + contentVersion, "thoughtsContent", renderThought);

  if (!explicitLanguage && !savedLanguage) {
    const controller = new AbortController();
    const timeout = window.setTimeout(function () {
      controller.abort();
    }, 1800);

    fetch("https://api.country.is/", {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json" }
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Country lookup failed");
        return response.json();
      })
      .then(function (data) {
        if (data && data.country) {
          applyLanguage(chineseRegions.has(String(data.country).toUpperCase()) ? "zh" : "en", false);
        }
      })
      .catch(function () {
        // Browser language remains the fallback.
      })
      .finally(function () {
        window.clearTimeout(timeout);
      });
  }
})();
