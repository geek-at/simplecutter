function chunk_split (body, chunklen, end) { // eslint-disable-line camelcase
  //  discuss at: http://locutus.io/php/chunk_split/
  // original by: Paulo Freitas
  //    input by: Brett Zamir (http://brett-zamir.me)
  // bugfixed by: Kevin van Zonneveld (http://kvz.io)
  // improved by: Theriault (https://github.com/Theriault)
  //   example 1: chunk_split('Hello world!', 1, '*')
  //   returns 1: 'H*e*l*l*o* *w*o*r*l*d*!*'
  //   example 2: chunk_split('Hello world!', 10, '*')
  //   returns 2: 'Hello worl*d!*'
  chunklen = parseInt(chunklen, 10) || 76
  end = end || '\r\n'
  if (chunklen < 1) {
    return false
  }
  return body.match(new RegExp('.{0,' + chunklen + '}', 'g'))
    .join(end)
}

function strpos (haystack, needle, offset) {
  //  discuss at: http://locutus.io/php/strpos/
  // original by: Kevin van Zonneveld (http://kvz.io)
  // improved by: Onno Marsman (https://twitter.com/onnomarsman)
  // improved by: Brett Zamir (http://brett-zamir.me)
  // bugfixed by: Daniel Esteban
  //   example 1: strpos('Kevin van Zonneveld', 'e', 5)
  //   returns 1: 14
  var i = (haystack + '')
    .indexOf(needle, (offset || 0))
  return i === -1 ? false : i
}

function replaceAll(str, find, replace) {
  return str.replace(new RegExp(find, 'g'), replace);
}

function getLastNItems(arr,n)
{
  if(n==undefined) n = 5;
  return arr.slice(Math.max(arr.length - n, 1));
}

function addslashes( str ) {
    return (str + '').replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
}