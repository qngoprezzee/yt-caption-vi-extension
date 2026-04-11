// popup.js
const toggle = document.getElementById('enabled-toggle');
const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const statusMsg = document.getElementById('status-msg');

// Load saved settings
chrome.storage.local.get(['enabled', 'apiKey'], (data) => {
  toggle.checked = data.enabled !== false;
  if (data.apiKey) apiKeyInput.value = data.apiKey;
});

// Toggle on/off immediately
toggle.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: toggle.checked });
  flash(toggle.checked ? 'Đã bật ✓' : 'Đã tắt', false);
});

// Save API key
saveBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  chrome.storage.local.set({ apiKey: key, enabled: toggle.checked }, () => {
    flash('Đã lưu ✓', false);
  });
});

function flash(msg, isError) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg' + (isError ? ' error' : '');
  setTimeout(() => { statusMsg.textContent = ''; }, 2000);
}
