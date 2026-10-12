/** CineBox: Cloudflare Worker API + static asset hosting (October 2026). */
const SESSION_COOKIE = 'cinebox_session';
const SESSION_SECONDS = 12 * 60 * 60;
const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_MOVIE_BYTES = 25 * 1024 * 1024 * 1024;
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

const out = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
});
const fail = (message, code = 400) => out({ error: message }, code);
const now = () => Math.floor(Date.now() / 1000);
const uuid = () => crypto.randomUUID();
const enc = new TextEncoder();
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const from64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const constantEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let x = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) x |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return x === 0;
};
async function mac(message, key) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message))));
}
async function passwordMatch(input, correct) {
  if (!correct) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(input)), crypto.subtle.digest('SHA-256', enc.encode(correct))]);
  return constantEqual(b64u(new Uint8Array(a)), b64u(new Uint8Array(b)));
}
const cookie = (token, age) => `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/; Max-Age=${age}`;
async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const tok = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`))?.split('=')[1];
  if (!tok) return false;
  const dot = tok.indexOf('.');
  if (dot === -1) return false;
  const stamp = Number(tok.slice(0, dot));
  if (!Number.isInteger(stamp) || stamp > now() + 30 || stamp < now() - SESSION_SECONDS) return false;
  return constantEqual(tok.slice(dot + 1), await mac(String(stamp), env.SESSION_SECRET));
}
const requireOrigin = request => {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  return (!origin || origin === new URL(request.url).origin) && (!site || ['same-origin', 'none'].includes(site));
};
async function jsonBody(request, max = 30000) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > max) throw new Error('Dữ liệu gửi lên vượt giới hạn.');
  const text = await request.text();
  if (text.length > max) throw new Error('Dữ liệu gửi lên vượt giới hạn.');
  return JSON.parse(text);
}
function validMovie(data) {
  const title = String(data.title || '').trim().slice(0, 130);
  if (title.length < 2) throw new Error('Tên phim phải có ít nhất 2 ký tự.');
  const type = data.type === 'series' ? 'series' : 'movie';
  const year = Math.max(1900, Math.min(2100, Number(data.year) || new Date().getFullYear()));
  const poster = String(data.poster_url || '').trim().slice(0, 1500);
  const backdrop = String(data.backdrop_url || '').trim().slice(0, 1500);
  for (const u of [poster, backdrop]) if (u && !/^https:\/\//i.test(u)) throw new Error('Link hình ảnh phải bắt đầu bằng https://');
  return [title, String(data.genre || 'Khác').trim().slice(0, 100), year, type, String(data.synopsis || '').trim().slice(0, 3000), poster, backdrop, data.featured ? 1 : 0, data.published === false ? 0 : 1];
}
function oauthKey(env) {
  if (!env.GOOGLE_TOKEN_KEY) throw new Error('Thiếu GOOGLE_TOKEN_KEY. Hãy cài bằng wrangler secret put.');
  const key = from64(env.GOOGLE_TOKEN_KEY);
  if (key.length !== 32) throw new Error('GOOGLE_TOKEN_KEY phải là khóa 32 byte được mã hóa Base64.');
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(text, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await oauthKey(env), enc.encode(text)));
  return b64u(iv) + '.' + b64u(cipher);
}
async function unseal(text, env) {
  const [iv, cipher] = text.split('.');
  if (!iv || !cipher) throw new Error('Không giải mã được token Google Drive.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: from64(iv) }, await oauthKey(env), from64(cipher)));
}
async function googleExchange(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body)
  });
  const response = await res.json();
  if (!res.ok) throw new Error(`Google OAuth: ${response.error_description || response.error || res.status}`);
  return response;
}
const getConnection = async env => env.DB.prepare('SELECT * FROM google_connection WHERE id=1').first();
async function googleToken(env) {
  const row = await getConnection(env);
  if (!row) throw new Error('Chưa liên kết Google Drive. Vào Quản trị → Kết nối Drive.');
  if (row.access_cipher && row.access_expires > now() + 100) return { token: await unseal(row.access_cipher, env), folderId: row.folder_id };
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Thiếu thông tin Google OAuth.');
  const data = await googleExchange({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, refresh_token: await unseal(row.refresh_cipher, env), grant_type: 'refresh_token' });
  await env.DB.prepare('UPDATE google_connection SET access_cipher=?, access_expires=? WHERE id=1').bind(await seal(data.access_token, env), now() + Number(data.expires_in || 3600)).run();
  return { token: data.access_token, folderId: row.folder_id };
}
async function driveJson(url, { method = 'GET', token, json, headers = {} }) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : undefined });
  const text = await res.text();
  const obj = text ? (() => { try { return JSON.parse(text); } catch { return { error: { message: text.slice(0, 300) } }; } })() : {};
  if (!res.ok) throw new Error('Google Drive: ' + (obj.error?.message || res.status));
  return obj;
}
async function makePublic(fileId, env) {
  try {
    const { token } = await googleToken(env);
    await driveJson(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?fields=id`, { method: 'POST', token, json: { role: 'reader', type: 'anyone', allowFileDiscovery: false } });
    return true;
  } catch { return false; }
}
async function finishUpload(session, file, env) {
  if (!file?.id) throw new Error('Google Drive không trả về file ID.');
  const publicOk = await makePublic(file.id, env);
  const eid = uuid();
  await env.DB.prepare('INSERT INTO episodes (id,movie_id,title,episode_number,drive_file_id,file_size,public_ok) VALUES (?,?,?,?,?,?,?)')
    .bind(eid, session.movie_id, session.title, session.episode_number, file.id, session.total_bytes, publicOk ? 1 : 0).run();
  await env.DB.prepare('DELETE FROM upload_sessions WHERE id=?').bind(session.id).run();
  return { complete: true, episodeId: eid, driveFileId: file.id, publicOk, warning: publicOk ? null : 'Đã tải lên nhưng Drive chặn chia sẻ công khai. Hãy kiểm tra quyền chia sẻ của file.' };
}
async function uploadStatus(session, env) {
  const res = await fetch(session.session_uri, { method: 'PUT', headers: { 'Content-Range': `bytes */${session.total_bytes}`, 'Content-Length': '0' } });
  if (res.status === 308) {
    const range = res.headers.get('Range');
    const bytes = range ? Number(range.split('-').at(-1)) + 1 : 0;
    await env.DB.prepare('UPDATE upload_sessions SET sent_bytes=? WHERE id=?').bind(bytes, session.id).run();
    return { complete: false, nextOffset: bytes };
  }
  if (res.ok) return await finishUpload(session, await res.json(), env);
  throw new Error(`Không kiểm tra được upload trên Drive (HTTP ${res.status}).`);
}
async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  if (!state) return new Response('Thiếu mã xác minh OAuth.', { status: 400 });
  const row = await env.DB.prepare('SELECT state FROM oauth_states WHERE state=? AND created_at>?').bind(state, now() - 600).first();
  if (!row) return new Response('Phiên kết nối không hợp lệ hoặc đã hết hạn.', { status: 403 });
  await env.DB.prepare('DELETE FROM oauth_states WHERE state=?').bind(state).run();
  if (url.searchParams.get('error')) return Response.redirect(`${url.origin}/admin.html?google=cancelled`, 302);
  try {
    const code = url.searchParams.get('code');
    if (!code) throw new Error('Google không cung cấp authorization code.');
    const data = await googleExchange({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${url.origin}/api/admin/google/callback`, grant_type: 'authorization_code' });
    if (!data.refresh_token) throw new Error('Google không cung cấp refresh token. Hãy cấp quyền lại với prompt=consent.');
    const folder = await driveJson('https://www.googleapis.com/drive/v3/files?fields=id,name', { method: 'POST', token: data.access_token, json: { name: 'CineBox Phim', mimeType: 'application/vnd.google-apps.folder' } });
    await env.DB.prepare('INSERT INTO google_connection(id,refresh_cipher,access_cipher,access_expires,folder_id) VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET refresh_cipher=excluded.refresh_cipher, access_cipher=excluded.access_cipher, access_expires=excluded.access_expires, folder_id=excluded.folder_id')
      .bind(await seal(data.refresh_token, env), await seal(data.access_token, env), now() + Number(data.expires_in || 3600), folder.id).run();
    return Response.redirect(`${url.origin}/admin.html?google=connected`, 302);
  } catch (e) { return new Response(`Không kết nối được Google Drive: ${e.message}. Quay lại trang quản trị để thử lại.`, { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
}
async function api(request, env) {
  const { pathname, origin, searchParams } = new URL(request.url);
  const method = request.method.toUpperCase();
  if (pathname === '/api/health' && method === 'GET') return out({ ok: true, app: 'CineBox' });
  if (pathname === '/api/admin/google/callback' && method === 'GET') return oauthCallback(request, env);
  if (pathname === '/api/movies' && method === 'GET') {
    const rows = await env.DB.prepare(`SELECT m.*, (SELECT COUNT(*) FROM episodes e WHERE e.movie_id=m.id) AS episode_count FROM movies m WHERE m.published=1 ORDER BY m.featured DESC, m.created_at DESC LIMIT 200`).all();
    return out({ movies: rows.results });
  }
  const publicMovie = pathname.match(/^\/api\/movies\/([a-f0-9-]+)$/);
  if (publicMovie && method === 'GET') {
    const movie = await env.DB.prepare('SELECT * FROM movies WHERE id=? AND published=1').bind(publicMovie[1]).first();
    if (!movie) return fail('Không tìm thấy phim.', 404);
    const eps = await env.DB.prepare('SELECT id,title,episode_number,drive_file_id,public_ok FROM episodes WHERE movie_id=? ORDER BY episode_number').bind(movie.id).all();
    return out({ movie, episodes: eps.results });
  }
  if (pathname === '/api/config' && method === 'GET') {
    const s = await env.DB.prepare('SELECT key,value FROM settings WHERE key IN (?,?,?,?)').bind('ads_enabled','ad_top','ad_player','ad_social').all();
    const data = Object.fromEntries(s.results.map(x => [x.key, x.value]));
    return out({ ads_enabled: data.ads_enabled === 'true', ad_top: data.ad_top || '', ad_player: data.ad_player || '', ad_social: data.ad_social || '' });
  }
  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!requireOrigin(request)) return fail('Nguồn truy cập không hợp lệ.', 403);
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return fail('Quản trị chưa được cấu hình. Xem README.md.', 503);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const attempt = await env.DB.prepare('SELECT * FROM login_attempts WHERE ip=?').bind(ip).first();
    if (attempt?.blocked_until > now() && attempt.count >= 5) return fail('Đăng nhập sai nhiều lần. Thử lại sau 15 phút.', 429);
    const body = await jsonBody(request, 2000);
    if (!(await passwordMatch(String(body.password || ''), env.ADMIN_PASSWORD))) {
      const attempts = attempt && attempt.blocked_until > now() ? attempt.count + 1 : 1;
      await env.DB.prepare('INSERT INTO login_attempts(ip,count,blocked_until) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET count=excluded.count, blocked_until=excluded.blocked_until')
        .bind(ip, attempts, now() + 900).run();
      return fail('Mật khẩu không đúng.', 401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
    const stamp = now();
    return out({ ok: true }, 200, { 'Set-Cookie': cookie(`${stamp}.${await mac(String(stamp), env.SESSION_SECRET)}`, SESSION_SECONDS) });
  }
  if (pathname === '/api/admin/session' && method === 'GET') return out({ authenticated: await isAdmin(request, env) });
  if (!pathname.startsWith('/api/admin/')) return fail('Đường dẫn không tồn tại.', 404);
  if (!(await isAdmin(request, env))) return fail('Bạn cần đăng nhập quản trị.', 401);
  if (!['GET', 'HEAD'].includes(method) && !requireOrigin(request)) return fail('Nguồn truy cập không hợp lệ.', 403);
  if (pathname === '/api/admin/logout' && method === 'POST') return out({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  if (pathname === '/api/admin/status' && method === 'GET') {
    const [movies, episodes, connection] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) n FROM movies').first(), env.DB.prepare('SELECT COUNT(*) n FROM episodes').first(), getConnection(env)
    ]);
    return out({ movies: movies.n, episodes: episodes.n, googleConnected: !!connection, googleFolderId: connection?.folder_id || null, googleConfigured: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY) });
  }
  if (pathname === '/api/admin/google/connect' && method === 'GET') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_TOKEN_KEY) return fail('Cần cài GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET và GOOGLE_TOKEN_KEY trong Cloudflare.', 503);
    const state = b64u(crypto.getRandomValues(new Uint8Array(24)));
    await env.DB.prepare('INSERT INTO oauth_states(state,created_at) VALUES(?,?)').bind(state, now()).run();
    const google = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    Object.entries({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${origin}/api/admin/google/callback`, response_type: 'code', access_type: 'offline', prompt: 'consent', scope: DRIVE_SCOPE, state }).forEach(([k, v]) => google.searchParams.set(k, v));
    return out({ url: google.toString() });
  }
  if (pathname === '/api/admin/google/disconnect' && method === 'POST') {
    await env.DB.prepare('DELETE FROM google_connection WHERE id=1').run();
    return out({ ok: true });
  }
  if (pathname === '/api/admin/movies' && method === 'GET') {
    const rows = await env.DB.prepare('SELECT m.*, (SELECT COUNT(*) FROM episodes e WHERE e.movie_id=m.id) episode_count FROM movies m ORDER BY m.created_at DESC LIMIT 300').all();
    return out({ movies: rows.results });
  }
  if (pathname === '/api/admin/movies' && method === 'POST') {
    const fields = validMovie(await jsonBody(request));
    const id = uuid();
    await env.DB.prepare('INSERT INTO movies (id,title,genre,year,type,synopsis,poster_url,backdrop_url,featured,published) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, ...fields).run();
    return out({ id, ok: true }, 201);
  }
  const idMovie = pathname.match(/^\/api\/admin\/movies\/([a-f0-9-]+)$/);
  if (idMovie && method === 'PUT') {
    const fields = validMovie(await jsonBody(request));
    const result = await env.DB.prepare('UPDATE movies SET title=?,genre=?,year=?,type=?,synopsis=?,poster_url=?,backdrop_url=?,featured=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(...fields, idMovie[1]).run();
    return result.meta.changes ? out({ ok: true }) : fail('Không tìm thấy phim.', 404);
  }
  if (idMovie && method === 'DELETE') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM upload_sessions WHERE movie_id=?').bind(idMovie[1]),
      env.DB.prepare('DELETE FROM episodes WHERE movie_id=?').bind(idMovie[1]),
      env.DB.prepare('DELETE FROM movies WHERE id=?').bind(idMovie[1])
    ]);
    return out({ ok: true, note: 'Chỉ xóa dữ liệu phim, không xóa file trên Google Drive.' });
  }
  const movieEps = pathname.match(/^\/api\/admin\/movies\/([a-f0-9-]+)\/episodes$/);
  if (movieEps && method === 'GET') {
    const eps = await env.DB.prepare('SELECT * FROM episodes WHERE movie_id=? ORDER BY episode_number').bind(movieEps[1]).all();
    return out({ episodes: eps.results });
  }
  if (movieEps && method === 'POST') {
    const b = await jsonBody(request, 5000);
    const driveId = String(b.drive_file_id || '').trim();
    const num = Number(b.episode_number);
    if (!/^[a-zA-Z0-9_-]{10,100}$/.test(driveId) || !Number.isInteger(num) || num < 1 || num > 9999) return fail('File ID Google Drive hoặc số tập không hợp lệ.');
    const movie = await env.DB.prepare('SELECT id FROM movies WHERE id=?').bind(movieEps[1]).first();
    if (!movie) return fail('Không tìm thấy phim.', 404);
    const exists = await env.DB.prepare('SELECT id FROM episodes WHERE movie_id=? AND episode_number=?').bind(movieEps[1], num).first();
    if (exists) return fail('Số tập đã tồn tại.', 409);
    const publicOk = await makePublic(driveId, env);
    await env.DB.prepare('INSERT INTO episodes (id,movie_id,title,episode_number,drive_file_id,file_size,public_ok) VALUES (?,?,?,?,?,0,?)').bind(uuid(), movieEps[1], String(b.title || `Tập ${num}`).slice(0, 140), num, driveId, publicOk ? 1 : 0).run();
    return out({ ok: true, publicOk, warning: !publicOk ? 'Kiểm tra quyền chia sẻ file (bất kỳ ai có liên kết).' : null }, 201);
  }
  const epId = pathname.match(/^\/api\/admin\/episodes\/([a-f0-9-]+)$/);
  if (epId && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM episodes WHERE id=?').bind(epId[1]).run();
    return out({ ok: true, note: 'File gốc vẫn còn trong Google Drive.' });
  }
  const epPublic = pathname.match(/^\/api\/admin\/episodes\/([a-f0-9-]+)\/share$/);
  if (epPublic && method === 'POST') {
    const e = await env.DB.prepare('SELECT * FROM episodes WHERE id=?').bind(epPublic[1]).first();
    if (!e) return fail('Không tìm thấy tập phim.', 404);
    const ok = await makePublic(e.drive_file_id, env);
    await env.DB.prepare('UPDATE episodes SET public_ok=? WHERE id=?').bind(ok ? 1 : 0, e.id).run();
    return out({ publicOk: ok, warning: ok ? null : 'Hãy cấp quyền bất kỳ ai có liên kết trong Google Drive.' });
  }
  if (pathname === '/api/admin/ads' && method === 'GET') {
    const rows = await env.DB.prepare("SELECT key,value FROM settings WHERE key LIKE 'ad_%' OR key='ads_enabled'").all();
    return out(Object.fromEntries(rows.results.map(x => [x.key, x.value])));
  }
  if (pathname === '/api/admin/ads' && method === 'PUT') {
    const body = await jsonBody(request, 45000);
    const pairs = [['ads_enabled', body.ads_enabled ? 'true' : 'false'], ['ad_top', String(body.ad_top || '').slice(0, 12000)], ['ad_player', String(body.ad_player || '').slice(0, 12000)], ['ad_social', String(body.ad_social || '').slice(0, 2000)]];
    await env.DB.batch(pairs.map(([k, v]) => env.DB.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, v)));
    return out({ ok: true });
  }
  if (pathname === '/api/admin/uploads' && method === 'POST') {
    const b = await jsonBody(request, 8000);
    const movieId = String(b.movie_id || '');
    const num = Number(b.episode_number);
    const size = Number(b.size);
    const mime = String(b.mime || 'video/mp4').slice(0, 100);
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MOVIE_BYTES) return fail('Video phải có dung lượng từ 1 byte đến 25 GB.');
    if (!/^video\/[a-zA-Z0-9.+-]+$/.test(mime) && mime !== 'application/octet-stream') return fail('Vui lòng chọn tệp video.');
    if (!Number.isInteger(num) || num < 1 || num > 9999) return fail('Số tập không hợp lệ.');
    const movie = await env.DB.prepare('SELECT title FROM movies WHERE id=?').bind(movieId).first();
    if (!movie) return fail('Không tìm thấy phim.', 404);
    const exists = await env.DB.prepare('SELECT id FROM episodes WHERE movie_id=? AND episode_number=?').bind(movieId, num).first();
    if (exists) return fail('Số tập đã tồn tại.', 409);
    const { token, folderId } = await googleToken(env);
    const filename = String(b.filename || 'video.mp4').replace(/[^a-zA-Z0-9. _()-]/g, '_').slice(0, 150);
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name: `${movie.title.slice(0, 60)} - T${num} - ${filename}`, parents: [folderId], mimeType: mime })
    });
    if (!res.ok) return fail('Google Drive không khởi tạo được phiên upload: ' + (await res.text()).slice(0, 350), 502);
    const sessionUri = res.headers.get('Location');
    if (!sessionUri || !sessionUri.startsWith('https://')) return fail('Drive không trả về địa chỉ upload.', 502);
    const id = uuid();
    await env.DB.prepare('INSERT INTO upload_sessions (id,movie_id,title,episode_number,total_bytes,mime_type,session_uri,sent_bytes,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, movieId, String(b.title || `Tập ${num}`).slice(0, 140), num, size, mime, sessionUri, 0, now()).run();
    return out({ uploadId: id, chunkSize: CHUNK_BYTES, nextOffset: 0 }, 201);
  }
  const uploadId = pathname.match(/^\/api\/admin\/uploads\/([a-f0-9-]+)$/);
  if (uploadId && ['GET', 'PUT'].includes(method)) {
    const s = await env.DB.prepare('SELECT * FROM upload_sessions WHERE id=?').bind(uploadId[1]).first();
    if (!s) return fail('Phiên upload không tồn tại hoặc đã hoàn tất.', 404);
    if (method === 'GET') return out(await uploadStatus(s, env));
    const start = Number(request.headers.get('X-Upload-Offset'));
    if (!Number.isSafeInteger(start) || start !== s.sent_bytes) return out({ error: 'Vị trí gửi không khớp.', nextOffset: s.sent_bytes }, 409);
    const declared = Number(request.headers.get('Content-Length') || -1);
    if (declared > CHUNK_BYTES) return fail('Chunk vượt quá 4 MB.', 413);
    const bytes = await request.arrayBuffer();
    const len = bytes.byteLength;
    if (declared >= 0 && len !== declared) return fail('Dung lượng truyền thực tế không khớp.', 400);
    if (!Number.isSafeInteger(len) || len <= 0 || len > CHUNK_BYTES || start + len > s.total_bytes) return fail('Kích thước phần upload không hợp lệ.', 413);
    if (start + len < s.total_bytes && len % (256 * 1024) !== 0) return fail('Chunk phải là bội số 256 KiB.');
    const res = await fetch(s.session_uri, { method: 'PUT', headers: { 'Content-Length': String(len), 'Content-Range': `bytes ${start}-${start + len - 1}/${s.total_bytes}`, 'Content-Type': s.mime_type }, body: bytes });
    if (res.status === 308) {
      const range = res.headers.get('Range');
      const next = range ? Number(range.split('-').at(-1)) + 1 : start + len;
      await env.DB.prepare('UPDATE upload_sessions SET sent_bytes=? WHERE id=?').bind(next, s.id).run();
      return out({ complete: false, nextOffset: next });
    }
    if (!res.ok) return fail('Google Drive báo lỗi upload HTTP ' + res.status + ': ' + (await res.text()).slice(0, 250), 502);
    return out(await finishUpload(s, await res.json(), env));
  }
  return fail('Đường dẫn API không tồn tại.', 404);
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        if (!env.DB) return fail('Chưa liên kết cơ sở dữ liệu Cloudflare D1.', 503);
        return await api(request, env);
      }
      if (url.pathname === '/admin') return Response.redirect(url.origin + '/admin.html', 302);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error('CineBox worker:', e);
      if (e instanceof SyntaxError) return fail('JSON không hợp lệ.', 400);
      if (/UNIQUE constraint|SQLITE_CONSTRAINT_UNIQUE/i.test(e.message)) return fail('Dữ liệu đã tồn tại. Hãy chọn số tập khác.', 409);
      return fail(e.message || 'Có lỗi máy chủ. Hãy kiểm tra cấu hình Cloudflare.', 500);
    }
  }
};
