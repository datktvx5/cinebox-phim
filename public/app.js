const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeImg = url => { try { const u = new URL(url, location.href); return u.protocol === 'https:' || (u.origin === location.origin && u.protocol === 'http:') ? u.href : ''; } catch { return ''; } };
const demos = [
  ['Chân Trời Rực Rỡ','Hành động','2026','movie','sunset'],['Dưới Bầu Trời Sao','Tâm lý','2025','movie','stars'],
  ['Hành Trình Mùa Hạ','Phiêu lưu','2026','series','summer'],['Dòng Thời Gian','Khoa học viễn tưởng','2024','movie','time'],
  ['Lời Hẹn Biển Xanh','Tình cảm','2025','series','ocean'],['Thành Phố Trong Sương','Bí ẩn','2026','movie','city'],
  ['Sau Cơn Mưa','Gia đình','2024','movie','rain'],['Những Ngày Xa','Chính kịch','2025','series','journey']
].map((x,i) => ({ id:'demo-'+i,title:x[0],genre:x[1],year:Number(x[2]),type:x[3],poster_url:`/assets/poster-${x[4]}.svg`,synopsis:'Nội dung minh họa giao diện CineBox, chưa có tập phim để phát.',episode_count:0,featured:i===0,demo:true }));
let allMovies = [], filtered = [], activeType = 'all', sort = 'new', realMovies = false;
let adConfig = null;
function notice(text) { const t=$('#toast'); t.textContent=text; t.classList.add('show'); clearTimeout(notice.timer); notice.timer=setTimeout(()=>t.classList.remove('show'),3500); }
async function request(url) { const r=await fetch(url); const v=await r.json(); if(!r.ok) throw new Error(v.error||'Lỗi tải dữ liệu'); return v; }
function fmtCount(n) {return new Intl.NumberFormat('vi-VN').format(n);}
function card(movie) {
  const cover=safeImg(movie.poster_url);
  const typename=movie.type==='series'?'PHIM BỘ':'PHIM LẺ';
  return `<article class="movie-card" role="button" tabindex="0" data-id="${escapeHTML(movie.id)}" aria-label="Xem ${escapeHTML(movie.title)}"><div class="poster">${cover?`<img loading="lazy" src="${escapeHTML(cover)}" alt="Poster ${escapeHTML(movie.title)}">`:`<div class="poster-fallback"><span>${escapeHTML(movie.title)}</span></div>`}<span class="badge-type">${typename}</span>${movie.demo?'<span class="badge-demo">PHIM MẪU</span>':''}<div class="play-circle">▶</div></div><h3 class="movie-title">${escapeHTML(movie.title)}</h3><div class="movie-meta"><span>${escapeHTML(movie.year)}</span><span class="dot">•</span><span>${escapeHTML(movie.genre)}</span><span class="movie-rating">★ ${movie.episode_count>0?`${movie.episode_count} tập`:'—'}</span></div></article>`;
}
function render() {
  const term=$('#search').value.trim().toLocaleLowerCase('vi-VN');
  filtered=allMovies.filter(m=>(activeType==='all'||m.type===activeType)&&(!term||`${m.title} ${m.genre} ${m.year}`.toLocaleLowerCase('vi-VN').includes(term)));
  if(sort==='az') filtered.sort((a,b)=>a.title.localeCompare(b.title,'vi'));
  if(sort==='year') filtered.sort((a,b)=>b.year-a.year);
  $('#movie-grid').innerHTML=filtered.map(card).join('');
  $('#empty').classList.toggle('hidden',filtered.length>0);
  $('#library-count').textContent=`${fmtCount(filtered.length)} phim trong bộ sưu tập`;
  $('#demo-note').classList.toggle('hidden',realMovies);
  $$('.pill').forEach(p=>p.classList.toggle('current',p.dataset.type===activeType));
  $$('.main-nav a').forEach(a=>a.classList.toggle('active',a.dataset.nav===activeType));
}
function adIframe(parent, html, extraClass='') {
  if(!html?.trim()) return;
  parent.classList.remove('hidden'); if(extraClass) parent.classList.add(extraClass);
  const frame=document.createElement('iframe'); frame.title='Quảng cáo'; frame.setAttribute('sandbox','allow-scripts allow-popups allow-popups-to-escape-sandbox'); frame.setAttribute('loading','lazy'); frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
  frame.srcdoc=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent;text-align:center;overflow:hidden;}</style></head><body>${html}</body></html>`;
  parent.replaceChildren(frame);
}
async function initAds() {
  try {
    adConfig=await request('/api/config');
    if(!adConfig.ads_enabled) return;
    adIframe($('#ad-top'),adConfig.ad_top);
    adIframe($('#ad-bottom'),adConfig.ad_player,'player-ad');
    const src=adConfig.ad_social.match(/<script[^>]+src=["']([^"']+)["']/i)?.[1]||adConfig.ad_social.trim();
    if(src) { const u=new URL(src,location.href); if(u.protocol==='https:'){const s=document.createElement('script');s.src=u.href;s.async=true;s.referrerPolicy='strict-origin-when-cross-origin';document.body.appendChild(s);} }
  } catch(e) {console.info('Quảng cáo chưa cấu hình:',e.message);}
}
// Mobile viewer controls live outside the Google Drive iframe: its controls cannot be restyled by CineBox.
function setupMobileViewerStyles() {
  if (document.getElementById('cinebox-mobile-viewer-style')) return;
  const sheet = document.createElement('style');
  sheet.id = 'cinebox-mobile-viewer-style';
  sheet.textContent = `
    #movie-dialog .cinebox-mobile-tools { display: none; }
    #movie-dialog #player .cinebox-fullscreen-exit { display: none; }
    @media screen and (max-width: 640px) {
      #movie-dialog .cinebox-mobile-tools {
        display: flex; justify-content: space-between; align-items: center;
        gap: 8px; padding: 8px 12px; background: #111928;
        color: #c9d2e0; font-size: 11px; line-height: 1.35;
      }
      #movie-dialog .cinebox-mobile-tools > span { flex: 1; min-width: 0; }
      #movie-dialog .cinebox-mobile-tools > button {
        flex: none; border: 0; border-radius: 8px; background: #f57554;
        color: #121826; font-size: 12px; font-weight: 800;
        padding: 11px 12px; min-height: 40px; touch-action: manipulation;
      }
    }
    /* This is intentionally outside the width media query: landscape devices exceed 640px. */
    #movie-dialog #player.player-wrap:fullscreen,
    #movie-dialog #player.player-wrap:-webkit-full-screen {
      position: fixed !important; inset: 0 !important; display: block !important;
      width: 100vw !important; height: 100vh !important; height: 100dvh !important;
      min-height: 0 !important; max-height: none !important;
      aspect-ratio: auto !important; overflow: hidden !important;
      margin: 0 !important; padding: 0 !important; border: 0 !important;
      border-radius: 0 !important; background: black !important;
    }
    #movie-dialog #player.player-wrap:fullscreen iframe,
    #movie-dialog #player.player-wrap:-webkit-full-screen iframe {
      position: absolute !important; inset: 0 !important;
      width: 100% !important; height: 100% !important;
      max-width: none !important; max-height: none !important;
      transform: none !important; border: 0 !important;
    }
    #movie-dialog #player.player-wrap:fullscreen .cinebox-fullscreen-exit,
    #movie-dialog #player.player-wrap:-webkit-full-screen .cinebox-fullscreen-exit {
      display: block !important; position: absolute !important; z-index: 8;
      top: calc(8px + env(safe-area-inset-top, 0px));
      right: calc(8px + env(safe-area-inset-right, 0px));
      border: 1px solid #ffffff70; border-radius: 8px;
      padding: 8px 12px; color: #fff; background: #121a2bde;
      font-size: 13px; font-weight: 700; min-height: 38px;
    }
  `;
  document.head.appendChild(sheet);
}
async function openMobileViewerFullscreen() {
  const player = $('#player');
  if (!player || !player.querySelector('iframe')) {
    notice('Hãy chọn một tập phim trước.');
    return;
  }
  if (!player.requestFullscreen) {
    notice('Trình duyệt chưa hỗ trợ nút này. Hãy xoay điện thoại ngang.');
    return;
  }
  try {
    await player.requestFullscreen();
  } catch (err) {
    notice('Không mở được toàn màn hình. Hãy thử xoay điện thoại ngang.');
    return;
  }
  // Android Chrome often permits orientation lock only after entering fullscreen.
  if (screen.orientation && typeof screen.orientation.lock === 'function') {
    try { await screen.orientation.lock('landscape'); }
    catch (_) { notice('Bạn hãy xoay ngang điện thoại để xem rõ thanh điều khiển.'); }
  } else {
    notice('Bạn hãy xoay ngang điện thoại để xem rõ thanh điều khiển.');
  }
}
async function exitMobileViewerFullscreen() {
  if (document.fullscreenElement && document.exitFullscreen) {
    try { await document.exitFullscreen(); } catch (_) { /* browser may have exited already */ }
  }
  if (screen.orientation && typeof screen.orientation.unlock === 'function') {
    try { screen.orientation.unlock(); } catch (_) { /* optional */ }
  }
}

function goToMovie(id){ if(id.startsWith('demo-')) { openDemo(id); return; } location.hash='watch/'+encodeURIComponent(id); }
function openDemo(id){const m=demos.find(m=>m.id===id); if(!m)return;showDialog(m,[],true);}
function showDialog(movie,eps,demonstration=false){
  const safeCover=safeImg(movie.poster_url);
  const html=`<div class="detail-hero"><div class="detail-top">${safeCover?`<img class="detail-poster" src="${escapeHTML(safeCover)}" alt="">`:'<div class="detail-poster"></div>'}<div><span class="detail-label">${movie.type==='series'?'SERIES / PHIM BỘ':'MOVIE / PHIM LẺ'}</span><h2>${escapeHTML(movie.title)}</h2><div class="detail-info">${escapeHTML(movie.year)} &nbsp; • &nbsp; ${escapeHTML(movie.genre)} &nbsp; • &nbsp; ${eps.length} tập</div><p class="detail-description">${escapeHTML(movie.synopsis || 'Chưa có giới thiệu cho phim này.')}</p></div></div></div><div class="cinebox-mobile-tools"><span>Thanh điều khiển Google Drive rõ hơn khi xoay ngang.</span><button type="button" data-cinebox-fullscreen>⛶ Xem rộng</button></div><div class="player-wrap" id="player"><div class="player-placeholder"><strong>${demonstration?'Đây là phim minh họa':eps.length?'Chọn một tập để phát phim':'Phim chưa có video'}</strong><p>${demonstration?'Hãy đăng phim thật trong trang quản trị.':eps.length?'Nhấn vào tập bên dưới để phát video từ Google Drive.':'Nội dung sẽ được cập nhật sau.'}</p></div></div><div class="player-foot">Video được phát thông qua trình xem của Google Drive; thời gian xử lý và hạn mức do Google quyết định.</div><section class="detail-section"><h3>Danh sách tập <span style="font-size:12px;color:#90a0b4;font-weight:normal">(${eps.length})</span></h3><div class="episode-grid">${eps.length?eps.map((e,i)=>`<button class="episode-btn" data-file="${escapeHTML(e.drive_file_id)}" data-index="${i}" data-share="${e.public_ok}">${escapeHTML(e.title)}</button>`).join(''):'<p style="font-size:12px;color:#90a0b4">Chưa có tập phim.</p>'}</div></section>`;
  $('#movie-content').innerHTML=html;$('#movie-dialog').showModal();document.body.style.overflow='hidden';
  const first=$('.episode-btn');if(first) selectEpisode(first);
}
function selectEpisode(button){
  const fileId=button.dataset.file;
  if(!/^[a-zA-Z0-9_-]{10,100}$/.test(fileId))return notice('Google Drive file ID không hợp lệ.');
  $$('.episode-btn').forEach(b=>b.classList.toggle('selected',b===button));
  const iframe=document.createElement('iframe');iframe.title=`Phát ${button.textContent}`;iframe.src=`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;iframe.allow='autoplay; fullscreen; picture-in-picture';iframe.allowFullscreen=true;iframe.referrerPolicy='strict-origin-when-cross-origin';
  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'cinebox-fullscreen-exit';
  exit.textContent = '✕ Thoát';
  exit.setAttribute('aria-label', 'Thoát toàn màn hình');
  exit.dataset.cineboxExit = '';
  $('#player').replaceChildren(iframe, exit);
  if(button.dataset.share==='0')notice('Tập phim có thể cần cấp quyền chia sẻ công khai trong Drive.');
}
async function openFromHash(){const hash=decodeURIComponent(location.hash.slice(1));const found=hash.match(/^watch\/([a-f0-9-]+)$/);if(!found)return;
  try{const data=await request('/api/movies/'+found[1]);showDialog(data.movie,data.episodes);}catch(e){notice(e.message);}
}
function closeDialog(){if($('#movie-dialog').open)$('#movie-dialog').close();document.body.style.overflow='';if(location.hash.startsWith('#watch/'))history.replaceState(null,'',location.pathname+'#library');}
async function init(){
  setupMobileViewerStyles();
  $('#year').textContent=new Date().getFullYear();
  $('#search').addEventListener('input',render);
  $('#sort').addEventListener('change',e=>{sort=e.target.value;render();});
  $('#filters').addEventListener('click',e=>{const btn=e.target.closest('[data-type]');if(!btn)return;activeType=btn.dataset.type;render();});
  $$('.main-nav a').forEach(a=>a.addEventListener('click',()=>{activeType=a.dataset.nav;render();document.querySelector('#library').scrollIntoView({behavior:'smooth'});}));
  $('#movie-grid').addEventListener('click',e=>{const c=e.target.closest('[data-id]');if(c)goToMovie(c.dataset.id);});
  $('#movie-grid').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){const c=e.target.closest('[data-id]');if(c){e.preventDefault();goToMovie(c.dataset.id);}}});
  $('#movie-content').addEventListener('click',e=>{
    if (e.target.closest('[data-cinebox-fullscreen]')) { openMobileViewerFullscreen(); return; }
    if (e.target.closest('[data-cinebox-exit]')) { exitMobileViewerFullscreen(); return; }
    const b=e.target.closest('.episode-btn');if(b)selectEpisode(b);
  });
  $('#dialog-close').addEventListener('click',closeDialog);
  $('#movie-dialog').addEventListener('close',()=>{document.body.style.overflow='';const p=$('#player');if(p)p.replaceChildren();});
  $('#movie-dialog').addEventListener('click',e=>{if(e.target===$('#movie-dialog'))closeDialog();});
  $('#reset-search').addEventListener('click',()=>{$('#search').value='';activeType='all';render();});
  $('#explore-btn').addEventListener('click',()=>$('#library').scrollIntoView({behavior:'smooth'}));
  window.addEventListener('hashchange',()=>{const hash=location.hash;if(hash.startsWith('#watch/'))openFromHash();else if(hash==='#movies'||hash==='#series'){activeType=hash==='#movies'?'movie':'series';render();}});
  try{const data=await request('/api/movies');realMovies=data.movies.length>0;allMovies=realMovies?data.movies:demos;}catch(e){realMovies=false;allMovies=demos;notice('Đang hiển thị phim mẫu. Cần triển khai API và tạo cơ sở dữ liệu.');}
  render();initAds();openFromHash();
}
init();
