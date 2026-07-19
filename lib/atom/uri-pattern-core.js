/**
 * Match and capture parts of a URI, like a specialized dialect of regular expression. This is used by PaneItem to
 * describe URIs that should launch specific panes.
 *
 * URI patterns use `{name}` placeholders to match any non-empty path segment or URI part (host, protocol) and capture
 * it as a parameter called "name". Any segment that is not recognized as a parameter will match exactly.
 */
class URIPattern {
  constructor(string) {
    this.original = string;

    const parsed = parseUriParts(dashEscape(string));
    this.parts = {
      protocol: asPart(parsed.protocol, "", ":"),
      auth: splitAuth(parsed.auth, asPart),
      hostname: asPart(parsed.hostname),
      port: asPart(parsed.port),
      pathname: parsed.pathname
        .split("/")
        .slice(1)
        .map((segment) => asPart(segment)),
      query: Object.keys(parsed.query).reduce((acc, current) => {
        acc[current] = asPart(parsed.query[current]);
        return acc;
      }, {}),
      hash: asPart(parsed.hash, "#", ""),
    };
  }

  matches(string) {
    if (string === undefined || string === null) {
      return nonURIMatch;
    }

    let other;
    try {
      other = parseUriParts(string);
    } catch (error) {
      if (error instanceof TypeError || error instanceof URIError) {
        return nonURIMatch;
      }
      throw error;
    }

    const params = {};

    // direct matches
    for (const attr of ["protocol", "hostname", "port", "hash"]) {
      if (!this.parts[attr].matchesIn(params, other[attr])) {
        return nonURIMatch;
      }
    }

    // auth
    const auth = splitAuth(other.auth);
    if (!this.parts.auth.username.matchesIn(params, auth.username)) {
      return nonURIMatch;
    }
    if (!this.parts.auth.password.matchesIn(params, auth.password)) {
      return nonURIMatch;
    }

    // pathname
    const pathParts = other.pathname.split("/").filter((part) => part.length > 0);
    let mineInd = 0;
    let yoursInd = 0;
    while (mineInd < this.parts.pathname.length && yoursInd < pathParts.length) {
      const mine = this.parts.pathname[mineInd];
      const yours = pathParts[yoursInd];

      if (!mine.matchesIn(params, yours)) {
        return nonURIMatch;
      } else {
        if (!mine.isSplat()) {
          mineInd++;
        }
        yoursInd++;
      }
    }

    while (mineInd < this.parts.pathname.length) {
      const part = this.parts.pathname[mineInd];
      if (!part.matchesEmptyIn(params)) {
        return nonURIMatch;
      }
      mineInd++;
    }

    if (yoursInd !== pathParts.length) {
      return nonURIMatch;
    }

    // query string
    const remaining = new Set(Object.keys(this.parts.query));
    for (const key in other.query) {
      const yours = other.query[key];
      remaining.delete(key);

      const mine = this.parts.query[key];
      if (mine === undefined) {
        return nonURIMatch;
      }

      const allYours = yours instanceof Array ? yours : [yours];

      for (const each of allYours) {
        if (!mine.matchesIn(params, each)) {
          return nonURIMatch;
        }
      }
    }

    for (const key of remaining) {
      const part = this.parts.query[key];
      if (!part.matchesEmptyIn(params)) {
        return nonURIMatch;
      }
    }

    return new URIMatch(string, params);
  }

  getOriginal() {
    return this.original;
  }

  toString() {
    return `<URIPattern ${this.original}>`;
  }
}

class ExactPart {
  constructor(string) {
    this.string = string;
  }

  matchesIn(params, other) {
    return other === this.string;
  }

  matchesEmptyIn(params) {
    return false;
  }

  isSplat() {
    return false;
  }
}

class CapturePart {
  constructor(name, splat, prefix, suffix) {
    this.name = name;
    this.splat = splat;
    this.prefix = prefix;
    this.suffix = suffix;
  }

  matchesIn(params, other) {
    if (this.prefix.length > 0 && other.startsWith(this.prefix)) {
      other = other.slice(this.prefix.length);
    }
    if (this.suffix.length > 0 && other.endsWith(this.suffix)) {
      other = other.slice(0, -this.suffix.length);
    }

    try {
      other = decodeURIComponent(other);
    } catch (error) {
      if (error instanceof URIError) {
        return false;
      }
      throw error;
    }

    if (this.name.length > 0) {
      if (this.splat) {
        if (params[this.name] === undefined) {
          params[this.name] = [other];
        } else {
          params[this.name].push(other);
        }
      } else {
        if (params[this.name] !== undefined) {
          return false;
        }
        params[this.name] = other;
      }
    }
    return true;
  }

