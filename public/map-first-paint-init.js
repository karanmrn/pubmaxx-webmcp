(function () {
  var firstPinsSeen = false;
  try {
    firstPinsSeen = window.localStorage.getItem("pubmax:first-pins-seen:v1") === "1";
  } catch {}
  var manifestRevision = "local";
  try {
    var scriptUrl = document.currentScript && new URL(document.currentScript.src, window.location.href);
    if (scriptUrl && scriptUrl.searchParams.get("v")) {
      manifestRevision = scriptUrl.searchParams.get("v");
    }
  } catch {}
  var startWarm = function () {
  var nav = navigator;
  var conn = nav && nav.connection;
  if (
    conn &&
    (conn.saveData === true ||
      conn.effectiveType === "slow-2g" ||
      conn.effectiveType === "2g")
  ) {
    return;
  }
  // The manifest is always eager. Once it answers, warm only cells that match
  // the opening camera. This preserves location-first loading while allowing
  // the cell response to overlap React and MapLibre startup.
  var manifestPath = "/data/venues_slim.manifest.json";
  var manifestRequestPath = manifestPath + "?v=" + encodeURIComponent(manifestRevision);
  var json = new Map();
  window.__pubmaxMapWarm = { json: json };
  var manifestWarm = fetch(manifestRequestPath, { cache: "force-cache" }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json().then(function (manifest) {
      if (
        manifestRevision !== "local" &&
        (!manifest || manifest.revision !== manifestRevision)
      ) {
        throw new Error("stale map manifest");
      }
      return manifest;
    });
  });
  json.set(manifestPath, manifestWarm);
  function validLocation(value) {
    return (
      value &&
      Number.isFinite(value.lat) &&
      Number.isFinite(value.lng) &&
      value.lat >= -90 &&
      value.lat <= 90 &&
      value.lng >= -180 &&
      value.lng <= 180
    );
  }
  function fallbackLocation() {
    try {
      var raw = window.localStorage.getItem("pubmax:map-opening-location:v1");
      var saved = raw ? JSON.parse(raw) : null;
      if (validLocation(saved) && saved.lat >= 51.25 && saved.lat <= 51.75 && saved.lng >= -0.6 && saved.lng <= 0.4) {
        return saved;
      }
    } catch {
      // Opening location is an optional hint. Default London center stays safe.
    }
    return { lat: 51.52, lng: -0.12 };
  }
  function resolveOpeningLocation() {
    var fallback = fallbackLocation();
    if (!nav.geolocation) {
      return Promise.resolve(fallback);
    }
    function readCurrentLocation() {
      return new Promise(function (resolve) {
        function settle(value) { resolve(value); }
        try {
          nav.geolocation.getCurrentPosition(
            function (position) {
              try {
                var location = {
                  lat: position && position.coords && position.coords.latitude,
                  lng: position && position.coords && position.coords.longitude,
                };
                settle(validLocation(location) ? location : fallback);
              } catch { settle(fallback); }
            },
            function () { settle(fallback); },
            { enableHighAccuracy: false, timeout: 2_000, maximumAge: 60_000 },
          );
        } catch { settle(fallback); }
      });
    }
    if (!nav.permissions || typeof nav.permissions.query !== "function") {
      return Promise.resolve(fallback);
    }
    return nav.permissions.query({ name: "geolocation" }).then(function (permission) {
      if (permission && permission.state === "granted") return readCurrentLocation();
      return fallback;
    }).catch(function () { return fallback; });
  }
  void manifestWarm.then(function (manifest) {
    if (!manifest || !Array.isArray(manifest.shards)) return;
    return resolveOpeningLocation().then(function (location) {
      if (!location) return;
      var zoom = 15;
      var scale = 512 * Math.pow(2, zoom);
      var longitudeDelta = (Math.max(window.innerWidth, 1) * 180) / scale;
      var latitudeDelta = (Math.max(window.innerHeight, 1) * 180 * 1.4) / scale;
      var bounds = {
        west: location.lng - longitudeDelta,
        south: Math.max(-85, location.lat - latitudeDelta),
        east: location.lng + longitudeDelta,
        north: Math.min(85, location.lat + latitudeDelta),
      };
      manifest.shards.forEach(function (shard) {
        if (!Array.isArray(shard.bbox) || shard.bbox.length !== 4) return;
        var minLng = shard.bbox[0];
        var minLat = shard.bbox[1];
        var maxLng = shard.bbox[2];
        var maxLat = shard.bbox[3];
        if (
          minLng > bounds.east ||
          maxLng < bounds.west ||
          minLat > bounds.north ||
          maxLat < bounds.south
        ) return;
        var shardPath = manifestRevision === "local"
          ? shard.url
          : shard.url + "?v=" + encodeURIComponent(manifestRevision);
        var warm = fetch(shardPath, { cache: "force-cache" }).then(function (response) {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json().then(function (payload) {
            if (
              manifestRevision !== "local" &&
              (!payload || payload.revision !== manifestRevision || !Array.isArray(payload.rows))
            ) {
              throw new Error("stale map shard");
            }
            return payload;
          });
        });
        json.set(shard.url, warm);
        json.set(shardPath, warm);
        void warm.catch(function () {
          if (json.get(shard.url) === warm) json.delete(shard.url);
          if (json.get(shardPath) === warm) json.delete(shardPath);
        });
      });
    });
  }).catch(function () {
    if (json.get(manifestPath) === manifestWarm) json.delete(manifestPath);
  });
  };
  if (firstPinsSeen || window.__pubmaxFirstPinsReady) startWarm();
  else window.addEventListener("pubmax:first-pins", startWarm, { once: true });
})();
