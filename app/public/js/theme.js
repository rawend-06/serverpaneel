/* Licht/donker meteen goed zetten (voor de pagina getekend wordt, zodat ze niet even wit flitst). */
(function () {
  var t = 'auto';
  try { t = JSON.parse(localStorage.getItem('rp.theme') || '"auto"'); } catch (e) { /* */ }
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
