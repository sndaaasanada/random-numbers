'use strict';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'get-location') return;
  navigator.geolocation.getCurrentPosition(
    position => sendResponse({
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    }),
    error => sendResponse({ error: error.message || 'Location could not be determined.' }),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
  );
  return true;
});
