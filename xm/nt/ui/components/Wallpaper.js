// ===================================================================
// Wallpaper.js — 壁纸管理
// ===================================================================

export function applyWallpaper(value) {
  const desktopBg = document.getElementById('desktop-bg');
  if (!value || !desktopBg) return;
  try {
    if (value.startsWith('linear-gradient')) {
      desktopBg.style.background = value;
    } else {
      desktopBg.style.background = `url(${value}) center/cover no-repeat`;
    }
  } catch(e) { /* ignore invalid wallpaper */ }
}

export function loadWallpaper() {
  try {
    const saved = localStorage.getItem('webnt_wallpaper');
    if (saved) applyWallpaper(saved);
  } catch(e) { /* localStorage not available */ }
}

export function showWallpaperDialog() {
  const wallpaperDialog = document.getElementById('wallpaper-dialog');
  if (!wallpaperDialog) return;
  const urlInput = document.getElementById('wp-url-input');
  const fileInput = document.getElementById('wp-file-input');
  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
  wallpaperDialog.style.display = 'flex';
}

export function hideWallpaperDialog() {
  const wallpaperDialog = document.getElementById('wallpaper-dialog');
  if (wallpaperDialog) wallpaperDialog.style.display = 'none';
}

export function initWallpaper() {
  // 暴露到全局
  window.applyWallpaper = applyWallpaper;
  window.loadWallpaper = loadWallpaper;
  window.showWallpaperDialog = showWallpaperDialog;
  window.hideWallpaperDialog = hideWallpaperDialog;

  const wpCancel = document.getElementById('wp-cancel');
  if (wpCancel) {
    wpCancel.addEventListener('click', hideWallpaperDialog);
  }

  const wpOk = document.getElementById('wp-ok');
  if (wpOk) {
    wpOk.addEventListener('click', () => {
      const url = document.getElementById('wp-url-input')?.value.trim();
      const fileInput = document.getElementById('wp-file-input');
      if (fileInput?.files && fileInput.files[0]) {
        const reader = new FileReader();
        reader.onload = ev => {
          localStorage.setItem('webnt_wallpaper', ev.target.result);
          applyWallpaper(ev.target.result);
          hideWallpaperDialog();
        };
        reader.readAsDataURL(fileInput.files[0]);
      } else if (url) {
        localStorage.setItem('webnt_wallpaper', url);
        applyWallpaper(url);
        hideWallpaperDialog();
      }
    });
  }

  const wallpaperDialog = document.getElementById('wallpaper-dialog');
  if (wallpaperDialog) {
    wallpaperDialog.addEventListener('click', e => {
      if (e.target === wallpaperDialog) hideWallpaperDialog();
    });
  }
}