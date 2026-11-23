// Copy-link / native share button. Uses the phone's share sheet when available.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-share]');
  if (!b) return;
  const url = b.dataset.share, title = b.dataset.title;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title, url }); return; }
    await navigator.clipboard.writeText(url);
    const old = b.textContent; b.textContent = b.dataset.done; setTimeout(() => { b.textContent = old; }, 2000);
  } catch { window.prompt('', url); }
});
