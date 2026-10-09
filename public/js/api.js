/* FTS CPR — talking to the server (through /api/gas on Vercel). */
var API = (function () {
  'use strict';
  var token = '';
  try { token = localStorage.getItem('cpr.token') || ''; } catch (e) {}
  var api = {onExpired: null};
  api.token = function () { return token; };
  api.setToken = function (t) { token = t || ''; try { if (t) localStorage.setItem('cpr.token', t); else localStorage.removeItem('cpr.token'); } catch (e) {} };

  api.call = async function (action, payload) {
    var res, j;
    try {
      res = await fetch('/api/gas', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: action, token: token, payload: payload || {}})});
    } catch (e) { throw {code: 'OFFLINE', message: 'No internet connection. Please check your connection and try again.'}; }
    try { j = await res.json(); } catch (e) { throw {code: 'SERVER', message: 'The server did not answer properly. Please try again.'}; }
    if (!j || !j.ok) {
      var err = (j && j.error) || {code: 'SERVER', message: 'Something went wrong. Please try again.'};
      if (err.code === 'SESSION_EXPIRED' && api.onExpired) api.onExpired(err.message);
      throw err;
    }
    return j.data;
  };

  function readAsBase64(blob) {
    return new Promise(function (ok, fail) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1] || ''); }; r.onerror = function () { fail({code: 'READ', message: 'This file could not be read. Please choose it again.'}); }; r.readAsDataURL(blob); });
  }

  /** Make phone photos smaller before upload (keeps documents readable). Returns a File. */
  api.shrinkImage = async function (file, maxSide, quality, onlyIfBiggerThan) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= (onlyIfBiggerThan || 0)) return file;
    try {
      var bmp = await createImageBitmap(file), scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      var blob = await new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', quality); });
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.(png|jpe?g|webp)$/i, '') + '.jpg', {type: 'image/jpeg'});
    } catch (e) { return file; }
  };

  /** Reject files that are not real, readable pictures. */
  api.checkImage = async function (file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw {code: 'BAD_TYPE', message: 'Please choose a JPG, PNG or WEBP photograph.'};
    try { var bmp = await createImageBitmap(file); if (bmp.close) bmp.close(); }
    catch (e) { throw {code: 'BAD_IMAGE', message: 'This file could not be opened as a picture. Please choose another photograph.'}; }
  };

  /** Upload a file in pieces. extra = {kind, reportId, eventId?}. onProgress(0..1). */
  api.upload = async function (file, extra, chunkChars, onProgress) {
    var b64 = await readAsBase64(file), size = chunkChars || 3000000, parts = [];
    for (var i = 0; i < b64.length; i += size) parts.push(b64.slice(i, i + size));
    if (!parts.length) parts.push('');
    var res = null;
    for (var k = 0; k < parts.length; k++) {
      var p = {index: k, total: parts.length, data: parts[k], uploadId: res && res.uploadId, fileName: file.name, size: file.size, kind: extra.kind, reportId: extra.reportId, eventId: extra.eventId, replaceFileId: extra.replaceFileId || ''};
      try { res = await api.call('file.uploadChunk', p); }
      catch (e) { if (e.code === 'OFFLINE' || e.code === 'UPSTREAM' || e.code === 'SERVER') e.message = 'File upload failed. Please try again.'; throw e; }
      if (onProgress) onProgress((k + 1) / parts.length);
    }
    return res;
  };

  /** Download a stored file in pieces and save it. */
  api.download = async function (fileId, onProgress) {
    var off = 0, chunks = [], meta = null;
    for (;;) {
      var r = await api.call('file.download', {fileId: fileId, offset: off});
      meta = r;
      var bin = atob(r.data), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      chunks.push(arr); off += arr.length;
      if (onProgress && r.size) onProgress(off / r.size);
      if (r.done || !arr.length) break;
    }
    api.saveBlob(new Blob(chunks, {type: meta.mime || 'application/octet-stream'}), meta.name);
  };
  api.saveBase64 = function (b64, name, mime) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    api.saveBlob(new Blob([arr], {type: mime}), name);
  };
  api.saveBlob = function (blob, name) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name || 'download';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  return api;
})();