  matchesEmptyIn(params) {
    if (this.splat) {
      if (params[this.name] === undefined) {
        params[this.name] = [];
      }
      return true;
    }

    return false;
  }

  isSplat() {
    return this.splat;
  }
}

/**
 * Parse a custom editor URI with the WHATWG URL implementation while retaining the legacy shape expected by
 * URIPattern. The protocol is temporarily replaced so escaped protocol captures like `-aproto-z://` remain parseable.
 */
function parseUriParts(string) {
  if (typeof string !== "string") {
    throw new TypeError("URI must be a string");
  }

  const protocolEnd = string.indexOf("://");
  if (protocolEnd <= 0) {
    throw new TypeError(`Invalid URI: ${string}`);
  }

  const protocol = `${string.slice(0, protocolEnd).toLowerCase()}:`;
  const parsed = new URL(`uri-pattern${string.slice(protocolEnd)}`);
  const authorityStart = protocolEnd + 3;
  const authorityLength = string.slice(authorityStart).search(/[/?#]/);
  const authorityEnd = authorityLength === -1 ? string.length : authorityStart + authorityLength;
  const authority = string.slice(authorityStart, authorityEnd);
  const authEnd = authority.lastIndexOf("@");
  const auth = authEnd === -1 ? null : decodeURIComponent(authority.slice(0, authEnd));
  const query = {};

  for (const [key, value] of parsed.searchParams) {
    if (!Object.prototype.hasOwnProperty.call(query, key)) {
      query[key] = value;
    } else if (query[key] instanceof Array) {
      query[key].push(value);
    } else {
      query[key] = [query[key], value];
    }
  }

  return {
    protocol,
    auth,
    // Legacy URL parsing normalized hostnames even for custom protocols. WHATWG treats these as opaque hosts, so
    // retain the case-insensitive matching and capture behavior explicitly.
    hostname: parsed.hostname ? parsed.hostname.toLowerCase() : null,
    port: parsed.port || null,
    pathname: parsed.pathname || "",
    query,
    hash: parsed.hash || null,
  };
}

/**
 * Escape capture braces from the WHATWG parser with `-a` and `-z`, and escape literal dashes by doubling them.
 */
function dashEscape(raw) {
  return raw.replace(/[{}-]/g, (character) => {
    if (character === "{") {
      return "-a";
    } else if (character === "}") {
      return "-z";
    } else {
      return "--";
    }
  });
}

function dashUnescape(escaped) {
  return escaped.replace(/--/g, "-");
}

function asPart(patternSegment, prefix = "", suffix = "") {
  if (patternSegment === null) {
    return new ExactPart(null);
  }

  let subPattern = patternSegment;
  if (prefix.length > 0 && subPattern.startsWith(prefix)) {
    subPattern = subPattern.slice(prefix.length);
  }
  if (suffix.length > 0 && subPattern.endsWith(suffix)) {
    subPattern = subPattern.slice(0, -suffix.length);
  }

  if (subPattern.startsWith("-a") && subPattern.endsWith("-z")) {
    const splat = subPattern.endsWith("...-z");
    if (splat) {
      subPattern = subPattern.slice(2, -5);
    } else {
      subPattern = subPattern.slice(2, -2);
    }

    return new CapturePart(dashUnescape(subPattern), splat, prefix, suffix);
  } else {
    return new ExactPart(dashUnescape(patternSegment));
  }
}

function splitAuth(auth, fn = (value) => value) {
  if (auth === null) {
    return { username: fn(null), password: fn(null) };
  }

  const index = auth.indexOf(":");
  return index !== -1
    ? { username: fn(auth.slice(0, index)), password: fn(auth.slice(index + 1)) }
    : { username: fn(auth), password: fn(null) };
}

class URIMatch {
  constructor(uri, params) {
    this.uri = uri;
    this.params = params;
  }

  ok() {
    return true;
  }

  getURI() {
    return this.uri;
  }

  getParams() {
    return this.params;
  }

  toString() {
    let string = "<URIMatch ok";
    for (const key in this.params) {
      string += ` ${key}="${this.params[key]}"`;
    }
    string += ">";
    return string;
  }
}

const nonURIMatch = {
  ok() {
    return false;
  },

  getURI() {
    return undefined;
  },

  getParams() {
    return {};
  },

  toString() {
    return "<nonURIMatch>";
  },
};

module.exports = { URIPattern, nonURIMatch };
