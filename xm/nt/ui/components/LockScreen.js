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
  // 读取当前角色
  const role = localStorage.getItem('webnt_user_role') || 'admin';
  window.__WebNT_userRole = role;
  window.__WebNT_isGuest = role === 'guest';
  lockScreen.classList.add('unlocked');
  setTimeout(() => { lockScreen.style.display = 'none'; }, 500);
}

export function initLockScreen() {
  const lsSlider = document.getElementById('ls-slider');
  const lsKnob = document.getElementById('ls-knob');

  // 暴露到全局
  window.resetKnob = resetKnob;
  window.unlockDesktop = unlockDesktop;

  // 用户角色切换
  window.__switchRole = function(role) {
    localStorage.setItem('webnt_user_role', role);
    document.querySelectorAll('.ls-role-btn').forEach(btn => {
      const isActive = btn.dataset.role === role;
      btn.classList.toggle('active', isActive);
      btn.style.background = isActive ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.05)';
      btn.style.color = isActive ? '#fff' : '#999';
    });
    // 更新头像和用户名
    const avatar = document.querySelector('.ls-avatar');
    const username = document.querySelector('.ls-username');
    if (role === 'guest') {
      if (avatar) { avatar.textContent = '访'; avatar.style.background = 'linear-gradient(135deg, #555, #777)'; }
      if (username) username.textContent = '访客';
    } else {
      if (avatar) { avatar.textContent = '管'; avatar.style.background = 'linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7)'; }
      if (username) username.textContent = '管理员';
    }
  };

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