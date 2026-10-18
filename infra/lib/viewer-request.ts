/**
 * CloudFront Functions runtime is a restricted JavaScript. Keep this source
 * in that subset: `var`, classic functions, and no trailing syntax the
 * runtime rejects. Routes are data, inserted with JSON.stringify.
 */
export function viewerRequestCode(routes: readonly string[]): string {
	const list = JSON.stringify([...routes]);
	return `
function handler(event) {
  var request = event.request;
  var hostHeader = request.headers && request.headers.host;
  var host = hostHeader && hostHeader.value ? hostHeader.value.toLowerCase() : '';
  var uri = request.uri || '/';
  var query = toQuery(request.querystring);
  var dest = normalize(uri);
  if (host === 'www.gaslandsgarage.com' || dest !== uri) {
    return redirect('https://gaslandsgarage.com' + dest + query);
  }
  if (isSpa(uri)) {
    request.uri = '/index.html';
  }
  return request;
}

// Pages discovered from app/src/routes, plus a parent path such as /admin.
// A file name (a dot in the last segment) is never a page: assets,
// robots.txt, sitemap.xml, and PDFs stay on S3. Any other path is left
// alone so a missing object becomes a real 404.
var SPA_ROUTES = ${list};

function normalize(uri) {
  if (uri === '/' || uri === '/index.html') return '/builder';
  if (uri.length > 1 && uri.charAt(uri.length - 1) === '/') {
    var trimmed = uri.slice(0, -1);
    if (isSpa(trimmed)) return trimmed;
  }
  return uri;
}

function isSpa(uri) {
  if (looksLikeFile(uri)) return false;
  var i;
  for (i = 0; i < SPA_ROUTES.length; i++) {
    if (matches(SPA_ROUTES[i], uri)) return true;
  }
  return false;
}

function looksLikeFile(uri) {
  var slash = uri.lastIndexOf('/');
  var name = slash === -1 ? uri : uri.slice(slash + 1);
  return name.indexOf('.') !== -1;
}

function matches(pattern, uri) {
  var patternParts = pattern.split('/');
  var uriParts = uri.split('/');
  var rest = patternParts[patternParts.length - 1] === ':r*';
  if (rest) {
    if (uriParts.length < patternParts.length) return false;
  } else if (patternParts.length !== uriParts.length) {
    return false;
  }
  var limit = rest ? patternParts.length - 1 : patternParts.length;
  var j;
  for (j = 0; j < limit; j++) {
    var part = patternParts[j];
    if (part === ':p') {
      if (!uriParts[j]) return false;
      continue;
    }
    if (part !== uriParts[j]) return false;
  }
  if (rest) {
    var k;
    for (k = limit; k < uriParts.length; k++) {
      if (!uriParts[k]) return false;
    }
  }
  return true;
}

function redirect(location) {
  return {
    statusCode: 301,
    statusDescription: 'Moved Permanently',
    headers: {
      location: { value: location }
    }
  };
}

function toQuery(querystring) {
  if (!querystring) return '';
  var parts = [];
  var key;
  for (key in querystring) {
    if (!Object.prototype.hasOwnProperty.call(querystring, key)) continue;
    var entry = querystring[key] || {};
    if (entry.multiValue && entry.multiValue.length) {
      var i;
      for (i = 0; i < entry.multiValue.length; i++) {
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(entry.multiValue[i].value));
      }
    } else if (entry.value) {
      parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(entry.value));
    } else {
      parts.push(encodeURIComponent(key));
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}
`;
}
