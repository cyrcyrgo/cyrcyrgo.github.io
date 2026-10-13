// ===================================================================
// PowerMenu.js — 电源菜单
// ===================================================================

export function togglePowerMenu() {
  const powerMenu = document.getElementById('power-menu');
  if (!powerMenu) return;
  powerMenu.style.display = (powerMenu.style.display === 'block') ? 'none' : 'block';
}

export function initPowerMenu() {
  const powerBtn = document.getElementById('tb-power-btn');
  if (powerBtn) {
    powerBtn.addEventListener('click', e => { e.stopPropagation(); togglePowerMenu(); });
  }

  const pmSleep = document.getElementById('pm-sleep');
  if (pmSleep) {
    pmSleep.addEventListener('click', () => {
      const powerMenu = document.getElementById('power-menu');
      const lockScreen = document.getElementById('lock-screen');
      if (powerMenu) powerMenu.style.display = 'none';
      if (lockScreen) {
        lockScreen.style.display = 'flex';
        lockScreen.classList.remove('unlocked');
      }
      const resetKnob = window.resetKnob;
      if (resetKnob) resetKnob();
    });
  }

  const pmReboot = document.getElementById('pm-reboot');
  if (pmReboot) {
    pmReboot.addEventListener('click', () => {
      if (confirm('确定要重启 WebNT 吗？')) location.reload();
    });
  }

  const pmShutdown = document.getElementById('pm-shutdown');
  if (pmShutdown) {
    pmShutdown.addEventListener('click', () => {
      if (confirm('确定要关闭 WebNT 吗？')) location.reload();
    });
  }
}