const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const img = url => { try{const u=new URL(url,location.href);return u.protocol==='https:'?u.href:'';}catch{return '';} };
let movies=[], currentEdit=null, busy=false, adminStatus=null, selectedId='';
const titles={dashboard:'Tổng quan',movies:'Kho phim',uploads:'Tải phim lên',ads:'Quảng cáo Adsterra',settings:'Kết nối Google Drive'};
function toast(message,err=false){const t=$('#admin-toast');t.textContent=message;t.style.borderColor=err?'#d97979':'#658aaf';t.classList.add('show');clearTimeout(toast.id);toast.id=setTimeout(()=>t.classList.remove('show'),4500);}
async function api(path,options={}){
  const headers={...options.headers};let body=options.body;
  if(body && !(body instanceof Blob) && typeof body!=='string'){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  const r=await fetch(path,{...options,headers,body,credentials:'same-origin'});
  let data;try{data=await r.json();}catch{data={error:`HTTP ${r.status}`};}
  if(!r.ok){const error=new Error(data.error||'Yêu cầu thất bại');error.status=r.status;error.data=data;throw error;}
  return data;
}
function loginState(authenticated){$('#login-screen').classList.toggle('hidden',authenticated);$('#admin-app').classList.toggle('hidden',!authenticated);}
function switchTab(name){if(!titles[name])name='dashboard';$$('.admin-tab').forEach(el=>el.classList.toggle('hidden',el.id!==`tab-${name}`));$$('.tab-link').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));$('#page-title').textContent=titles[name];window.scrollTo({top:0,behavior:'smooth'});if(name==='settings')refreshStatus();if(name==='uploads')refreshEpisodes();if(name==='ads')loadAds();}
async function refreshStatus(){
  try {const data=await api('/api/admin/status');adminStatus=data;$('#stat-movies').textContent=data.movies;$('#stat-eps').textContent=data.episodes;$('#stat-drive').textContent=data.googleConnected?'Đã kết nối':'Chưa kết nối';$('#stat-drive').style.color=data.googleConnected?'#70e6ac':'#ffb894';$('#drive-description').textContent=data.googleConnected?'Drive đã sẵn sàng nhận video.':'Chưa liên kết tài khoản Drive. Kết nối để tải phim lên.';$('#drive-folder').textContent=data.googleFolderId?'Thư mục ID: '+data.googleFolderId:'';$('#drive-pill').textContent=data.googleConnected?'● Đã kết nối':'○ Chưa kết nối';$('#drive-pill').classList.toggle('connected',data.googleConnected);$('#connect-drive').textContent=data.googleConnected?'Đổi tài khoản Google →':'Liên kết tài khoản Google →';$('#disconnect-drive').classList.toggle('hidden',!data.googleConnected);if(!data.googleConfigured)$('#drive-description').textContent='Chưa đặt đủ secrets Google OAuth trên Cloudflare.';}
  catch(e){toast(e.message,true);}
}
async function refreshMovies(){
  try {const data=await api('/api/admin/movies');movies=data.movies;renderMovieTable();const selector=$('#upload-movie');const before=selectedId||selector.value;selector.innerHTML='<option value="">— Chọn phim —</option>'+movies.map(m=>`<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('');if(movies.some(m=>m.id===before))selector.value=before;selectedId=selector.value;await refreshStatus();}
  catch(e){toast(e.message,true);}
}
function renderMovieTable(){const tbody=$('#movie-table');if(!movies.length){tbody.innerHTML='<tr><td colspan="6" style="text-align:center;padding:36px;color:#92a4b8">Chưa có phim. Nhấn “Đăng phim mới” để bắt đầu.</td></tr>';return;}
  tbody.innerHTML=movies.map(m=>`<tr><td><div class="film-cell">${img(m.poster_url)?`<img src="${esc(img(m.poster_url))}" alt="">`:'<span class="film-placeholder"></span>'}<div><b>${esc(m.title)}</b><small>${m.type==='series'?'Phim bộ':'Phim lẻ'}</small></div></div></td><td>${esc(m.genre)}</td><td>${esc(m.year)}</td><td><span class="status-tag ${m.published?'':'off'}">${m.published?'Đang hiển thị':'Đã ẩn'}</span></td><td>${esc(m.episode_count)}</td><td><div class="table-actions"><button class="mini-btn" data-action="episodes" data-id="${esc(m.id)}" title="Quản lý tập">⇧ Tập</button><button class="mini-btn" data-action="edit" data-id="${esc(m.id)}">Sửa</button><button class="mini-btn danger" data-action="delete" data-id="${esc(m.id)}">Xóa</button></div></td></tr>`).join('');
}
function showMovieForm(movie=null){switchTab('movies');currentEdit=movie?.id||null;$('#form-heading').textContent=movie?'Chỉnh sửa phim':'Đăng phim mới';const form=$('#movie-form');form.reset();if(movie){for(const key of ['title','genre','year','type','synopsis','poster_url','backdrop_url'])form.elements.namedItem(key).value=movie[key]||'';form.elements.namedItem('featured').checked=!!movie.featured;form.elements.namedItem('published').checked=!!movie.published;}else{form.elements.namedItem('year').value=new Date().getFullYear();form.elements.namedItem('published').checked=true;}$('#movie-form-card').classList.remove('hidden');$('#movie-form-card').scrollIntoView({behavior:'smooth',block:'start'});}
function hideMovieForm(){currentEdit=null;$('#movie-form-card').classList.add('hidden');}
async function saveMovie(event){event.preventDefault();if(busy)return;const f=event.target;const values=Object.fromEntries(new FormData(f).entries());values.featured=f.elements.namedItem('featured').checked;values.published=f.elements.namedItem('published').checked;values.year=Number(values.year);busy=true;$('#save-movie').disabled=true;
  try{const path=currentEdit?`/api/admin/movies/${currentEdit}`:'/api/admin/movies';const res=await api(path,{method:currentEdit?'PUT':'POST',body:values});if(!currentEdit)selectedId=res.id;toast(currentEdit?'Đã cập nhật phim.':'Đăng phim thành công! Bây giờ có thể tải tập phim lên.');hideMovieForm();await refreshMovies();}
  catch(e){toast(e.message,true);}finally{busy=false;$('#save-movie').disabled=false;}
}
async function movieTableAction(event){const b=event.target.closest('[data-action]');if(!b)return;const m=movies.find(x=>x.id===b.dataset.id);if(!m)return;
  if(b.dataset.action==='edit')showMovieForm(m);
  if(b.dataset.action==='episodes'){selectedId=m.id;$('#upload-movie').value=m.id;switchTab('uploads');await refreshEpisodes();}
  if(b.dataset.action==='delete'){
    if(!confirm(`Xóa “${m.title}” khỏi website và danh sách tập?\n\nLưu ý: file video trên Google Drive sẽ KHÔNG bị xóa.`))return;
    try{await api(`/api/admin/movies/${m.id}`,{method:'DELETE'});toast('Đã xóa thông tin phim. File Drive vẫn còn.');await refreshMovies();}catch(e){toast(e.message,true);}
  }
}
async function refreshEpisodes(){const id=$('#upload-movie').value;selectedId=id;const container=$('#episode-list');$('#episode-list-title').textContent=id?`— ${movies.find(m=>m.id===id)?.title||''}`:'';if(!id){container.innerHTML='<p class="note">Chọn một phim để xem các tập.</p>';return;}try{const res=await api(`/api/admin/movies/${id}/episodes`);container.innerHTML=res.episodes.length?res.episodes.map(ep=>`<div class="episode-row"><div><b>Tập ${ep.episode_number}: ${esc(ep.title)}</b><small>${ep.file_size?(ep.file_size/1048576).toFixed(1)+' MB':'Video Drive đã có'} · ${ep.public_ok?'✓ Đã cấp quyền xem':'⚠ Kiểm tra quyền xem'}</small></div><div class="episode-tools"><a class="mini-btn" href="https://drive.google.com/file/d/${encodeURIComponent(ep.drive_file_id)}/view" target="_blank" rel="noopener noreferrer">Mở Drive ↗</a><button class="mini-btn" data-epaction="share" data-id="${esc(ep.id)}">Cấp quyền</button><button class="mini-btn danger" data-epaction="delete" data-id="${esc(ep.id)}">Xóa tập</button></div></div>`).join(''):'<p class="note">Chưa có tập phim. Hãy chọn file để tải lên.</p>';}catch(e){container.textContent=e.message;}
}
async function episodeAction(event){const b=event.target.closest('[data-epaction]');if(!b)return;try{if(b.dataset.epaction==='delete'){if(!confirm('Xóa tập khỏi website? Video trên Drive không bị xóa.'))return;await api('/api/admin/episodes/'+b.dataset.id,{method:'DELETE'});toast('Đã xóa tập.');}else{const res=await api('/api/admin/episodes/'+b.dataset.id+'/share',{method:'POST'});toast(res.publicOk?'Đã cấp quyền xem thành công.':res.warning,!res.publicOk);}await refreshEpisodes();await refreshMovies();}catch(e){toast(e.message,true);}}
const mb = size => size >= 1073741824 ? (size/1073741824).toFixed(2)+' GB' : (size/1048576).toFixed(1)+' MB';
function progress(offset,total,label='Đang tải video...'){const p= Math.min(100,Math.round(offset/total*100));$('#upload-progress').classList.remove('hidden');$('#progress-label').textContent=label;$('#progress-percent').textContent=p+'%';$('#progress-bar').style.width=p+'%';$('#progress-size').textContent=`${mb(offset)} / ${mb(total)}`;}
async function sendChunk(session,blob,start,total){
  // Retry transient errors after asking Google Drive how many bytes it received.
  for(let attempt=0;attempt<4;attempt++){
    try {return await api(`/api/admin/uploads/${session}`,{method:'PUT',headers:{'X-Upload-Offset':String(start),'Content-Type':'application/octet-stream'},body:blob});}
    catch(e){if(e.status===409&&Number.isSafeInteger(e.data?.nextOffset))return {complete:false,nextOffset:e.data.nextOffset};
      if(e.status>=400&&e.status<500&&e.status!==408&&e.status!==429)throw e;
      try{const s=await api(`/api/admin/uploads/${session}`);if(s.complete||s.nextOffset!==start)return s;}catch{}
      if(attempt===3)throw e;
      await new Promise(resolve=>setTimeout(resolve,450*(attempt+1)));
    }
  }
}
async function doUpload(event){event.preventDefault();if(busy)return;const file=$('#upload-file').files?.[0],mid=$('#upload-movie').value,num=Number($('#upload-episode').value);if(!mid)return toast('Bạn cần chọn phim trước.',true);if(!file)return toast('Vui lòng chọn file video.',true);if(!adminStatus?.googleConnected)return toast('Kết nối Google Drive trước khi tải phim.',true);
  if(file.size>25*1024**3)return toast('File lớn hơn giới hạn 25 GB.',true);
  busy=true;const button=$('#upload-btn');button.disabled=true;button.textContent='Đang upload...';progress(0,file.size,'Khởi tạo phiên upload...');
  try{const data=await api('/api/admin/uploads',{method:'POST',body:{movie_id:mid,episode_number:num,title:$('#upload-title').value.trim()||`Tập ${num}`,filename:file.name,mime:file.type||'video/mp4',size:file.size}});let next=data.nextOffset;while(next<file.size){const end=Math.min(next+data.chunkSize,file.size);const piece=file.slice(next,end);const res=await sendChunk(data.uploadId,piece,next,file.size);if(res.complete){next=file.size;progress(next,file.size,'Tải lên hoàn tất ✓');toast(res.warning||'Đã tải video lên và gắn vào tập phim!',!!res.warning);break;}if(!Number.isSafeInteger(res.nextOffset)||res.nextOffset<0||res.nextOffset>file.size)throw new Error('Google Drive trả về vị trí upload không hợp lệ.');if(res.nextOffset===next)throw new Error('Phiên upload không tiến triển. Hãy kiểm tra Google Drive rồi thử lại.');next=res.nextOffset;progress(next,file.size);}
    $('#upload-file').value='';$('#chosen-name').textContent='Chọn file video cần tải lên';await refreshMovies();await refreshEpisodes();
  }catch(e){progress(0,file.size,'Tải lên chưa hoàn tất');toast('Lỗi upload: '+e.message,true);}finally{busy=false;button.disabled=false;button.textContent='⇧ Bắt đầu upload';}
}
async function linkEpisode(e){e.preventDefault();const id=$('#upload-movie').value;if(!id)return toast('Chọn phim trước khi thêm tập.',true);const data=Object.fromEntries(new FormData(e.target).entries());const match=data.drive_file_id.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);if(match)data.drive_file_id=match[1];data.episode_number=Number(data.episode_number);
  try{const res=await api(`/api/admin/movies/${id}/episodes`,{method:'POST',body:data});toast(res.warning||'Đã gắn tập phim từ Google Drive!',!!res.warning);e.target.reset();await refreshMovies();await refreshEpisodes();}catch(err){toast(err.message,true);}
}
async function loadAds(){try{const data=await api('/api/admin/ads');const f=$('#ads-form');f.elements.namedItem('ads_enabled').checked=data.ads_enabled==='true';for(const n of ['ad_top','ad_player','ad_social'])f.elements.namedItem(n).value=data[n]||'';}catch(e){toast(e.message,true);}}
async function saveAds(e){e.preventDefault();const f=e.target;const data=Object.fromEntries(new FormData(f).entries());data.ads_enabled=f.elements.namedItem('ads_enabled').checked;try{await api('/api/admin/ads',{method:'PUT',body:data});toast('Đã cập nhật mã quảng cáo Adsterra.');}catch(e){toast(e.message,true);}}
async function connectDrive(){try{const data=await api('/api/admin/google/connect');location.assign(data.url);}catch(e){toast(e.message,true);}}
async function disconnectDrive(){if(!confirm('Ngắt kết nối Google Drive? Các phim đã đăng vẫn còn trên web nhưng bạn không thể upload mới cho đến khi kết nối lại.'))return;try{await api('/api/admin/google/disconnect',{method:'POST'});toast('Đã ngắt kết nối Google Drive.');await refreshStatus();}catch(e){toast(e.message,true);}}
async function logout(){try{await api('/api/admin/logout',{method:'POST'});}catch{}loginState(false);$('#password').value='';}
async function login(e){e.preventDefault();const p=$('#password').value;$('#login-submit').disabled=true;$('#login-error').classList.add('hidden');try{await api('/api/admin/login',{method:'POST',body:{password:p}});$('#password').value='';await boot();}catch(err){$('#login-error').textContent=err.message;$('#login-error').classList.remove('hidden');}finally{$('#login-submit').disabled=false;}}
async function boot(){loginState(true);switchTab('dashboard');await refreshMovies();$('#redirect-uri').textContent=location.origin+'/api/admin/google/callback';if(location.search.includes('google=connected')){toast('Google Drive đã kết nối!');history.replaceState(null,'',location.pathname);}else if(location.search.includes('google=cancelled')){toast('Đã hủy kết nối Google.',true);history.replaceState(null,'',location.pathname);}}
function bind(){
  $('#login-form').addEventListener('submit',login);$('#logout').addEventListener('click',logout);$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));$$('[data-switch]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.switch)));
  $('#new-movie').addEventListener('click',()=>showMovieForm());$('#cancel-movie').addEventListener('click',hideMovieForm);$('#cancel-movie-2').addEventListener('click',hideMovieForm);$('#movie-form').addEventListener('submit',saveMovie);$('#movie-table').addEventListener('click',movieTableAction);
  $('#upload-movie').addEventListener('change',refreshEpisodes);$('#upload-file').addEventListener('change',()=>{$('#chosen-name').textContent=$('#upload-file').files?.[0]?.name||'Chọn file video cần tải lên';});$('#upload-form').addEventListener('submit',doUpload);$('#episode-list').addEventListener('click',episodeAction);$('#link-episode-form').addEventListener('submit',linkEpisode);
  $('#ads-form').addEventListener('submit',saveAds);$('#connect-drive').addEventListener('click',connectDrive);$('#disconnect-drive').addEventListener('click',disconnectDrive);
}
async function init(){bind();try{const res=await api('/api/admin/session');if(res.authenticated)await boot();else loginState(false);}catch(e){loginState(false);$('#login-error').textContent='Không kết nối được API. Hãy hoàn tất triển khai D1/Worker: '+e.message;$('#login-error').classList.remove('hidden');}}
init();
