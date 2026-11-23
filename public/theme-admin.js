/* Admin > Theme: live preview while picking colours. */
(function () {
  var form = document.getElementById('themeform'); var box = document.getElementById('themepreview');
  if (!form || !box) return;
  function ink(hex) { var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#1B1300' : '#FFFFFF'; }
  function update() {
    var v = {}; form.querySelectorAll('input[type=color]').forEach(function (i) { v[i.name] = i.value; var c = form.querySelector('[data-hex="' + i.name + '"]'); if (c) c.textContent = i.value.toUpperCase(); });
    box.style.background = v.bg;
    var a = box.querySelector('[data-role=accent]'); a.style.background = v.accent; a.style.borderColor = v.accent; a.style.color = ink(v.accent);
    var b = box.querySelector('[data-role=brand]'); b.style.background = v.brand; b.style.borderColor = v.brand; b.style.color = ink(v.brand);
    box.querySelector('[data-role=link]').style.color = v.brand;
  }
  form.addEventListener('input', update);
})();
