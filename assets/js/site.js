(function () {
  "use strict";

  const storageKey = "qlx-site-language";
  const root = document.documentElement;
  const toggle = document.getElementById("languageToggle");
  const backToTop = document.getElementById("backToTop");
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
    document.title = selected === "zh" ? "荀清林｜学术主页" : "Qinglin Xun | Academic Homepage";

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

  function renderHobby(item) {
    const card = document.createElement("article");
    card.className = "reflection-card";
    appendImage(card, item);
    card.appendChild(bilingualElement("h3", "", item.title));
    card.appendChild(bilingualElement("p", "", item.description));
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

  toggle.addEventListener("click", function () {
    applyLanguage(root.dataset.lang === "zh" ? "en" : "zh", true);
  });

  backToTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function updateBackToTop() {
    backToTop.classList.toggle("visible", window.scrollY > 320);
  }

  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();

  loadCollection("content/hobbies.json", "hobbiesContent", renderHobby);
  loadCollection("content/thoughts.json", "thoughtsContent", renderThought);

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
