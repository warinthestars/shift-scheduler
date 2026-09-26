/**
 * Phase 27: Ask the phone/browser for the current position.
 * Resolves { latitude, longitude, accuracy_m }. Rejects with an Error whose message is ready to show.
 */
export function getCurrentPosition({ timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser can't share its location. Try Chrome or Safari on your phone."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: pos.coords.accuracy,
        }),
      (err) => {
        if (err.code === 1) {
          reject(new Error('Location is blocked for this site. Allow location in your browser settings, then try again.'));
        } else if (err.code === 3) {
          reject(new Error("Couldn't get your location in time. Step outside or near a window and try again."));
        } else {
          reject(new Error("Couldn't get your location. Check that location services are on, then try again."));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

/**
 * Pulls coordinates out of a pasted Google/Apple Maps link or a "lat, lng" string.
 * Returns { lat, lng } or null.
 */
export function parseMapLink(text) {
  if (!text) return null;
  const s = String(text).trim();
  const patterns = [
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,                 // .../@40.72,-74.00,17z
    /[?&](?:q|query|ll|sll|daddr)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, // ?q=40.72,-74.00
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,                // ...!3d40.72!4d-74.00
    /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/,             // "40.72, -74.00"
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}
