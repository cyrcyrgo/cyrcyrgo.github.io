// ===================================================================
// LockScreen.js — 锁屏管理
// ===================================================================

let lsDragging = false, lsStartX = 0, lsKnobX = 0, lsStartTime = 0;

function getMaxSlide() {
  const lsSlider = document.getElementById('ls-slider');
  const lsKnob = document.getElementById('ls-knob');
  if (!lsSlider) return 256;
  const kw = lsKnob ? lsKnob.offsetWidth : 40;
  return lsSlider.offsetWidth - kw - 4;
}

export function resetKnob() {
  const lsKnob = document.getElementById('ls-knob');
  if (lsKnob) lsKnob.style.left = '4px';
}

export function unlockDesktop() {
  const lockScreen = document.getElementById('lock-screen');
  if (!lockScreen) return;
  lockScreen.classList.add('unlocked');
  setTimeout(() => { lockScreen.style.display = 'none'; }, 500);
}

export function initLockScreen() {
  const lsSlider = document.getElementById('ls-slider');
  const lsKnob = document.getElementById('ls-knob');

  // 暴露到全局
  window.resetKnob = resetKnob;
  window.unlockDesktop = unlockDesktop;

  if (lsSlider) {
    lsSlider.addEventListener('pointerdown', e => {
      lsDragging = true;
      lsStartX = e.clientX;
      lsStartTime = Date.now();
      lsKnobX = 4;
      lsSlider.classList.add('dragging');
      e.preventDefault();
    });
  }

  document.addEventListener('pointermove', e => {
    if (!lsDragging) return;
    const dx = e.clientX - lsStartX;
    const maxSlide = getMaxSlide();
    lsKnobX = Math.max(4, Math.min(maxSlide, 4 + dx));
    if (lsKnob) lsKnob.style.left = lsKnobX + 'px';
    const threshold = Math.max(maxSlide * 0.85, maxSlide * 0.5);
    if (lsKnobX >= threshold) {
      lsDragging = false;
      if (lsSlider) lsSlider.classList.remove('dragging');
      unlockDesktop();
    }
  });

  document.addEventListener('pointerup', () => {
    if (!lsDragging) return;
    lsDragging = false;
    if (lsSlider) lsSlider.classList.remove('dragging');
    const maxSlide = getMaxSlide();
    const threshold = Math.max(maxSlide * 0.85, maxSlide * 0.5);
    const elapsed = Date.now() - lsStartTime;
    const speed = lsKnobX / Math.max(elapsed, 1);
    if (lsKnobX >= threshold || (speed > 0.5 && lsKnobX >= maxSlide * 0.5)) {
      unlockDesktop();
    } else {
      resetKnob();
    }
  });

  document.addEventListener('pointercancel', () => {
    if (lsDragging) {
      lsDragging = false;
      if (lsSlider) lsSlider.classList.remove('dragging');
      resetKnob();
    }
  });

  // 按任意键解锁
  document.addEventListener('keydown', function unlockByKey() {
    const lockScreen = document.getElementById('lock-screen');
    if (lockScreen && lockScreen.style.display !== 'none') {
      unlockDesktop();
    }
  }, {once: false});

  // 点击滑块区域也能解锁
  if (lsSlider) {
    lsSlider.addEventListener('click', () => {
      if (!lsDragging) unlockDesktop();
    });
  }
}