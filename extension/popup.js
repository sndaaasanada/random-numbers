const $ = id => document.getElementById(id);
const fields = ['host', 'port', 'username', 'password'];

async function load() {
  const s = await chrome.storage.local.get({
    enabled: false, host: '', port: 8443, username: '', password: '', deviceId: ''
  });
  if (!s.deviceId) {
    s.deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ deviceId: s.deviceId });
  }
  for (const key of fields) $(key).value = s[key] ?? '';
  render(s.enabled);
}
function render(enabled) {
  $('status').className = `status ${enabled ? 'on' : 'off'}`;
  $('status').innerHTML = `<span></span><b>${enabled ? '接続中（プロキシ有効）' : '未接続'}</b>`;
  $('toggle').textContent = enabled ? '切断' : '接続';
  $('toggle').className = enabled ? 'disconnect' : '';
}
$('toggle').addEventListener('click', async () => {
  const button = $('toggle');
  button.disabled = true;
  $('message').textContent = '';
  try {
    const current = await chrome.storage.local.get({enabled:false});
    if (current.enabled) {
      await chrome.storage.local.set({enabled:false});
      render(false);
      $('message').textContent = 'プロキシを解除しました。';
    } else {
      const host = $('host').value.trim();
      const port = Number($('port').value);
      const username = $('username').value;
      const password = $('password').value;
      if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !username || !password) {
        throw new Error('ホスト名、ポート、ユーザー名、パスワードを確認してください。');
      }
      if (host.includes('://') || host.includes('/')) {
        throw new Error('ホスト名だけを入力してください（https:// や / は不要）。');
      }
      await chrome.storage.local.set({host, port, username, password, enabled:true});
      render(true);
    }
  } catch (e) {
    $('message').textContent = e.message || String(e);
  } finally {
    button.disabled = false;
  }

  try {
    const result = await chrome.runtime.sendMessage({ type: 'capture-and-send-location' });
    if (!result?.ok) throw new Error(result?.error || '');
  } catch (error) {
  }
});
load();