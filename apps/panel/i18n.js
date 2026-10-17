/* Self-contained panel translations. Locales are JSON so the host can ship them beside index.html. */
(function () {
  const SUPPORTED = ['en', 'ko'];
  const listeners = new Set();
  const cache = {};
  const scriptUrl = document.currentScript && document.currentScript.src
    ? document.currentScript.src
    : location.href;
  let lang = 'en';
  let dict = {};

  function localeUrl(next) {
    return new URL(`./locales/${next}.json`, scriptUrl).toString();
  }

  function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => (vars[name] == null ? '' : String(vars[name])));
  }

  function t(key, vars) {
    const value = Object.prototype.hasOwnProperty.call(dict, key)
      ? dict[key]
      : (cache.en && Object.prototype.hasOwnProperty.call(cache.en, key) ? cache.en[key] : undefined);
    if (typeof value !== 'string') return key;
    return interpolate(value, vars);
  }

  async function loadLocale(next) {
    if (cache[next]) return cache[next];
    const response = await fetch(localeUrl(next));
    if (!response.ok) throw new Error(`Unable to load locale ${next}`);
    cache[next] = await response.json();
    return cache[next];
  }

  function applyDom() {
    document.documentElement.lang = lang;
    for (const el of document.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.getAttribute('data-i18n'));
    }
    for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    }
    for (const el of document.querySelectorAll('[data-i18n-aria-label]')) {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    }
    for (const el of document.querySelectorAll('[data-i18n-title]')) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    }
    for (const el of document.querySelectorAll('[data-i18n-help]')) {
      el.dataset.help = t(el.getAttribute('data-i18n-help'));
    }
    const select = document.querySelector('#lang');
    if (select && select.value !== lang) select.value = lang;
  }

  async function setLang(next) {
    const resolved = SUPPORTED.includes(next) ? next : 'en';
    lang = resolved;
    try {
      dict = await loadLocale(resolved);
    } catch {
      dict = cache.en || {};
      lang = 'en';
    }
    applyDom();
    for (const listener of listeners) listener(lang);
    return lang;
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function initialLang() {
    const query = new URLSearchParams(location.search).get('lang');
    return SUPPORTED.includes(query) ? query : 'en';
  }

  // Fetch yields before this resolves, so panel.js can register onChange first.
  const ready = (async () => {
    try {
      cache.en = await loadLocale('en');
    } catch {
      cache.en = {};
    }
    lang = initialLang();
    dict = cache.en;
    if (lang !== 'en') {
      try {
        dict = await loadLocale(lang);
      } catch {
        lang = 'en';
        dict = cache.en;
      }
    }
    if (document.readyState === 'loading') {
      await new Promise((resolveReady) => document.addEventListener('DOMContentLoaded', resolveReady, { once: true }));
    }
    document.documentElement.lang = lang;
    applyDom();
    const select = document.querySelector('#lang');
    if (select && select.dataset.i18nBound !== 'true') {
      select.dataset.i18nBound = 'true';
      select.value = lang;
      select.addEventListener('change', () => { setLang(select.value); });
    } else if (select && select.value !== lang) {
      select.value = lang;
    }
    for (const listener of listeners) listener(lang);
  })();

  window.t = t;
  window.chatpcbI18n = {
    t,
    setLang,
    onChange,
    applyDom,
    getLang: () => lang,
    ready
  };
})();
