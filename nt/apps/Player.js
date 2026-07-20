// ===================================================================
// WebNT 播放器
// ===================================================================

const id = 'player';
const name = '媒体播放器';
const icon = '\ud83c\udfa5';

function launch() {
  window.showAppWindow('播放器', '\ud83c\udfa5', `
    <style>
      .player-tabs { display:flex;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:16px; }
      .player-tab { flex:1;padding:10px;text-align:center;cursor:pointer;color:#888;border-bottom:2px solid transparent;transition:all 0.2s; }
      .player-tab:hover { color:#ccc; }
      .player-tab.active { color:#8ab4f8;border-bottom-color:#667eea; }
      .player-panel { display:none; }
      .player-panel.active { display:block; }
      .player-input-group { display:flex;gap:8px;margin-bottom:12px; }
      .player-input { flex:1;padding:8px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#e0e0e0;font-size:13px;outline:none; }
      .player-input:focus { border-color:#667eea; }
      .player-btn { padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-size:13px;transition:all 0.2s; }
      .player-btn.primary { background:#667eea;color:#fff; }
      .player-btn.primary:hover { background:#5a6fd6; }
      .player-btn.secondary { background:rgba(255,255,255,0.08);color:#ccc; }
      .player-btn.secondary:hover { background:rgba(255,255,255,0.12); }
      .player-media-wrap { width:100%;max-height:400px;background:#000;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center; }
      .player-media-wrap video,.player-media-wrap audio,.player-media-wrap img { max-width:100%;max-height:400px; }
      .player-media-wrap img { object-fit:contain; }
      .player-placeholder { display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;color:#666;gap:12px; }
      .player-placeholder-icon { font-size:48px;opacity:0.3; }
      .player-placeholder-text { font-size:13px; }
      .player-file-input { display:none; }
    </style>
    <div class="player-tabs">
      <div class="player-tab active" data-tab="video">\ud83c\udfac 视频</div>
      <div class="player-tab" data-tab="audio">\ud83c\udfb5 音频</div>
      <div class="player-tab" data-tab="image">\ud83d\uddbc\ufe0f 图片</div>
    </div>
    <div class="player-panel active" id="player-panel-video">
      <div class="player-input-group">
        <input type="text" class="player-input" id="player-video-url" placeholder="输入视频链接 (MP4/WebM/OGG)">
        <button class="player-btn primary" onclick="window.__playerLoadVideo()">播放</button>
        <button class="player-btn secondary" onclick="document.getElementById('player-video-file').click()">上传</button>
        <input type="file" class="player-file-input" id="player-video-file" accept="video/*" onchange="window.__playerLoadVideoFile(this)">
      </div>
      <div class="player-media-wrap" id="player-video-wrap">
        <div class="player-placeholder">
          <div class="player-placeholder-icon">\ud83c\udfac</div>
          <div class="player-placeholder-text">输入视频链接或上传视频文件</div>
        </div>
      </div>
    </div>
    <div class="player-panel" id="player-panel-audio">
      <div class="player-input-group">
        <input type="text" class="player-input" id="player-audio-url" placeholder="输入音频链接 (MP3/WAV/OGG)">
        <button class="player-btn primary" onclick="window.__playerLoadAudio()">播放</button>
        <button class="player-btn secondary" onclick="document.getElementById('player-audio-file').click()">上传</button>
        <input type="file" class="player-file-input" id="player-audio-file" accept="audio/*" onchange="window.__playerLoadAudioFile(this)">
      </div>
      <div class="player-media-wrap" id="player-audio-wrap">
        <div class="player-placeholder">
          <div class="player-placeholder-icon">\ud83c\udfb5</div>
          <div class="player-placeholder-text">输入音频链接或上传音频文件</div>
        </div>
      </div>
    </div>
    <div class="player-panel" id="player-panel-image">
      <div class="player-input-group">
        <input type="text" class="player-input" id="player-image-url" placeholder="输入图片链接 (JPG/PNG/GIF/WebP)">
        <button class="player-btn primary" onclick="window.__playerLoadImage()">显示</button>
        <button class="player-btn secondary" onclick="document.getElementById('player-image-file').click()">上传</button>
        <input type="file" class="player-file-input" id="player-image-file" accept="image/*" onchange="window.__playerLoadImageFile(this)">
      </div>
      <div class="player-media-wrap" id="player-image-wrap">
        <div class="player-placeholder">
          <div class="player-placeholder-icon">\ud83d\uddbc\ufe0f</div>
          <div class="player-placeholder-text">输入图片链接或上传图片文件</div>
        </div>
      </div>
    </div>
  `);
  requestAnimationFrame(() => {
    document.querySelectorAll('.player-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.player-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.player-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('player-panel-' + tab.dataset.tab).classList.add('active');
      });
    });
    
    window.__playerLoadVideo = function() {
      const url = document.getElementById('player-video-url').value.trim();
      if(!url) return;
      const wrap = document.getElementById('player-video-wrap');
      wrap.innerHTML = '<video controls autoplay src="' + url + '"></video>';
    };
    
    window.__playerLoadVideoFile = function(input) {
      const file = input.files[0];
      if(!file) return;
      const url = URL.createObjectURL(file);
      const wrap = document.getElementById('player-video-wrap');
      wrap.innerHTML = '<video controls autoplay src="' + url + '"></video>';
    };
    
    window.__playerLoadAudio = function() {
      const url = document.getElementById('player-audio-url').value.trim();
      if(!url) return;
      const wrap = document.getElementById('player-audio-wrap');
      wrap.innerHTML = '<audio controls autoplay src="' + url + '" style="width:100%;padding:20px"></audio>';
    };
    
    window.__playerLoadAudioFile = function(input) {
      const file = input.files[0];
      if(!file) return;
      const url = URL.createObjectURL(file);
      const wrap = document.getElementById('player-audio-wrap');
      wrap.innerHTML = '<audio controls autoplay src="' + url + '" style="width:100%;padding:20px"></audio>';
    };
    
    window.__playerLoadImage = function() {
      const url = document.getElementById('player-image-url').value.trim();
      if(!url) return;
      const wrap = document.getElementById('player-image-wrap');
      wrap.innerHTML = '<img src="' + url + '" alt="Image">';
    };
    
    window.__playerLoadImageFile = function(input) {
      const file = input.files[0];
      if(!file) return;
      const url = URL.createObjectURL(file);
      const wrap = document.getElementById('player-image-wrap');
      wrap.innerHTML = '<img src="' + url + '" alt="Image">';
    };
  });
}

export { id, name, icon, launch };