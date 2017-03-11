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

function parseNPSLine(line)
{
  var a = line.split(",");
  if(a.length<25) return false;
  var server =   replaceAll(a[0],'"','');
  var date =     replaceAll(a[2],'"','');
  var time =     replaceAll(a[3],'"','');
  var type =     replaceAll(a[4],'"','');
  var client =   replaceAll(a[5],'"','');
  var origin =   replaceAll(a[6],'"','');
  var client_mac =   replaceAll(replaceAll(replaceAll(a[8].trim(),'"',''),':',''),'-','');
  var ap_host =  replaceAll(a[11],'"','');
  var ap_ip =    replaceAll(a[15],'"','');
  var ap_radname = replaceAll(a[16].toLowerCase(),'"','');
  var speed =    replaceAll(a[20],'"','');
  var policy =   replaceAll(a[60],'"','');
  var auth =   translateAuth(replaceAll(a[23],'"',''));
  var policy2 =   replaceAll(a[24],'"','');
  var reason =   replaceAll(a[25],'"','');
  var rs = translateReason(reason);
  var tt = translatePackageType(type);
  var ou = origin.split("/")[1];
  var temp = date.split("/");
  var temp2 = time.split(":");
  var timestamp = new Date(parseInt(temp[2]), parseInt(temp[0]) - 1, parseInt(temp[1]), parseInt(temp2[0]), parseInt(temp2[1]), parseInt(temp2[2]));

  return {
            server:server,
            date:date,
            time:time,
            type:type,
            client:client,
            origin:origin,
            client_mac:client_mac,
            ap_host:ap_host,
            ap_ip:ap_ip,
            ap_radname:ap_radname,
            speed:speed,
            policy:policy,
            auth:auth,
            policy2:policy2,
            reason:reason,
            rs:rs,
            tt:tt,
            ou:ou,
            timestamp:timestamp
          }
}

function getLastNItems(arr,n)
{
  if(n==undefined) n = 5;
  return arr.slice(Math.max(arr.length - n, 1));
}

function mac2vendor(mac)
{
  if(mac=="" || mac==" " || mac==undefined) return mac;
  var request = require('request');
  request('https://apiheaven.com/mac/?payload='+mac, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var info = JSON.parse(body);
      //console.log(body);
      $("#mac_"+mac).html(info.result);
    }
})
}

function getMonthName(month)
{
    var monthNames = ["WRONG INDEX","January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    return monthNames[month];
}