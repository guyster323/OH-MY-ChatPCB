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

  function loadLocale(next) {
    if (cache[next]) return cache[next];
    const xhr = new XMLHttpRequest();
    xhr.open('GET', localeUrl(next), false);
    xhr.send(null);
    if (!((xhr.status === 200 || xhr.status === 0) && xhr.responseText)) {
      throw new Error(`Unable to load locale ${next}`);
    }
    cache[next] = JSON.parse(xhr.responseText);
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

  function setLang(next) {
    const resolved = SUPPORTED.includes(next) ? next : 'en';
    lang = resolved;
    try {
      dict = loadLocale(resolved);
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

  try {
    cache.en = loadLocale('en');
  } catch {
    cache.en = {};
  }
  lang = initialLang();
  dict = lang === 'en' ? cache.en : cache.en;
  if (lang !== 'en') {
    try {
      dict = loadLocale(lang);
    } catch {
      lang = 'en';
      dict = cache.en;
    }
  }
  document.documentElement.lang = lang;

  window.t = t;
  window.chatpcbI18n = {
    t,
    setLang,
    onChange,
    applyDom,
    getLang: () => lang
  };

  function boot() {
    applyDom();
    const select = document.querySelector('#lang');
    if (!select || select.dataset.i18nBound === 'true') return;
    select.dataset.i18nBound = 'true';
    select.value = lang;
    select.addEventListener('change', () => setLang(select.value));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
