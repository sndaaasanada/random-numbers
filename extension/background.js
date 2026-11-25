const DEFAULTS = {
  enabled: false,
  host: '',
  port: 8443,
  username: '',
  password: '',
  deviceId: ''
};
const LOCATION_ALARM = 'location-report';
let offscreenCreation;

async function getSettings() {
  const settings = await chrome.storage.local.get(DEFAULTS);
  if (!settings.deviceId) {
    settings.deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ deviceId: settings.deviceId });
  }
  return settings;
}

async function applyProxy() {
  const s = await getSettings();
  if (!s.enabled || !s.host) {
    await chrome.proxy.settings.clear({ scope: 'regular' });
    return;
  }
  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: {
          scheme: 'https',
          host: s.host,
          port: Number(s.port)
        },
        bypassList: ['<local>', `${s.host}:${Number(s.port)}`]
      }
    },
    scope: 'regular'
  });
}

async function syncLocationAlarm() {
  const s = await getSettings();
  const allowed = s.enabled && await chrome.permissions.contains({ permissions: ['geolocation'] });
  const existing = await chrome.alarms.get(LOCATION_ALARM);
  if (!allowed) {
    if (existing) await chrome.alarms.clear(LOCATION_ALARM);
    return;
  }
  if (!existing) {
    chrome.alarms.create(LOCATION_ALARM, { delayInMinutes: 10, periodInMinutes: 10 });
  }
}

async function updateBackgroundState() {
  await applyProxy();
  await syncLocationAlarm();
}

chrome.runtime.onInstalled.addListener(() => updateBackgroundState());
chrome.runtime.onStartup.addListener(() => updateBackgroundState());
chrome.storage.onChanged.addListener(() => updateBackgroundState());
chrome.permissions.onAdded.addListener(() => syncLocationAlarm());
chrome.permissions.onRemoved.addListener(() => syncLocationAlarm());

async function ensureOffscreenDocument() {
  const url = chrome.runtime.getURL('offscreen.html');
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [url]
  });
  if (contexts.length) return;
  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.GEOLOCATION || chrome.offscreen.Reason.DOM_SCRAPING],
      justification: 'Get the user-approved location for the configured periodic location reports.'
    }).finally(() => { offscreenCreation = null; });
  }
  await offscreenCreation;
}

async function captureAndSendLocation() {
  if (!navigator.onLine) throw new Error('');
  const settings = await getSettings();
  if (!settings.enabled || !settings.host || !settings.username || !settings.password) {
    throw new Error('');
  }

  await ensureOffscreenDocument();
  const position = await chrome.runtime.sendMessage({ type: 'get-location', target: 'offscreen' });
  if (!position || position.error) throw new Error(position?.error || '');

  const serverHost = settings.host.includes(':') && !settings.host.startsWith('[')
    ? `[${settings.host}]`
    : settings.host;
  const authBytes = new TextEncoder().encode(`${settings.username}|${settings.deviceId}:${settings.password}`);
  let authBinary = '';
  for (const byte of authBytes) authBinary += String.fromCharCode(byte);
  const response = await fetch(`https://${serverHost}:${Number(settings.port)}/api/location`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(authBinary)}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(position)
  });
  if (!response.ok) throw new Error(``);
  return position;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'capture-and-send-location') return;
  captureAndSendLocation().then(
    position => sendResponse({ ok: true, position }),
    error => sendResponse({ ok: false, error: error.message || String(error) })
  );
  return true;
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== LOCATION_ALARM) return;
  // A delayed alarm after sleep is skipped; the next regular interval remains scheduled.
  if (Date.now() - alarm.scheduledTime > 60_000) return;
  try {
    await captureAndSendLocation();
  } catch (error) {
    console.log();
  }
});

chrome.webRequest.onAuthRequired.addListener(
  async (details, callback) => {
    if (!details.isProxy) {
      callback({});
      return;
    }
    const s = await getSettings();
    if (!s.enabled || !s.username || !s.password) {
      callback({});
      return;
    }
    callback({
      authCredentials: {
        username: `${s.username}|${s.deviceId}`,
        password: s.password
      }
    });
  },
  { urls: ['<all_urls>'] },
  ['asyncBlocking']
);
