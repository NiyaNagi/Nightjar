/**
 * Mock for uint8arrays module
 * Used in P2P protocol serialization
 */

module.exports = {
  toString: (arr, encoding) => {
    if (encoding === 'hex') {
      return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    if (encoding === 'base64') {
      if (typeof Buffer !== 'undefined') {
        return Buffer.from(arr).toString('base64');
      }
      return btoa(String.fromCharCode.apply(null, Array.from(arr)));
    }
    return new TextDecoder().decode(arr);
  },
  fromString: (str, encoding) => {
    if (encoding === 'base64') {
      try {
        if (typeof Buffer !== 'undefined') {
          return new Uint8Array(Buffer.from(str, 'base64'));
        }
        return new Uint8Array(atob(str).split('').map(c => c.charCodeAt(0)));
      } catch (e) {
        return null;
      }
    }
    if (encoding === 'hex') {
      const bytes = [];
      for (let i = 0; i < str.length; i += 2) {
        bytes.push(parseInt(str.substr(i, 2), 16));
      }
      return new Uint8Array(bytes);
    }
    return new TextEncoder().encode(str);
  },
};
