const DEPARTMENTS = ['Boss','UnderBoss','Quản Lý','Lose Or Win','Thành Viên Mới'];
const MAX_SCARS = 3;
const VIOLATION_REASONS = [
  { key:'rule_violation', label:'Vi Phạm Nội Quy', amount:1 },
  { key:'absent_meeting', label:'Vắng Họp', amount:1 },
];
const ABOUT_PHOTOS = [
  'assets/about-1.jpg',
  'assets/about-2.jpg',
  'assets/about-3.jpg',
];
const KEY_EMP = 'hr-employees';
const KEY_PRIVATE_EMP = 'hr-private-employees';
const KEY_MANAGER_ROLES = 'low-manager-roles';
const KEY_ATT = 'hr-attendance';
const KEY_CHECKIN_SESSION = 'hr-checkin-session';
const KEY_CHECKINS = 'hr-checkins';
const KEY_CHECKIN_HISTORY = 'hr-checkin-history';
const KEY_USERS = 'low-users';
const KEY_SESSION = 'low-session';
const KEY_TOKENS  = 'low-auth-tokens';
const KEY_UINDEX  = 'low-username-index'; // {usernameKey: email} - đọc công khai, chỉ để tra email khi đăng nhập
const KEY_ROLES   = 'low-roles';
const KEY_REGS    = 'hr-registrations'; // {uid: hồ sơ chờ duyệt} - thành viên chỉ ghi được node của chính mình          // {uid: 'owner'|'member'} - nguồn duy nhất để Rules kiểm quyền
const KEY_MEMBER_FORM_HISTORY = 'low-member-form-history';
const FIREBASE_DATABASE_URL = 'https://lose-or-win-8c507-default-rtdb.firebaseio.com';
const FIREBASE_API_KEY = 'AIzaSyBDQgrTLJkV-NA3Ogn462uiDUpz5sOvfu0';

function getMemberFormHistory(){
  try{
    const history = JSON.parse(localStorage.getItem(KEY_MEMBER_FORM_HISTORY) || '{}');
    return history[currentUser?.username || ''] || {};
  }catch(e){ return {}; }
}
function saveMemberFormHistory(data){
  try{
    const history = JSON.parse(localStorage.getItem(KEY_MEMBER_FORM_HISTORY) || '{}');
    history[currentUser?.username || 'guest'] = {
      name:data.name || '', hometown:data.hometown || '', birthDate:data.birthDate || '',
      phone:data.phone || '', position:data.position || 'Thành Viên Mới',
      department:data.department || '', savedAt:Date.now(),
    };
    localStorage.setItem(KEY_MEMBER_FORM_HISTORY, JSON.stringify(history));
  }catch(e){}
}
function setMemberFormSuggestion(listId, value){
  const list = document.getElementById(listId);
  if(!list) return;
  list.querySelectorAll('[data-history-suggestion]').forEach(option => option.remove());
  if(value){
    const option = document.createElement('option');
    option.value = value;
    option.dataset.historySuggestion = 'true';
    list.appendChild(option);
  }
}
function populateMemberFormSuggestions(history){
  setMemberFormSuggestion('member-name-history', history.name);
  setMemberFormSuggestion('province-list', history.hometown);
  setMemberFormSuggestion('member-birthdate-history', history.birthDate);
  setMemberFormSuggestion('member-phone-history', history.phone || history.email);
  setMemberFormSuggestion('member-department-history', history.department);
}

async function firebaseAuthRequest(endpoint, payload){
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${FIREBASE_API_KEY}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(payload),
  });
  const data = await response.json();
  if(!response.ok) {
    const code = data.error?.message || 'UNKNOWN';
    let msg = code;
    if(code === 'EMAIL_EXISTS') msg = 'Email này đã được sử dụng.';
    else if(code === 'INVALID_LOGIN_CREDENTIALS') msg = 'Sai tên đăng nhập hoặc mật khẩu.';
    else if(code === 'USER_DISABLED') msg = 'Tài khoản đã bị vô hiệu hóa.';
    else if(code === 'TOO_MANY_ATTEMPTS_TRY_LATER') msg = 'Quá nhiều lần thử, vui lòng đợi lát nữa.';
    else if(code === 'MISSING_PASSWORD') msg = 'Vui lòng nhập mật khẩu.';
    else if(code === 'INVALID_EMAIL') msg = 'Định dạng email không hợp lệ.';
    throw new Error(msg);
  }
  return data;
}

async function sendEmailVerification(idToken){
  return firebaseAuthRequest('sendOobCode', {
    requestType:'VERIFY_EMAIL',
    idToken,
    continueUrl:`${location.origin}${location.pathname}?verify=success`,
    canHandleCodeInApp:true,
  });
}

/* =========================================================
   PHIÊN ĐĂNG NHẬP FIREBASE (idToken + refreshToken)
   Mọi lệnh đọc/ghi Realtime Database đều phải kèm ?auth=<idToken>,
   nếu không Firebase Rules sẽ thấy auth == null và trả về 401.
   idToken hết hạn sau 1 giờ nên phải tự làm mới bằng refreshToken.
========================================================= */
let authTokens = null;

function persistAuthTokens(){
  try{
    if(authTokens) localStorage.setItem(KEY_TOKENS, JSON.stringify(authTokens));
    else localStorage.removeItem(KEY_TOKENS);
  }catch(e){}
}
function saveAuthTokens(res){
  if(!res || !res.idToken) return;
  authTokens = {
    idToken: res.idToken,
    refreshToken: res.refreshToken || (authTokens && authTokens.refreshToken) || '',
    localId: res.localId || (authTokens && authTokens.localId) || '',
    // trừ 60s để không dùng token sát giờ hết hạn
    expiresAt: Date.now() + (Number(res.expiresIn || 3600) - 60) * 1000,
  };
  persistAuthTokens();
}
function clearAuthTokens(){ authTokens = null; persistAuthTokens(); }
function loadAuthTokens(){
  try{ authTokens = JSON.parse(localStorage.getItem(KEY_TOKENS) || 'null'); }
  catch(e){ authTokens = null; }
}

let refreshInFlight = null;
async function getIdToken(forceRefresh = false){
  if(!authTokens) loadAuthTokens();
  if(!authTokens || !authTokens.refreshToken) return null;
  if(!forceRefresh && Date.now() < Number(authTokens.expiresAt || 0)) return authTokens.idToken;
  if(forceRefresh) authTokens.expiresAt = 0;
  if(refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try{
      const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
        method:'POST',
        headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
        body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(authTokens.refreshToken)}`,
      });
      if(!r.ok) throw new Error('REFRESH_FAILED');
      const d = await r.json();
      authTokens = {
        idToken: d.id_token,
        refreshToken: d.refresh_token,
        localId: d.user_id,
        expiresAt: Date.now() + (Number(d.expires_in || 3600) - 60) * 1000,
      };
      persistAuthTokens();
      return authTokens.idToken;
    }catch(e){
      clearAuthTokens();
      return null;
    }finally{
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function rtdbPath(key){
  // tách theo '/' rồi mã hoá từng đoạn, nếu không dấu '/' sẽ bị đổi thành %2F
  return String(key).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}
async function rtdbUrl(key, extra, forceRefresh = false){
  const token = await getIdToken(forceRefresh);
  const qs = [];
  if(token) qs.push(`auth=${token}`);
  if(extra) qs.push(extra);
  return `${FIREBASE_DATABASE_URL}/${rtdbPath(key)}.json${qs.length ? '?' + qs.join('&') : ''}`;
}
function rtdbError(status, method){
  if(status === 401 || status === 403){
    return new Error(`Không có quyền ${method} dữ liệu (${status}). Phiên đăng nhập có thể đã hết hạn — hãy đăng nhập lại.`);
  }
  return new Error(`Firebase ${method} failed: ${status}`);
}

async function firebaseStorageGet(key){
  const response = await fetch(await rtdbUrl(key), { cache:'no-store' });
  if(!response.ok) throw rtdbError(response.status, 'GET');
  const value = await response.json();
  return { value: value === null ? null : JSON.stringify(value) };
}
async function firebaseStorageSet(key, value){
  let response = await fetch(await rtdbUrl(key), {
    method:'PUT',
    headers:{ 'Content-Type':'application/json' },
    body:value,
  });
  if(response.status === 401 || response.status === 403){
    response = await fetch(await rtdbUrl(key, null, true), {
      method:'PUT',
      headers:{ 'Content-Type':'application/json' },
      body:value,
    });
  }
  if(!response.ok) throw rtdbError(response.status, 'PUT');
}
async function firebaseStoragePatch(key, obj){
  let response = await fetch(await rtdbUrl(key), {
    method:'PATCH',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify(obj),
  });
  if(response.status === 401 || response.status === 403){
    response = await fetch(await rtdbUrl(key, null, true), {
      method:'PATCH',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(obj),
    });
  }
  if(!response.ok) throw rtdbError(response.status, 'PATCH');
}
async function firebaseStorageDelete(key){
  const response = await fetch(await rtdbUrl(key), { method:'DELETE' });
  if(!response.ok) throw rtdbError(response.status, 'DELETE');
}

async function storageGet(key, shared){
  if(shared){
    try{ return await firebaseStorageGet(key); }
    catch(e){
      if(window.storage && typeof window.storage.get === 'function') return window.storage.get(key, true);
      throw e;
    }
  }
  if(window.storage && typeof window.storage.get === 'function') return window.storage.get(key, false);
  const value = localStorage.getItem(key);
  return { value };
}
async function storageSet(key, value, shared){
  if(shared){
    try{ await firebaseStorageSet(key, value); return; }
    catch(e){
      if(window.storage && typeof window.storage.set === 'function') return window.storage.set(key, value, true);
      throw e;
    }
  }
  if(window.storage && typeof window.storage.set === 'function') return window.storage.set(key, value, false);
  localStorage.setItem(key, value);
}
async function storageDelete(key, shared){
  if(shared){
    try{ await firebaseStorageDelete(key); return; }
    catch(e){
      if(window.storage && typeof window.storage.delete === 'function') return window.storage.delete(key, true);
      throw e;
    }
  }
  if(window.storage && typeof window.storage.delete === 'function') return window.storage.delete(key, false);
  localStorage.removeItem(key);
}

let employees = [];
let attendance = {};        // { 'YYYY-MM-DD': { empId: 'present'|'late'|'absent' } }
let currentView = 'list';   // 'list' | 'attendance'
let currentUser = null;     // { username, role: 'owner'|'member' }
let appHistoryInitialized = false;
let sharedSyncTimer = null;
let sharedSyncBusy = false;
let sharedDataSnapshot = '';
let birthdayAlertDismissed = false;
let checkinSession = null;
let checkinTimer = null;
let checkinRequests = {};
let checkinHistory = [];
let attendanceTab = 'manage';
let historyFilter = 'all';
let historySearchTerm = '';
let expandedHistoryId = '';
const CHECKIN_NOTICE_SEEN = 'low-checkin-notice-seen';

/* =========================================================
   TÀI KHOẢN: ĐĂNG NHẬP / ĐĂNG KÝ CHO CHỦ GIA ĐÌNH & THÀNH VIÊN
   - Danh sách tài khoản lưu ở bộ nhớ dùng chung (mọi người thấy chung 1 danh sách).
   - Người đăng ký ĐẦU TIÊN sẽ tự động là "owner" (Chủ Gia Đình) - toàn quyền.
   - Những người đăng ký sau là "member" (Thành viên) - chỉ xem, không sửa được.
   - Phiên đăng nhập (session) lưu riêng cho từng người dùng (không dùng chung).
========================================================= */
// Tên đăng nhập có thể chứa dấu/khoảng trắng; key Firebase không được chứa . $ # [ ] /
function usernameKey(username){
  return String(username).trim().toLowerCase().replace(/[.$#\[\]\/]/g, '_');
}
// Tên đăng nhập giờ không còn giới hạn ký tự (không còn làm key Firebase nữa),
// nên khi chèn vào HTML (option, thẻ...) cần escape để tránh vỡ layout / XSS.
function escapeHtml(str){
  return String(str ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
// Tra email từ chỉ mục công khai để đăng nhập được mà không cần đọc cả bảng low-users
async function lookupLoginEmail(identifier){
  const id = String(identifier).trim();
  if(id.includes('@')) return id.toLowerCase();
  try{
    const r = await fetch(`${FIREBASE_DATABASE_URL}/${KEY_UINDEX}/${encodeURIComponent(usernameKey(id))}.json`, { cache:'no-store' });
    if(r.ok){
      const email = await r.json();
      if(email) return String(email).toLowerCase();
    }
  }catch(e){}
  return null;
}
// Đọc cả chỉ mục tên->email. Node này là node DUY NHẤT đọc công khai,
// nên dùng được ở màn hình đăng ký/quên mật khẩu khi chưa có token.
async function getUsernameIndex(){
  try{
    const r = await fetch(`${FIREBASE_DATABASE_URL}/${KEY_UINDEX}.json`, { cache:'no-store' });
    if(!r.ok) return {};
    return (await r.json()) || {};
  }catch(e){ return {}; }
}
async function getUserProfile(uid){
  if(!uid) return null;
  try{
    const res = await storageGet(`${KEY_USERS}/${uid}`, true);
    return (res && res.value) ? JSON.parse(res.value) : null;
  }catch(e){ return null; }
}
async function getUsersDb(){
  if(!currentUser?.uid && !authTokens?.localId) return {};
  if(!isOwner()){
    const uid = currentUser?.uid || authTokens?.localId;
    const profile = await getUserProfile(uid);
    return profile ? { [uid]: profile } : {};
  }
  try{
    const res = await storageGet(KEY_USERS, true);
    return (res && res.value) ? JSON.parse(res.value) : {};
  }catch(e){ return {}; }
}
// KHÔNG dùng hàm này nữa: PUT đè cả bảng low-users gây mất dữ liệu khi 2 người
// lưu cùng lúc, và Rules an toàn sẽ chặn. Hãy dùng firebaseStoragePatch(`${KEY_USERS}/<tên>`, {...}).
async function saveUsersDb(){
  throw new Error('saveUsersDb() đã bị loại bỏ — dùng firebaseStoragePatch cho từng tài khoản.');
}
async function notifyMembershipRemoval(emp){
  const registeredBy = String(emp.registeredBy || '').trim().toLowerCase();
  const registeredByUid = String(emp.registeredByUid || '').trim();
  const targetUids = registeredByUid ? [registeredByUid] : Object.entries(window._usersCache || {})
    .filter(([, user]) => String(user.username || '').trim().toLowerCase() === registeredBy)
    .map(([uid]) => uid);
  if(!targetUids.length) return;
  const notice = {
    type:'revoked',
    message:'Bạn đã bị hủy khỏi LOSE OR WIN.',
    at:new Date().toISOString(),
  };
  for(const uid of targetUids){
    try{ await firebaseStoragePatch(`${KEY_USERS}/${uid}`, { membershipNotice: notice }); }catch(e){}
  }
}
async function notifyRegistrationApproved(emp){
  const registeredByUid = String(emp.registeredByUid || '').trim();
  if(!registeredByUid) return;
  const notice = {
    type:'congrats',
    message:`Chúc mừng bạn đã được duyệt vào Gia Đình LOW!`,
    at:new Date().toISOString(),
  };
  
  try{ await firebaseStoragePatch(`${KEY_USERS}/${registeredByUid}`, { membershipNotice: notice }); }catch(e){}
}
async function notifyRegistrationRejected(emp){
  const registeredByUid = String(emp.registeredByUid || '').trim();
  if(!registeredByUid) return;
  const notice = {
    type:'rejected',
    message:'Hồ sơ đăng ký thành viên của bạn chưa được duyệt.',
    at:new Date().toISOString(),
  };
  try{ await firebaseStoragePatch(`${KEY_USERS}/${registeredByUid}`, { membershipNotice: notice }); }catch(e){}
}
async function notifyCheckinOpened(session){
  const memberUids = new Set(
    approvedEmployees()
      .map(emp => String(emp.registeredByUid || '').trim())
      .filter(Boolean)
  );
  const notice = {
    type:'checkin-opened',
    sessionId:session.id,
    message:`Chủ Gia Đình đã mở phiên điểm danh ngày ${formatDateVN(session.date)}. Vui lòng báo danh trong thời gian còn lại.`,
    at:new Date().toISOString(),
  };
  await Promise.all([...memberUids]
    .filter(uid => uid !== currentUser?.uid)
    .map(uid => firebaseStoragePatch(`${KEY_USERS}/${uid}`, { membershipNotice: notice }).catch(() => {})));
}

async function loadSession(){
  try{
    const res = await storageGet(KEY_SESSION, false);
    if(res && res.value){
      const sess = JSON.parse(res.value);
      // Không còn token hợp lệ -> bắt đăng nhập lại thay vì để mọi lệnh ghi lỗi 401
      if(!(await getIdToken())) { await clearSession(); return false; }
      const u = await getUserProfile(sess.uid);
      if(u && u.role === sess.role){
        currentUser = { uid: sess.uid, username: u.username || sess.username, email: u.email || '', role: sess.role };
        return true;
      }
    }
  }catch(e){}
  return false;
}
async function saveSession(){
  try{ await storageSet(KEY_SESSION, JSON.stringify(currentUser), false); }catch(e){}
}
async function clearSession(){
  try{ await storageDelete(KEY_SESSION, false); }catch(e){}
  clearAuthTokens();
  currentUser = null;
}

function showAuthError(msg){
  const el = document.getElementById('auth-error');
  if(!el) return;
  el.classList.remove('auth-success');
  el.textContent = msg;
  el.style.display = 'block';
}
function showAuthSuccess(msg){
  const el = document.getElementById('auth-error');
  if(!el) return;
  el.classList.remove('auth-warning');
  el.classList.add('auth-success');
  el.textContent = msg;
  el.style.display = 'block';
}
function showAuthWarning(msg){
  const el = document.getElementById('auth-error');
  if(!el) return;
  el.classList.remove('auth-success');
  el.classList.add('auth-warning');
  el.textContent = msg;
  el.style.display = 'block';
}
function showRegisterNotice(msg){
  const el = document.getElementById('auth-register-notice');
  if(!el) return;
  el.textContent = msg;
  el.classList.add('show');
}
function hideRegisterNotice(){
  const el = document.getElementById('auth-register-notice');
  if(el){ el.textContent = ''; el.classList.remove('show'); }
}
function hideAuthError(){
  const el = document.getElementById('auth-error');
  if(el){ el.style.display = 'none'; el.classList.remove('auth-success', 'auth-warning'); }
}
function switchAuthTab(which){
  hideAuthError();
  hideRegisterNotice();
  const isRegister = which === 'register';
  document.getElementById('tab-login').classList.toggle('active', which==='login');
  document.getElementById('tab-register').classList.toggle('active', isRegister);
  document.getElementById('form-login').classList.toggle('active', which==='login');
  document.getElementById('form-register').classList.toggle('active', isRegister);
  document.getElementById('form-forgot').classList.toggle('active', which==='forgot');
  if(which === 'forgot'){
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('tab-register').classList.remove('active');
  }
}
function showForgotPassword(){
  switchAuthTab('forgot');
  document.getElementById('forgot-email').focus();
}

function togglePasswordVisibility(fieldId, btnEl){
  const input = document.getElementById(fieldId);
  if(!input) return;
  if(input.type === 'password'){
    input.type = 'text';
    btnEl.textContent = '👁‍🗨';
    btnEl.style.color = '#fff';
  }else{
    input.type = 'password';
    btnEl.textContent = '👁';
    btnEl.style.color = '#ffd57a';
  }
}

async function handleLogin(ev){
  ev.preventDefault();
  hideAuthError();
  const identifier = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if(!identifier || !password){ showAuthError('Vui lòng nhập đầy đủ thông tin.'); return; }

  const submitBtn = ev.target.querySelector('button[type="submit"]');
  const oldLabel = submitBtn ? submitBtn.textContent : '';
  if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Đang đăng nhập…'; }

  try{
    const authEmail = await lookupLoginEmail(identifier);
    if(!authEmail){ showAuthError('Sai tên đăng nhập hoặc mật khẩu.'); return; }

    const loginResult = await firebaseAuthRequest('signInWithPassword', { email:authEmail, password, returnSecureToken:true });
    saveAuthTokens(loginResult);

    const authProfile = await firebaseAuthRequest('lookup', { idToken:loginResult.idToken });
    if(!authProfile?.users?.[0]?.emailVerified){
      clearAuthTokens();
      showAuthError('Email chưa được xác thực nên chưa thể đăng nhập. Vui lòng mở email xác thực trước khi đăng nhập.');
      return;
    }

    const u = await getUserProfile(loginResult.localId);
    if(!u){
      clearAuthTokens();
      showAuthError('Tài khoản chưa có hồ sơ trong hệ thống. Vui lòng liên hệ Chủ Gia Đình.');
      return;
    }

    currentUser = { uid: loginResult.localId, username: u.username || identifier, email: u.email || authEmail, role: u.role };
    await saveSession();
    await enterApp();
  }catch(e){
    clearAuthTokens();
    showAuthError(e.message && !/failed/i.test(e.message) ? e.message : 'Sai tên đăng nhập hoặc mật khẩu.');
  }finally{
    if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = oldLabel; }
  }
}

async function handleRegister(ev){
  ev.preventDefault();
  hideAuthError();
  hideRegisterNotice();
  const username = document.getElementById('reg-username').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if(!username || !email || !password){ showAuthError('Vui lòng nhập đầy đủ thông tin.'); return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ showAuthError('Email không hợp lệ.'); return; }
  if(password.length < 6){ showAuthError('Mật khẩu cần tối thiểu 6 ký tự.'); return; }
  if(password !== password2){ showAuthError('Mật khẩu nhập lại không khớp.'); return; }

  if(username.includes('@')){ showAuthError('Tên đăng nhập không được chứa ký tự @.'); return; }

  // LƯU Ý: lúc này CHƯA đăng nhập nên KHÔNG đọc được low-users (rules yêu cầu auth).
  // Chỉ được dựa vào low-username-index (node đọc công khai duy nhất).
  const uindex = await getUsernameIndex();
  if(Object.prototype.hasOwnProperty.call(uindex, usernameKey(username))){
    showAuthError('Tên đăng nhập đã tồn tại.'); return;
  }
  if(Object.values(uindex).some(v => String(v).toLowerCase() === email)){
    showAuthError('Email đã được sử dụng.'); return;
  }
  
  try{
    const authResult = await firebaseAuthRequest('signUp', { email, password, returnSecureToken:true });
    saveAuthTokens(authResult);
    let verificationSent = true;

    // 4. Giờ mới xác định được quyền: low-roles còn trống => đây là người đầu tiên.
    //    (Không thể kiểm tra trước bước này vì low-roles cần auth mới đọc được.)
    let role = 'member';
    try{
      const rolesRes = await firebaseStorageGet(KEY_ROLES);
      const roles = rolesRes.value ? JSON.parse(rolesRes.value) : null;
      if(!roles || Object.keys(roles).length === 0) role = 'owner';
    }catch(e){
      // Không đọc được low-roles => không dám tự cấp quyền Chủ Gia Đình
      role = 'member';
    }

    // 5. low-users key theo uid (không theo username) -> tên đăng nhập có dấu chấm,
    // khoảng trắng hay bất kỳ ký tự gì cũng không còn phá key Firebase nữa.
    try{
      await firebaseStorageSet(`${KEY_ROLES}/${authResult.localId}`, JSON.stringify(role));
      await firebaseStorageSet(`${KEY_USERS}/${authResult.localId}`,
        JSON.stringify({ username, email, role, createdAt:new Date().toISOString() }));
      await firebaseStorageSet(`${KEY_UINDEX}/${usernameKey(username)}`, JSON.stringify(email));
    }catch(dbErr){
      // Ghi DB thất bại -> dọn sạch những gì đã ghi dở, rồi xoá tài khoản Auth,
      // nếu không email sẽ bị "EMAIL_EXISTS" mà không có hồ sơ để đăng nhập.
      try{ await firebaseStorageDelete(`${KEY_ROLES}/${authResult.localId}`); }catch(_){}

      try{ await firebaseStorageDelete(`${KEY_USERS}/${authResult.localId}`); }catch(_){}

      try{ await firebaseAuthRequest('delete', { idToken: authResult.idToken }); }catch(_){}

      clearAuthTokens();
      throw dbErr;
    }

    try{
      await sendEmailVerification(authResult.idToken);
    }catch(e){
      verificationSent = false;
    }

    clearAuthTokens();
    await refreshUsersCache();
    
    document.getElementById('form-register').reset();
    showRegisterNotice(verificationSent
      ? 'Vui lòng mở email và xác thực tài khoản trước khi đăng nhập.'
      : 'Chưa gửi được email xác thực. Vui lòng kiểm tra lại địa chỉ email hoặc thử đăng ký lại sau.');
  }catch(e){
    let msg = e.message;
    if(msg === 'EMAIL_EXISTS') msg = 'Email này đã được sử dụng bởi một tài khoản khác.';
    else if(msg === 'OPERATION_NOT_ALLOWED') msg = 'Đăng ký hiện đang bị khóa.';
    else if(msg === 'TOO_MANY_ATTEMPTS_TRY_LATER') msg = 'Quá nhiều yêu cầu. Vui lòng thử lại sau.';
    else if(msg.includes('401') || msg.includes('403')) {
        msg = 'Không có quyền ghi dữ liệu (401). Realtime Database Rules chưa được cập nhật — hãy chạy "firebase deploy --only database" (hoặc dán database.rules.json vào Firebase Console) rồi thử lại.';
    }
    showAuthError(`Đăng ký có lỗi: ${msg}`);
  }
}

async function handleForgotPassword(ev){
  ev.preventDefault();
  hideAuthError();
  const email = document.getElementById('forgot-email').value.trim().toLowerCase();
  if(!email){ showAuthError('Vui lòng nhập email đã đăng ký.'); return; }
  // Chưa đăng nhập -> tra qua chỉ mục công khai, không đọc low-users
  const uindex = await getUsernameIndex();
  if(!Object.values(uindex).some(v => String(v).toLowerCase() === email)){
    showAuthError('Email này chưa có tài khoản khôi phục.'); return;
  }
  try{
    await firebaseAuthRequest('sendOobCode', {
      requestType:'PASSWORD_RESET',
      email,
      continueUrl:`${location.origin}/?reset=success`,
      canHandleCodeInApp:true,
    });
    showAuthWarning('Đã gửi email khôi phục. Hãy kiểm tra hộp thư và thư mục Spam.');
  }catch(e){
    showAuthError('Không thể gửi email khôi phục. Vui lòng kiểm tra lại email.');
  }
}

function handlePasswordResetReturn(){
  const params = new URLSearchParams(location.search);
  if(params.get('reset') !== 'success') return false;
  document.getElementById('landing-overlay').style.display = 'none';
  document.getElementById('auth-overlay').classList.remove('hide');
  switchAuthTab('login');
  showAuthSuccess('Đổi mật khẩu thành công! Bạn có thể đăng nhập bằng mật khẩu mới.');
  history.replaceState({}, document.title, location.pathname);
  return true;
}

function handleEmailVerificationReturn(){
  const params = new URLSearchParams(location.search);
  if(params.get('verify') !== 'success') return false;
  document.getElementById('landing-overlay').style.display = 'none';
  document.getElementById('auth-overlay').classList.remove('hide');
  switchAuthTab('login');
  showAuthSuccess('Đăng ký thành công, email đã được xác thực. Bạn có thể đăng nhập ngay bây giờ.');
  history.replaceState({}, document.title, location.pathname);
  return true;
}

async function handleLogout(){
  await clearSession();
  showToast('Đã đăng xuất thành công.');
  setTimeout(() => location.reload(), 900);
}

function changeOwnEmail(){
  if(!currentUser) return;
  const db = window._usersCache || {};
  const account = db[currentUser.uid];
  if(!account || !account.email){
    showToast('Tài khoản này chưa được liên kết Firebase Authentication.');
    return;
  }
  document.getElementById('email-change-current').textContent = `Email hiện tại: ${account.email}`;
  document.getElementById('email-change-password').value = '';
  document.getElementById('email-change-new').value = '';
  document.getElementById('email-change-error').style.display = 'none';
  document.getElementById('email-change-overlay').classList.add('show');
  document.getElementById('email-change-password').focus();
}

function openProfileModal(){
  if(!currentUser) return;
  const db = window._usersCache || {};
  const account = db[currentUser.uid] || {};
  document.getElementById('profile-name').textContent = account.name || currentUser.username;
  document.getElementById('profile-role').textContent = currentUser.role === 'owner' ? 'Chủ Gia Đình' : 'Thành Viên';
  document.getElementById('profile-username').value = currentUser.username;
  document.getElementById('profile-email').value = account.email || '';
  document.getElementById('profile-current-password').value = '';
  document.getElementById('profile-new-password').value = '';
  document.getElementById('profile-confirm-password').value = '';
  document.getElementById('profile-overlay').classList.add('show');
}

function closeProfileModal(){
  document.getElementById('profile-overlay').classList.remove('show');
}

function closeEmailChangeModal(){
  document.getElementById('email-change-overlay').classList.remove('show');
}

async function saveProfileChanges(ev){
  ev.preventDefault();
  if(!currentUser) return;
  const db = await getUsersDb();
  const account = db[currentUser.uid];
  if(!account){ showToast('Không tìm thấy tài khoản của bạn.'); return; }
  const email = document.getElementById('profile-email').value.trim().toLowerCase();
  const currentPassword = document.getElementById('profile-current-password').value;
  const newPassword = document.getElementById('profile-new-password').value;
  const confirmPassword = document.getElementById('profile-confirm-password').value;
  if(!email){ showToast('Vui lòng nhập email.'); return; }
  if(!/^\S+@\S+\.\S+$/.test(email)){ showToast('Email không hợp lệ.'); return; }
  const uindex = await getUsernameIndex();
  if(Object.values(uindex).some(value => String(value).toLowerCase() === email && email !== String(account.email || '').toLowerCase())){
    showToast('Email này đã được sử dụng bởi tài khoản khác.'); return;
  }
  if(newPassword || confirmPassword){
    if(!currentPassword){ showToast('Vui lòng nhập mật khẩu hiện tại để đổi mật khẩu.'); return; }
    if(newPassword.length < 6){ showToast('Mật khẩu mới cần tối thiểu 6 ký tự.'); return; }
    if(newPassword !== confirmPassword){ showToast('Mật khẩu mới không khớp.'); return; }
  }
  try{
    let authEmail = account.email;
    if(email !== (account.email || '').toLowerCase()){
      if(!currentPassword){ showToast('Vui lòng nhập mật khẩu hiện tại để đổi email.'); return; }
      const signIn = await firebaseAuthRequest('signInWithPassword', { email: account.email, password: currentPassword, returnSecureToken: true });
      saveAuthTokens(signIn);
      await firebaseStorageDelete(`${KEY_UINDEX}/${usernameKey(currentUser.username)}`);
      // Đã tắt xác thực qua email: đổi email ngay lập tức, không cần bấm link xác nhận.
      const updateResult = await firebaseAuthRequest('update', { idToken: signIn.idToken, email, returnSecureToken: true });
      saveAuthTokens(updateResult);
      await firebaseStorageSet(`${KEY_UINDEX}/${usernameKey(currentUser.username)}`, JSON.stringify(email));
      authEmail = email;
    }
    if(newPassword){
      const signIn = await firebaseAuthRequest('signInWithPassword', { email: authEmail, password: currentPassword, returnSecureToken: true });
      saveAuthTokens(signIn);
      const passwordUpdate = await firebaseAuthRequest('update', { idToken: signIn.idToken, password: newPassword, returnSecureToken: true });
      saveAuthTokens(passwordUpdate);
      showToast('Mật khẩu đã được cập nhật.');
    }
    // Mật khẩu do Firebase Auth quản lý — KHÔNG bao giờ lưu vào Realtime Database
    await firebaseStoragePatch(`${KEY_USERS}/${currentUser.uid}`, { email, password: null });
    currentUser.email = email;
    await refreshUsersCache();
    closeProfileModal();
    currentView = canAccessView('list') ? 'list' : 'about';
    await saveSession();
    render();
    showToast('Đã cập nhật thông tin tài khoản.');
  }catch(e){
    const msg = e.message || 'Không thể cập nhật profile.';
    showToast(msg.includes('INVALID_PASSWORD') ? 'Mật khẩu hiện tại không đúng.' : msg);
  }
}

async function submitEmailChange(ev){
  ev.preventDefault();
  const error = document.getElementById('email-change-error');
  const showError = message => { error.textContent = message; error.style.display = 'block'; };
  error.style.display = 'none';
  const db = await getUsersDb();
  const account = db[currentUser.uid];
  const currentPassword = document.getElementById('email-change-password').value;
  const email = document.getElementById('email-change-new').value.trim().toLowerCase();
  if(!/^\S+@\S+\.\S+$/.test(email)){
    showError('Email mới không hợp lệ.');
    return;
  }
  if(email === account.email.toLowerCase()){
    showError('Email mới trùng với email hiện tại.');
    return;
  }
  const uindex = await getUsernameIndex();
  if(Object.values(uindex).some(value => String(value).toLowerCase() === email)){
    showError('Email mới đã được sử dụng.');
    return;
  }
  try{
    const signIn = await firebaseAuthRequest('signInWithPassword', { email:account.email, password:currentPassword, returnSecureToken:true });
    saveAuthTokens(signIn);
    await firebaseStorageDelete(`${KEY_UINDEX}/${usernameKey(currentUser.username)}`);
    // Đã tắt xác thực qua email: đổi email ngay lập tức, không cần bấm link xác nhận.
    const updateResult = await firebaseAuthRequest('update', { idToken:signIn.idToken, email, returnSecureToken:true });
    saveAuthTokens(updateResult);
    try{
      await firebaseStoragePatch(`${KEY_USERS}/${currentUser.uid}`, { email });
      await firebaseStorageSet(`${KEY_UINDEX}/${usernameKey(currentUser.username)}`, JSON.stringify(email));
      await refreshUsersCache();
    }catch(e){
      showError('Email Firebase đã đổi nhưng chưa lưu được dữ liệu trang. Hãy tải lại và thử lại.');
      return;
    }
    closeEmailChangeModal();
    showToast('Đã đổi email thành công.');
  }catch(e){
    const messages = {
      INVALID_PASSWORD:'Mật khẩu hiện tại không đúng.',
      EMAIL_EXISTS:'Email mới đã được sử dụng.',
      INVALID_EMAIL:'Email mới không hợp lệ.',
      INVALID_ID_TOKEN:'Phiên đăng nhập đã hết hạn. Hãy đăng xuất rồi đăng nhập lại.',
      USER_NOT_FOUND:'Không tìm thấy tài khoản Firebase này.',
      OPERATION_NOT_ALLOWED:'Firebase chưa bật Email/Password hoặc chưa cho phép đổi email.',
      TOO_MANY_ATTEMPTS_TRY_LATER:'Bạn thử quá nhiều lần. Hãy chờ một lúc rồi thử lại.'
    };
    showError(messages[e.message] || `Không thể đổi email: ${e.message}`);
  }
}

function isManagerOrAbove(){
  if(isOwner()) return true;
  if(!currentUser) return false;
  const emp = employees.find(e => 
    (e.registeredBy && currentUser.username && e.registeredBy.toLowerCase() === currentUser.username.toLowerCase()) ||
    (e.registeredByUid && e.registeredByUid === currentUser.uid) ||
    (e.email && currentUser.email && e.email.toLowerCase() === currentUser.email.toLowerCase())
  );
  if(!emp || emp.registrationStatus === 'pending') return false;
  return hasManagerRole(emp);
}
function hasManagerRole(emp){
  const managerRoles = ['boss', 'underboss', 'quản lý'];
  const dept = String(emp?.department || '').trim().toLowerCase();
  const pos = String(emp?.position || '').trim().toLowerCase();
  return managerRoles.some(r => dept.includes(r) || pos.includes(r));
}
async function syncManagerRoleIndex(list){
  if(!isOwner()) return;
  const managerUids = new Set(list
    .filter(employee => employee.registrationStatus === 'approved' && hasManagerRole(employee))
    .map(employee => String(employee.registeredByUid || '').trim())
    .filter(Boolean));
  const existingRes = await firebaseStorageGet(KEY_MANAGER_ROLES).catch(() => ({ value:null }));
  const existing = existingRes.value ? JSON.parse(existingRes.value) || {} : {};
  await Promise.all([...managerUids].map(uid => firebaseStoragePatch(`${KEY_MANAGER_ROLES}/${uid}`, { manager:true })));
  await Promise.all(Object.keys(existing)
    .filter(uid => !managerUids.has(uid))
    .map(uid => firebaseStorageDelete(`${KEY_MANAGER_ROLES}/${uid}`)));
}

async function refreshUsersCache(){
  window._usersCache = await getUsersDb();
  if(currentUser){
    const notice = window._usersCache[currentUser.uid]?.membershipNotice || null;
    const changed = JSON.stringify(notice) !== JSON.stringify(currentUser.membershipNotice || null);
    currentUser.membershipNotice = notice;
    if(changed && (notice?.type === 'congrats' || notice?.type === 'rejected')){
      setTimeout(() => showMembershipApprovedAlert(), 0);
    }else if(changed && notice?.type === 'checkin-opened'){
      setTimeout(() => showToast(notice.message || 'Bạn có thông báo mới.'), 0);
    }
  }
}
async function syncMembershipNotice(shouldRender = false){
  if(!currentUser || isOwner()) return;
  const db = await getUsersDb();
  const notice = db[currentUser.uid]?.membershipNotice || null;
  if(JSON.stringify(notice) === JSON.stringify(currentUser.membershipNotice)) return;
  currentUser.membershipNotice = notice;
  if(notice?.type === 'revoked') currentUser.membershipRevoked = true;
  if(notice?.type === 'congrats') currentUser.membershipRevoked = false;
  if(notice?.type === 'congrats' || notice?.type === 'rejected'){
    setTimeout(() => showMembershipApprovedAlert(), 0);
  }else if(notice?.type === 'checkin-opened'){
    showToast(notice.message || 'Bạn có thông báo mới.');
  }
  if(shouldRender) render();
}
function notifyLocalCheckinSession(session, shouldRender = true){
  if(isOwner() || !session?.active || !session.id || !currentUser?.uid) return false;
  const seenKey = `${CHECKIN_NOTICE_SEEN}:${currentUser.uid}`;
  if(localStorage.getItem(seenKey) === session.id) return false;
  localStorage.setItem(seenKey, session.id);
  currentUser.membershipNotice = {
    type:'checkin-opened',
    sessionId:session.id,
    message:`Chủ Gia Đình đã mở phiên điểm danh ngày ${formatDateVN(session.date)}. Vui lòng báo danh trong thời gian còn lại.`,
    at:new Date().toISOString(),
  };
  showToast(currentUser.membershipNotice.message);
  if(shouldRender) render();
  return true;
}
async function acknowledgeMembershipNotice(){
  if(!currentUser?.membershipNotice) return;
  const wasRevoked = currentUser.membershipNotice.type === 'revoked';
  try{
    await firebaseStoragePatch(`${KEY_USERS}/${currentUser.uid}`, { membershipNotice: null });
  }catch(e){ showToast(e.message); }
  if(wasRevoked) await refreshSharedData(false);
  currentUser.membershipNotice = null;
  if(wasRevoked){
    currentUser.membershipRevoked = true;
    await saveSession();
    currentView = 'about';
  }
  render();
}
async function acknowledgeCheckinNotice(){
  await acknowledgeMembershipNotice();
  if(canAccessView('attendance')) setView('attendance');
}
async function closeMembershipApprovedAlert(){
  const noticeType = currentUser?.membershipNotice?.type;
  const overlay = document.getElementById('membership-approved-overlay');
  if(overlay) overlay.classList.remove('show');
  stopBirthdayConfetti('membership-approved-confetti-canvas');
  await acknowledgeMembershipNotice();
  currentView = noticeType === 'congrats' ? 'list' : 'member-pending';
  render();
}
function showMembershipApprovedAlert(){
  if(!currentUser?.membershipNotice || !['congrats', 'rejected'].includes(currentUser.membershipNotice.type)) return;
  const overlay = document.getElementById('membership-approved-overlay');
  const nameEl = document.getElementById('membership-approved-name');
  const titleEl = document.getElementById('membership-approved-title');
  const kickerEl = document.getElementById('membership-approved-kicker');
  const subEl = document.getElementById('membership-approved-sub');
  const roleEl = document.getElementById('membership-approved-role');
  const quoteEl = document.getElementById('membership-approved-quote');
  const buttonEl = document.getElementById('membership-approved-button');
  const iconEl = document.querySelector('#membership-approved-box .membership-approved-icon');
  if(!overlay) return;
  const isApproved = currentUser.membershipNotice.type === 'congrats';
  const account = (window._usersCache || {})[currentUser.uid] || {};
  if(nameEl) nameEl.textContent = isApproved
    ? `Chào mừng ${account.username || currentUser.username} đến với LOW`
    : `Hồ sơ của ${account.username || currentUser.username} chưa được duyệt`;
  if(titleEl) titleEl.textContent = isApproved ? 'CHÚC MỪNG THÀNH VIÊN' : 'HỒ SƠ BỊ TỪ CHỐI';
  if(kickerEl) kickerEl.textContent = isApproved ? '✨ BAN QUẢN TRỊ LOW CHÚC MỪNG ✨' : '⚠ BAN QUẢN TRỊ LOW THÔNG BÁO ⚠';
  if(subEl) subEl.textContent = isApproved
    ? 'Hồ sơ của bạn đã được Chủ Gia Đình xét duyệt thành công.'
    : 'Admin đã từ chối hồ sơ đăng ký thành viên của bạn.';
  if(roleEl) roleEl.textContent = isApproved ? '⭐ Thành viên chính thức của Gia Đình' : '⛔ Đăng ký thành viên bị từ chối';
  if(quoteEl) quoteEl.textContent = isApproved
    ? 'Từ hôm nay, bạn chính thức đồng hành cùng anh em trong Gia Đình LOSE OR WIN!'
    : 'Vui lòng liên hệ Admin nếu bạn cần biết thêm thông tin về lý do từ chối.';
  if(buttonEl) buttonEl.textContent = isApproved ? '🎉 Vào Danh Sách Thành Viên' : 'Đã hiểu';
  if(iconEl) iconEl.textContent = isApproved ? '🏆' : '✕';
  overlay.classList.toggle('membership-rejected-overlay', !isApproved);
  overlay.classList.add('show');
  stopBirthdayConfetti('membership-approved-confetti-canvas');
  if(isApproved) startBirthdayConfetti('membership-approved-confetti-canvas');
}

function isOwner(){
  return !!(currentUser && currentUser.role === 'owner');
}
function isAdmin(){
  return isOwner() || isManagerOrAbove();
}
function requireAdmin(){
  if(!isAdmin()){
    showToast('⚠️ Chỉ Chủ Gia Đình hoặc cấp Quản Lý trở lên mới có quyền thực hiện thao tác này.');
    return false;
  }
  return true;
}
// Tự động ẩn/hiện các nút chỉ dành cho Chủ Gia Đình (owner-only) sau mỗi lần DOM thay đổi.
function applyRolePermissions(){
  const owner = isOwner();
  const admin = isAdmin();
  document.querySelectorAll('.owner-only').forEach(el => {
    el.style.display = owner ? '' : 'none';
  });
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = admin ? '' : 'none';
  });
}
let _roleObserverStarted = false;
function startRoleObserver(){
  if(_roleObserverStarted) return;
  _roleObserverStarted = true;
  const observer = new MutationObserver(() => applyRolePermissions());
  observer.observe(document.body, { childList:true, subtree:true });
  applyRolePermissions();
}

async function enterApp(){
  document.getElementById('auth-overlay').classList.add('hide');
  document.getElementById('app').style.display = '';
  await loadAll();
  await refreshUsersCache();
  notifyLocalCheckinSession(checkinSession, false);
  currentView = isOwner() || hasApprovedMembership() ? 'list' : getMemberFallbackView();
  initializeAppHistory();
  populateStaticSelects();
  render();
  renderBirthdayAlert();
  startRoleObserver();
  startSharedSync();
}
let searchTerm = '';
let scarSearchTerm = '';
let filterDept = 'all';
let filterStatus = 'all';
const revealedPhoneIds = new Set();
let openHistoryDates = {};
let editingId = null;
let violationContext = null; // { empId, mode: 'attendance'|'manual' }
let pendingConfirmAction = null;

function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function isValidBirthDate(value){
  if(!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return !value;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const isRealDate = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return isRealDate && value >= '1900-01-01' && value <= todayStr();
}
function formatDateVN(dateStr){
  const [y,m,d] = dateStr.split('-');
  return d + '/' + m + '/' + y;
}
function todaysBirthdays(){
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return approvedEmployees().filter(emp => String(emp.birthDate || '').slice(5) === month + '-' + day);
}
let _birthdayConfettiRunning = false;
let _birthdayConfettiReq = null;

function startBirthdayConfetti(canvasId = 'birthday-confetti-canvas'){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const colors = ['#d82a3a', '#ffd700', '#ff6b74', '#ffffff', '#ff9800', '#e91e63'];
  const pieces = [];
  for(let i = 0; i < 90; i++){
    pieces.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height - canvas.height,
      w: Math.random() * 10 + 6,
      h: Math.random() * 6 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: Math.random() * 3.5 + 2,
      speedX: (Math.random() - 0.5) * 2.5,
      angle: Math.random() * 360,
      angularSpeed: (Math.random() - 0.5) * 6
    });
  }

  _birthdayConfettiRunning = true;
  function draw(){
    if(!_birthdayConfettiRunning) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pieces.forEach(p => {
      p.y += p.speedY;
      p.x += p.speedX;
      p.angle += p.angularSpeed;
      if(p.y > canvas.height){
        p.y = -10;
        p.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.angle * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    _birthdayConfettiReq = requestAnimationFrame(draw);
  }
  draw();
}

function stopBirthdayConfetti(canvasId = 'birthday-confetti-canvas'){
  _birthdayConfettiRunning = false;
  if(_birthdayConfettiReq) cancelAnimationFrame(_birthdayConfettiReq);
  const canvas = document.getElementById(canvasId);
  if(canvas){
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

function closeBirthdayAlert(){
  const overlay = document.getElementById('birthday-alert-overlay');
  if(overlay) overlay.classList.remove('show');
  stopBirthdayConfetti();
}

function renderBirthdayAlert(){
  // Chỉ chức vụ Quản Lý, UnderBoss và Boss (hoặc Chủ Gia Đình) mới được thấy thông báo sinh nhật
  if(!isManagerOrAbove()) return '';
  if(birthdayAlertDismissed) return '';
  
  const celebrants = todaysBirthdays();
  if(!celebrants.length) return '';
  
  birthdayAlertDismissed = true;
  const overlay = document.getElementById('birthday-alert-overlay');
  const listEl = document.getElementById('birthday-celebrants-list');
  const titleEl = document.getElementById('birthday-alert-title');
  if(!overlay || !listEl) return '';

  titleEl.textContent = celebrants.length === 1 
    ? 'CHÚC MỪNG SINH NHẬT THÀNH VIÊN' 
    : `CHÚC MỪNG SINH NHẬT (${celebrants.length} THÀNH VIÊN)`;

  listEl.innerHTML = celebrants.map(emp => {
    const initials = (emp.name || 'LOW').split(' ').map(w => w[0]).slice(-2).join('').toUpperCase();
    const posTitle = emp.position || emp.department || 'Thành Viên';
    const age = emp.birthDate ? (new Date().getFullYear() - parseInt(emp.birthDate.slice(0, 4), 10)) : null;
    return `
      <div class="birthday-card">
        <div class="birthday-card-avatar">${escapeHtml(initials)}</div>
        <div class="birthday-card-info">
          <div class="birthday-card-name">${escapeHtml(emp.name)}</div>
          <div class="birthday-card-role">⭐ ${escapeHtml(posTitle)}${age ? ' · ' + age + ' tuổi' : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  overlay.classList.add('show');
  startBirthdayConfetti();
  return '';
}
function createEntityId(){ return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function seedEmployees(){
  return [
    { id: createEntityId(), name:'Nguyễn Thu Hà', email:'ha.nguyen@congty.vn', phone:'0901234567', position:'Trưởng phòng', department:'Boss', status:'active', joinDate:'2022-03-01', scars:0, violations:[], presentStreak:0 },
    { id: createEntityId(), name:'Trần Minh Khôi', email:'khoi.tran@congty.vn', phone:'0912345678', position:'Kỹ sư phần mềm', department:'UnderBoss', status:'active', joinDate:'2023-06-15', scars:0, violations:[], presentStreak:0 },
    { id: createEntityId(), name:'Lê Thị Bích', email:'bich.le@congty.vn', phone:'0923456789', position:'Chuyên viên Marketing', department:'Thành Viên Mới', status:'active', joinDate:'2021-11-20', scars:0, violations:[], presentStreak:0 },
  ];
}
function normalizeEmployee(e){
  if(typeof e.scars !== 'number') e.scars = 0;
  if(!Array.isArray(e.violations)) e.violations = [];
  if(typeof e.presentStreak !== 'number') e.presentStreak = 0;
  if(typeof e.vault !== 'number') e.vault = 0;
  if(!Array.isArray(e.contributionLog)) e.contributionLog = [];
  if(!e.registrationStatus) e.registrationStatus = e.registeredBy ? 'pending' : 'approved';
  return e;
}
function approvedEmployees(){
  return employees.filter(e => e.registrationStatus === 'approved');
}

// Dữ liệu được lưu ở bộ nhớ dùng chung (shared storage) của Claude, nghĩa là
// khi Chủ Gia Đình cập nhật, TẤT CẢ mọi người mở trang này (kể cả khi được chia sẻ)
// sẽ luôn thấy đúng dữ liệu cập nhật mới nhất, không phụ thuộc vào trình duyệt/thiết bị.
// Hồ sơ chờ duyệt nằm ở node riêng để thành viên không phải ghi đè cả bảng hr-employees.
async function getPendingRegistrations(){
  try{
    const res = await storageGet(isAdmin() ? KEY_REGS : `${KEY_REGS}/${currentUser?.uid || ''}`, true);
    const obj = (res && res.value) ? JSON.parse(res.value) : null;
    if(!isAdmin()) return obj ? [{ ...obj, regUid: currentUser.uid, _pendingReg:true }] : [];
    if(!obj || typeof obj !== 'object') return [];
    return Object.entries(obj).map(([regUid, emp]) => ({ ...emp, regUid, _pendingReg:true }));
  }catch(e){ return []; }
}
function mergeRegistrations(list, regs){
  const ids = new Set(list.map(e => e.id));
  return list.concat(regs.filter(r => !ids.has(r.id)));
}

async function loadAll(){
  let shouldPersistEmployees = false;
  try{
    const res = await storageGet(KEY_EMP, true);
    // Không tự ghi dữ liệu mẫu khi Firebase chưa có node, tránh reload làm mất dữ liệu thật.
    const publicData = (res && res.value !== null) ? JSON.parse(res.value) : [];
    employees = Array.isArray(publicData) ? publicData : Object.values(publicData || {});
    const publicDataNeedsSanitizing = isOwner() && employees.some(employee =>
      Object.prototype.hasOwnProperty.call(employee, 'phone') || Object.prototype.hasOwnProperty.call(employee, 'email')
    );
    shouldPersistEmployees = publicDataNeedsSanitizing;
    const canReadPrivatePhones = isAdmin();
    let privateRes = null;
    if(canReadPrivatePhones) privateRes = await storageGet(KEY_PRIVATE_EMP, true).catch(() => null);
    if(!canReadPrivatePhones) employees.forEach(employee => { delete employee.phone; delete employee.email; });
    if(canReadPrivatePhones && privateRes?.value){
      const privatePhones = JSON.parse(privateRes.value) || {};
      employees.forEach(employee => {
        const privateRecord = privatePhones[employee.id];
        if(privateRecord) employee.phone = typeof privateRecord === 'object' ? privateRecord.phone : privateRecord;
      });
    }
  }catch(e){ employees = []; }
  if(!Array.isArray(employees)){ employees = []; }
  employees = mergeRegistrations(employees, await getPendingRegistrations());
  employees.forEach(normalizeEmployee);
  if(isOwner()) await syncManagerRoleIndex(employees).catch(() => {});
  if(isOwner() && shouldPersistEmployees) saveEmployees(employees).catch(() => {});
  try{
    const [attendanceRes, sessionRes, requestsRes, historyRes] = await Promise.all([
      storageGet(KEY_ATT, true), storageGet(KEY_CHECKIN_SESSION, true),
      storageGet(KEY_CHECKINS, true), storageGet(KEY_CHECKIN_HISTORY, true),
    ]);
    attendance = attendanceRes && attendanceRes.value ? JSON.parse(attendanceRes.value) : {};
    checkinSession = sessionRes && sessionRes.value ? JSON.parse(sessionRes.value) : null;
    checkinRequests = requestsRes && requestsRes.value ? JSON.parse(requestsRes.value) : {};
    checkinHistory = historyRes && historyRes.value ? JSON.parse(historyRes.value) : [];
    if(!Array.isArray(checkinHistory)) checkinHistory = [];
    if(checkinSession && Number(checkinSession.expiresAt) <= Date.now() && checkinSession.active) checkinSession.active = false;
    startCheckinRotation();
  }catch(e){ attendance = {}; }
}

function getSharedDataSnapshot(dataEmployees = employees, dataAttendance = attendance){
  return JSON.stringify({ employees: dataEmployees, attendance: dataAttendance, checkinSession, checkinRequests, checkinHistory });
}

async function refreshSharedData(shouldRender = true){
  if(sharedSyncBusy) return false;
  sharedSyncBusy = true;
  try{
    const canReadPrivatePhones = isAdmin();
    const [employeeRes, privateRes, attendanceRes, regs, sessionRes, requestsRes, historyRes] = await Promise.all([
      storageGet(KEY_EMP, true),
      canReadPrivatePhones ? storageGet(KEY_PRIVATE_EMP, true).catch(() => null) : Promise.resolve(null),
      storageGet(KEY_ATT, true),
      getPendingRegistrations(),
      storageGet(KEY_CHECKIN_SESSION, true),
      storageGet(KEY_CHECKINS, true),
      storageGet(KEY_CHECKIN_HISTORY, true),
    ]);
    const publicData = employeeRes && employeeRes.value ? JSON.parse(employeeRes.value) : employees;
    let nextEmployees = Array.isArray(publicData) ? publicData : Object.values(publicData || {});
    if(!canReadPrivatePhones) nextEmployees.forEach(employee => { delete employee.phone; delete employee.email; });
    if(canReadPrivatePhones && privateRes?.value){
      const privatePhones = JSON.parse(privateRes.value) || {};
      nextEmployees.forEach(employee => {
        const privateRecord = privatePhones[employee.id];
        if(privateRecord) employee.phone = typeof privateRecord === 'object' ? privateRecord.phone : privateRecord;
      });
    }
    if(Array.isArray(nextEmployees)) nextEmployees = mergeRegistrations(nextEmployees, regs);
    const nextAttendance = attendanceRes && attendanceRes.value ? JSON.parse(attendanceRes.value) : attendance;
    if(!Array.isArray(nextEmployees) || !nextAttendance || typeof nextAttendance !== 'object') return false;
    const nextSession = sessionRes && sessionRes.value ? JSON.parse(sessionRes.value) : null;
    const nextRequests = requestsRes && requestsRes.value ? JSON.parse(requestsRes.value) : {};
    const nextHistory = historyRes && historyRes.value ? JSON.parse(historyRes.value) : [];

    nextEmployees.forEach(normalizeEmployee);
    checkinSession = nextSession; checkinRequests = nextRequests; checkinHistory = Array.isArray(nextHistory) ? nextHistory : [];
    if(checkinSession && Number(checkinSession.expiresAt) <= Date.now() && checkinSession.active) checkinSession.active = false;
    const employeesChanged = JSON.stringify(employees) !== JSON.stringify(nextEmployees);
    const checkinNoticeShown = notifyLocalCheckinSession(checkinSession, false);
    const nextSnapshot = getSharedDataSnapshot(nextEmployees, nextAttendance);
    if(nextSnapshot === sharedDataSnapshot) return false;

    employees = nextEmployees;
    attendance = nextAttendance;
    startCheckinRotation();
    sharedDataSnapshot = nextSnapshot;
    if(employeesChanged && shouldRender){
      const editModal = document.getElementById('modal-overlay');
      if(editModal?.classList.contains('show')){
        editModal.classList.remove('show');
        currentView = 'list';
      }
    }
    if(shouldRender || checkinNoticeShown) render();
    if(employeesChanged && shouldRender) showToast('Danh sách thành viên đã được cập nhật.');
    return true;
  }catch(e){
    return false;
  }finally{
    sharedSyncBusy = false;
  }
}

function startSharedSync(){
  if(sharedSyncTimer) return;
  sharedDataSnapshot = getSharedDataSnapshot();
  refreshSharedData(false);
  sharedSyncTimer = setInterval(() => { refreshSharedData(true); syncMembershipNotice(true); }, 5000);

  const refreshWhenVisible = () => {
    if(!document.hidden){ refreshSharedData(true); syncMembershipNotice(true); }
  };
  window.addEventListener('focus', refreshWhenVisible);
  document.addEventListener('visibilitychange', refreshWhenVisible);
}
async function saveEmployees(nextEmployees = employees){
  const savedEmployees = nextEmployees.filter(e => !e._pendingReg);
  const publicEmployees = Object.fromEntries(savedEmployees.map(employee => {
    const { phone, email, ...publicEmployee } = employee;
    return [employee.id, publicEmployee];
  }));
  const privatePhones = Object.fromEntries(savedEmployees
    .filter(employee => employee.phone)
    .map(employee => [employee.id, employee.phone]));
  const existingPublicRes = await firebaseStorageGet(KEY_EMP).catch(() => ({ value:null }));
  const existingPublicData = existingPublicRes.value ? JSON.parse(existingPublicRes.value) : {};
  const existingPublic = Array.isArray(existingPublicData)
    ? Object.fromEntries(existingPublicData.filter(employee => employee?.id).map(employee => [employee.id, employee]))
    : (existingPublicData || {});
  await Promise.all(Object.entries(publicEmployees).map(([id, employee]) =>
    firebaseStoragePatch(`${KEY_EMP}/${id}`, employee)
  ));
  await Promise.all(Object.keys(existingPublic)
    .filter(id => !Object.prototype.hasOwnProperty.call(publicEmployees, id))
    .map(id => firebaseStorageDelete(`${KEY_EMP}/${id}`)));

  const existingPrivateRes = await firebaseStorageGet(KEY_PRIVATE_EMP).catch(() => ({ value:null }));
  const existingPrivate = existingPrivateRes.value ? JSON.parse(existingPrivateRes.value) || {} : {};
  await Promise.all(Object.entries(privatePhones).map(([id, phone]) =>
    firebaseStoragePatch(`${KEY_PRIVATE_EMP}/${id}`, { phone })
  ));
  await Promise.all(Object.keys(existingPrivate)
    .filter(id => !Object.prototype.hasOwnProperty.call(privatePhones, id))
    .map(id => firebaseStorageDelete(`${KEY_PRIVATE_EMP}/${id}`)));
  await syncManagerRoleIndex(savedEmployees);
  await storageSet('hr-meta', JSON.stringify({ updatedBy: (currentUser && currentUser.username) || 'unknown', updatedAt: new Date().toISOString() }), true);
  sharedDataSnapshot = getSharedDataSnapshot(savedEmployees, attendance);
}
async function saveAttendance(){
  try{
    await storageSet(KEY_ATT, JSON.stringify(attendance), true);
  }catch(e){ showToast('Lỗi khi lưu điểm danh.'); }
}

function newCheckinCode(){ return String(Math.floor(1000 + Math.random() * 9000)); }
async function loadCheckinSession(){
  try{
    const res = await storageGet(KEY_CHECKIN_SESSION, true);
    checkinSession = res && res.value ? JSON.parse(res.value) : null;
    if(checkinSession && checkinSession.closed){
      checkinSession.active = false;
      checkinSession.scheduledAt = null;
    }
    if(checkinSession && Number(checkinSession.expiresAt) <= Date.now()){
      checkinSession.active = false;
      checkinSession.closed = true;
      checkinSession.scheduledAt = null;
    }
  }catch(e){ checkinSession = null; }
}
function stopCheckinRotation(){
  if(checkinTimer) clearInterval(checkinTimer);
  checkinTimer = null;
}
function startCheckinRotation(){
  stopCheckinRotation();
  if(!checkinSession || checkinSession.closed) return;
  checkinTimer = setInterval(async () => {
    if(!checkinSession || checkinSession.closed) {
      stopCheckinRotation(); return;
    }

    if(!checkinSession.active && checkinSession.scheduledAt && Number(checkinSession.scheduledAt) <= Date.now()){
      checkinSession.active = true;
      checkinSession.startedAt = Date.now();
      if(isAdmin()) {
        try{ await storageSet(KEY_CHECKIN_SESSION, JSON.stringify(checkinSession), true); }
        catch(e){}
      }
      await notifyCheckinOpened(checkinSession);
      render();
    }

    if(checkinSession.active && Number(checkinSession.expiresAt) <= Date.now()){
      const requests = Object.values(checkinRequests).filter(r => r.sessionId === checkinSession.id);
      const total = approvedEmployees().filter(e => e.status === 'active').length;
      const present = requests.filter(r => r.status === 'present').length;
      checkinHistory.unshift({
        id: checkinSession.id,
        date: checkinSession.date,
        by: checkinSession.openedBy,
        present,
        total,
        rate: total ? Math.round(present / total * 100) : 0,
        requests: requests.map(r => ({ ...r })),
        closedAt: new Date().toISOString(),
        autoClosed: true
      });
      checkinSession.active = false;
      checkinSession.closed = true;
      checkinSession.scheduledAt = null;
      try{
        await storageSet(KEY_CHECKIN_HISTORY, JSON.stringify(checkinHistory), true);
        await storageSet(KEY_CHECKIN_SESSION, JSON.stringify(checkinSession), true);
      }catch(e){}
      stopCheckinRotation();
      showToast('Phiên họp đã tự động đóng sau khi hết thời gian.');
      render();
      return;
    }

    document.querySelectorAll('[data-checkin-countdown]').forEach(el => {
      el.textContent = checkinSession.active ? formatCountdown(checkinRemaining()) : formatCountdown(Math.max(0, Number(checkinSession.scheduledAt || Date.now()) - Date.now()));
    });
  }, 1000);
}
async function openCheckinPhase(phase){
  if(!requireAdmin()) return;
  const now = Date.now();
  const minutes = Number(document.getElementById('checkin-duration')?.value);
  if(!Number.isInteger(minutes) || minutes < 1 || minutes > 1440){
    showToast('Thời lượng phải từ 1 đến 1440 phút.');
    return;
  }
  const scheduledDate = document.getElementById('checkin-schedule-date')?.value || selectedDate || todayStr();
  const scheduledTime = document.getElementById('checkin-schedule-time')?.value || '09:00';
  const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`);
  if(Number.isNaN(scheduledAt.getTime())){
    showToast('Vui lòng chọn ngày và giờ mở phiên hợp lệ.');
    return;
  }
  const startsAt = scheduledAt.getTime();
  if(startsAt <= now){
    showToast('Thời gian mở phiên phải lớn hơn thời điểm hiện tại.');
    return;
  }
  checkinSession = {
    id:'m' + now.toString(36),
    date:scheduledDate,
    startsAt,
    code:newCheckinCode(),
    expiresAt:startsAt + minutes * 60000,
    active:false,
    closed:false,
    openedBy:currentUser?.username || '',
    scheduledAt:startsAt,
  };
  checkinRequests = {};
  try{
    await storageSet(KEY_CHECKIN_SESSION, JSON.stringify(checkinSession), true);
    await storageSet(KEY_CHECKINS, JSON.stringify(checkinRequests), true);
    startCheckinRotation();
    showToast(`Đã lên lịch mở phiên điểm danh vào ${formatDateVN(scheduledDate)} lúc ${scheduledTime}.`);
    render();
  }catch(e){ showToast(e.message || 'Không lên lịch được phiên điểm danh.'); }
}
async function loadCheckinData(){
  const [s,r,h] = await Promise.all([storageGet(KEY_CHECKIN_SESSION,true), storageGet(KEY_CHECKINS,true), storageGet(KEY_CHECKIN_HISTORY,true)]);
  checkinSession = s && s.value ? JSON.parse(s.value) : null;
  checkinRequests = r && r.value ? JSON.parse(r.value) : {};
  checkinHistory = h && h.value ? JSON.parse(h.value) : [];
}
function getOwnCheckinRequest(){
  if(!currentUser?.uid) return null;
  const uidRequest = checkinRequests[currentUser.uid];
  if(uidRequest && uidRequest.sessionId === checkinSession?.id) return uidRequest;
  const ownMember = approvedEmployees().find(e => e.registeredByUid === currentUser.uid);
  if(!ownMember) return uidRequest || null;
  const memberRequest = Object.values(checkinRequests).find(r => r.memberId === ownMember.id && r.sessionId === checkinSession?.id);
  return memberRequest || uidRequest || null;
}
function checkinRemaining(){
  if(!checkinSession) return 0;
  if(!checkinSession.active && checkinSession.scheduledAt){
    return Math.max(0, Number(checkinSession.scheduledAt) - Date.now());
  }
  return Math.max(0, Number(checkinSession.expiresAt) - Date.now());
}
function formatCountdown(ms){
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
}
function setHistoryFilter(value){ historyFilter = value; render(); }
function setHistorySearch(value){ historySearchTerm = value; render(); }
function toggleHistoryDetails(id){ expandedHistoryId = expandedHistoryId === id ? '' : id; render(); }
async function submitCheckin(memberId){
  if(!checkinSession || !checkinSession.active || checkinRemaining() <= 0){ showToast('Hiện không có phiên điểm danh đang mở.'); return; }
  if(isOwner() || !currentUser?.uid){ showToast('Luồng báo danh chỉ dành cho tài khoản thành viên.'); return; }
  const emp = approvedEmployees().find(e => e.registeredByUid === currentUser.uid);
  if(!emp) return;
  const key = currentUser.uid;
  const existingRequest = getOwnCheckinRequest();
  if(existingRequest && existingRequest.sessionId === checkinSession.id && existingRequest.status !== 'rejected'){
    showToast('Bạn đã gửi báo danh cho phiên này.'); return;
  }
  const request = { sessionId:checkinSession.id, memberId:emp.id, memberName:emp.name, uid:currentUser?.uid || '', status:'pending', time:new Date().toISOString() };
  try{
    await storageSet(`${KEY_CHECKINS}/${key}`, JSON.stringify(request), true);
    checkinRequests[key] = request;
    const sameMemberRequest = Object.values(checkinRequests).find(r => r.memberId === emp.id && r.sessionId === checkinSession.id && r.uid !== key);
    if(sameMemberRequest) checkinRequests[sameMemberRequest.uid] = request;
    showToast('Đã gửi yêu cầu báo danh, chờ xác nhận.'); render();
  }catch(e){ showToast(e.message || 'Không gửi được yêu cầu báo danh.'); }
}
async function updateCheckin(uid, status){
  if(!requireAdmin()) return;
  const req = checkinRequests[uid]; if(!req) return;
  req.status = status;
  await storageSet(`${KEY_CHECKINS}/${uid}`, JSON.stringify(req), true);
  checkinRequests[uid] = req; render();
}
async function confirmAllCheckins(){
  if(!requireAdmin()) return;
  for(const [uid, req] of Object.entries(checkinRequests)){
    if(req.sessionId === checkinSession?.id && req.status === 'pending'){ req.status='present'; await storageSet(`${KEY_CHECKINS}/${uid}`, JSON.stringify(req), true); }
  }
  await loadCheckinData(); render();
}
async function cancelScheduledCheckinSession(){
  if(!requireAdmin() || !checkinSession) return;
  if(checkinSession.active){
    showToast('Phiên đang hoạt động, hãy đóng phiên thay vì hủy lịch.');
    return;
  }
  checkinSession = null;
  checkinRequests = {};
  try{
    await storageSet(KEY_CHECKIN_SESSION, JSON.stringify(null), true);
    await storageSet(KEY_CHECKINS, JSON.stringify({}), true);
    showToast('Đã hủy lịch mở phiên điểm danh.');
    render();
  }catch(e){ showToast(e.message || 'Không thể hủy lịch mở phiên.'); }
}
async function closeCheckinSession(){
  if(!requireAdmin() || !checkinSession) return;
  const requests = Object.values(checkinRequests).filter(r => r.sessionId === checkinSession.id);
  const total = approvedEmployees().filter(e => e.status === 'active').length;
  const present = requests.filter(r => r.status === 'present').length;
  checkinHistory.unshift({ id:checkinSession.id, date:checkinSession.date, by:checkinSession.openedBy, present, total, rate: total ? Math.round(present / total * 100) : 0, requests: requests.map(r => ({ ...r })), closedAt:new Date().toISOString() });
  checkinSession.active = false; checkinSession.closed = true; checkinSession.scheduledAt = null;
  await storageSet(KEY_CHECKIN_HISTORY, JSON.stringify(checkinHistory), true);
  await storageSet(KEY_CHECKIN_SESSION, JSON.stringify(checkinSession), true);
  stopCheckinRotation(); showToast('Đã đóng phiên và lưu lịch sử.'); render();
}

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function belongsToCurrentUser(employee){
  return (employee.registeredByUid && employee.registeredByUid === currentUser?.uid) ||
    (!employee.registeredByUid && employee.registeredBy === currentUser?.username);
}
function hasApprovedMembership(){
  if(currentUser?.membershipRevoked) return false;
  return isAdmin() || employees.some(e => belongsToCurrentUser(e) && e.registrationStatus === 'approved');
}
function getCurrentUserRoleLabel(){
  if(isOwner()) return 'Chủ Gia Đình';
  const membership = employees.find(e => belongsToCurrentUser(e) && e.registrationStatus === 'approved');
  return membership?.position || 'Thành Viên';
}
function getCurrentUserRoleClass(){
  if(isOwner()) return 'owner';
  const membership = employees.find(e => belongsToCurrentUser(e) && e.registrationStatus === 'approved');
  return hasManagerRole(membership) ? 'manager' : 'member';
}
function hasPendingRegistration(){
  return employees.some(e => belongsToCurrentUser(e) && e.registrationStatus === 'pending');
}
function hasRejectedRegistration(){
  return employees.some(e => belongsToCurrentUser(e) && e.registrationStatus === 'rejected');
}
function hasMembershipRegistration(){
  if(currentUser?.membershipRevoked) return false;
  return employees.some(e => belongsToCurrentUser(e) && e.registrationStatus !== 'rejected');
}
function getMemberFallbackView(){
  const hasApplication = hasPendingRegistration();
  return currentUser?.membershipRevoked || currentUser?.membershipNotice?.type === 'revoked' || !hasApplication ? 'about' : 'member-pending';
}
function canAccessView(view){
  if(isAdmin()) return true;
  if(currentUser?.membershipRevoked || currentUser?.membershipNotice?.type === 'revoked'){
    return ['about','contribution'].includes(view);
  }
  return ['about','contribution'].includes(view) || (view === 'member-pending' && hasPendingRegistration()) || (view === 'list' && hasApprovedMembership()) || (view === 'attendance' && hasApprovedMembership()) || (view === 'scars' && hasApprovedMembership());
}

function initializeAppHistory(){
  if(appHistoryInitialized) return;
  const state = { ...(history.state || {}), lowPortal: true, view: currentView };
  history.replaceState(state, '', location.href);
  history.pushState(state, '', location.href);
  appHistoryInitialized = true;
  window.addEventListener('popstate', handleAppHistory);
}

function handleAppHistory(event){
  if(!appHistoryInitialized || !currentUser) return;
  const nextView = event.state?.lowPortal && event.state.view;
  if(nextView && canAccessView(nextView)){
    currentView = nextView;
    render();
    return;
  }
  history.pushState({ lowPortal:true, view:currentView }, '', location.href);
}

function setView(v){
  const nextView = canAccessView(v) ? v : 'member-pending';
  if(!canAccessView(v)){
    showToast('Tài khoản cần được duyệt thành viên trước khi xem mục này.');
  }
  if(nextView === currentView) return;
  currentView = nextView;
  if(appHistoryInitialized) history.pushState({ lowPortal:true, view:currentView }, '', location.href);
  render();
}

function filteredEmployees(){
  return employees.filter(e => {
    if(e.registrationStatus === 'pending') return false;
    const matchesSearch = !searchTerm ||
      e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (isManagerOrAbove() && String(e.phone || '').toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesDept = filterDept === 'all' || e.position === filterDept;
    const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
    return matchesSearch && matchesDept && matchesStatus;
  });
}

function onSearchInput(val){ searchTerm = val; renderListOnly(); }
function onFilterDept(val){ filterDept = val; renderListOnly(); }
function onFilterStatus(val){ filterStatus = val; renderListOnly(); }

function onScarSearchInput(val){
  scarSearchTerm = val;
  const slot = document.getElementById('scars-list-slot');
  if(slot) slot.outerHTML = scarsListHtml();
}

function renderListOnly(){
  document.getElementById('table-body-slot').outerHTML = tableBodyHtml();
}

function openModal(id){
  if(!id && !isAdmin() && !currentUser?.membershipRevoked && hasMembershipRegistration()){
    showToast('Tài khoản này đã đăng ký thành viên và không thể đăng ký lần nữa.');
    return;
  }
  editingId = id || null;
  document.getElementById('modal-overlay').classList.add('show');
  const emp = id ? employees.find(e => e.id === id) : null;
  const history = !emp ? getMemberFormHistory() : {};
  populateMemberFormSuggestions(history);
  document.getElementById('modal-title').textContent = emp ? 'Sửa Thông Tin Thành Viên' : (isAdmin() ? 'Thêm Thành Viên' : 'Đăng Ký Thành Viên');
  document.getElementById('f-name').value = emp ? emp.name : '';
  document.getElementById('f-hometown').value = emp ? emp.hometown : '';
  document.getElementById('f-birthdate').value = emp ? (emp.birthDate || '') : '';
  document.getElementById('f-phone').value = emp ? (emp.phone || '') : '';
  document.getElementById('f-position').value = emp ? emp.position : 'Thành Viên Mới';
  document.getElementById('f-department').value = emp ? emp.department : '';
  document.getElementById('f-status').value = emp ? emp.status : 'active';
  document.getElementById('status-field').style.display = isAdmin() ? '' : 'none';
  document.getElementById('f-birthdate').min = '1900-01-01';
  document.getElementById('f-birthdate').max = todayStr();
  document.getElementById('f-joindate').value = emp ? emp.joinDate : todayStr();
}
function closeModal(){
  document.getElementById('modal-overlay').classList.remove('show');
  editingId = null;
}

async function submitForm(ev){
  ev.preventDefault();
  if(editingId && !requireAdmin()) return;
  if(!editingId && !isAdmin() && !currentUser?.membershipRevoked && hasMembershipRegistration()){
    showToast('Tài khoản này đã đăng ký thành viên và không thể đăng ký lần nữa.');
    closeModal();
    return;
  }
  const name = document.getElementById('f-name').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const birthDate = document.getElementById('f-birthdate').value || '';
  const position = document.getElementById('f-position').value.trim();
  if(!name || !phone){ showToast('Vui lòng nhập họ tên và số điện thoại.'); return; }
  if(!isValidBirthDate(birthDate)){ showToast('Ngày sinh không hợp lệ. Hãy chọn ngày từ năm 1900 đến hiện tại.'); return; }
  if(!DEPARTMENTS.includes(position)){ showToast('Vui lòng chọn chức vụ hợp lệ.'); return; }
  const statusEl = document.getElementById('f-status');
  const data = {
    name, phone,
    hometown: document.getElementById('f-hometown').value.trim(),
    birthDate,
    position,
    department: document.getElementById('f-department').value.trim(),
    status: (isAdmin() && statusEl) ? statusEl.value : 'inactive',
    joinDate: document.getElementById('f-joindate').value || todayStr(),
  };
  const wasEditing = Boolean(editingId);
  if(editingId){
    const idx = employees.findIndex(e => e.id === editingId);
    employees[idx] = { ...employees[idx], ...data };
  }else{
    const newEmp = { id: createEntityId(), ...data, status: isAdmin() ? data.status : 'inactive', scars:0, violations:[], presentStreak:0, vault:0, contributionLog:[], registeredBy: currentUser?.username || '', registeredByUid: currentUser?.uid || '', registrationStatus: isAdmin() ? 'approved' : 'pending' };
    if(isAdmin()){
      employees.push(newEmp);
    }else{
      // Thành viên thường chỉ được ghi node hồ sơ của chính mình,
      // không ghi đè cả bảng hr-employees.
      const myUid = currentUser?.uid || authTokens?.localId || '';
      if(!myUid){ showToast('Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'); return; }
      try{
        await firebaseStorageSet(`${KEY_REGS}/${myUid}`, JSON.stringify(newEmp));
      }catch(e){ showToast(e.message || 'Không gửi được đăng ký.'); return; }
      employees.push({ ...newEmp, regUid: myUid, _pendingReg:true });
      saveMemberFormHistory(data);
      closeModal();
      currentUser.membershipRevoked = false;
      await saveSession();
      currentView = 'member-pending';
      showToast('Đã gửi đăng ký, chờ Chủ Gia Đình xét duyệt.');
      render();
      return;
    }
    showToast('Đã thêm nhân viên mới.');
  }
  try{
    await saveEmployees();
  }catch(e){
    showToast(e.message || 'Không thể cập nhật thông tin thành viên.');
    return;
  }
  saveMemberFormHistory(data);
  if(wasEditing){
    showToast('Cập nhật thông tin thành viên thành công.');
    closeModal();
    currentView = 'list';
  }else if(!isAdmin()) currentView = 'member-pending';
  else closeModal();
  render();
}

async function deleteEmployee(id){
  if(!requireAdmin()) return;
  const emp = employees.find(e => e.id === id);
  if(!emp) return;
  askConfirm(`Xoá nhân viên "${emp.name}"? Hành động này không thể hoàn tác.`, async () => {
    const remainingEmployees = employees.filter(e => e.id !== id);
    try{
      // Chỉ cập nhật giao diện sau khi Firebase xác nhận đã lưu, tránh trường
      // hợp báo đã xoá nhưng tải lại dữ liệu vẫn quay về như cũ.
      await saveEmployees(remainingEmployees);
      employees = remainingEmployees;
      await notifyMembershipRemoval(emp);
      showToast('Đã xoá nhân viên.');
      if(currentView === 'list'){
        renderListOnly();
        applyRolePermissions();
      }else{
        render();
      }
    }catch(e){
      showToast(e.message || 'Không thể lưu việc xoá thành viên.');
    }
  });
}

async function setAttendanceStatus(empId, status){
  if(!requireAdmin()) return;
  const day = selectedDate;
  if(!attendance[day]) attendance[day] = {};
  attendance[day][empId] = status;
  await saveAttendance();
  const slot = document.getElementById('attendance-body-slot');
  if(slot) slot.innerHTML = attendanceBodyHtml();
}

function round1(n){ return Math.round(n * 10) / 10; }

function scarLevel(scars){
  if(scars >= MAX_SCARS) return { key:'suspend', label:'Tạm Đình Chỉ' };
  if(scars >= 2) return { key:'warn', label:'Cảnh Cáo Công Khai' };
  if(scars >= 1) return { key:'notice', label:'Nhắc Nhở' };
  return { key:'ok', label:'Bình Thường' };
}

function scarBadge(emp){
  if(!emp.scars) return '';
  const n = Number.isInteger(emp.scars) ? emp.scars : emp.scars.toFixed(1);
  const isMax = emp.scars >= MAX_SCARS;
  return `<span class="scar-badge ${isMax?'max':''}">⚠️ x${escapeHtml(n)}</span>${isMax ? '<span class="suspend-label">Cảnh Báo / Tạm Đình Chỉ</span>' : ''}`;
}

async function addViolation(empId, reasonKey, note, opts){
  opts = opts || {};
  const emp = employees.find(e => e.id === empId);
  if(!emp) return;
  const reason = VIOLATION_REASONS.find(r => r.key === reasonKey);
  if(!reason) return;

  // Lưu số sẹo trước khi cộng để chỉ cảnh báo đúng thời điểm chạm mốc 3.
  const previousScars = Number(emp.scars || 0);
  emp.scars = round1(Math.min(previousScars + reason.amount, 99));
  emp.violations.push({ id: createEntityId(), date: todayStr(), type: reasonKey, label: reason.label, amount: reason.amount, note: (note||'').trim() });
  await saveEmployees();

  if(!opts.silent){
    showToast(`Đã ghi ${reason.amount} sẹo cho ${emp.name}: ${reason.label}.`);

    // Cảnh báo lớn khi thành viên vừa chạm mốc 3 sẹo, không phụ thuộc lý do vi phạm.
    if(previousScars < MAX_SCARS && emp.scars >= MAX_SCARS){
      showScarAlert(emp, reason);
    }
  }
}

function showScarAlert(emp, reason){
  const max = MAX_SCARS;
  document.getElementById('scar-alert-name').textContent = emp.name;
  document.getElementById('scar-alert-score').textContent = `${emp.scars} / ${max} sẹo`;
  document.getElementById('scar-alert-progress').style.width = '100%';
  document.getElementById('scar-alert-title').textContent = '🚨 ĐỦ 3 SẸO – CẦN XỬ LÝ';
  document.getElementById('scar-alert-message').textContent = `${emp.name} đã đạt mốc ${MAX_SCARS} sẹo. Hãy kiểm tra và quyết định hình thức xử lý.`;
  document.getElementById('scar-alert-overlay').classList.add('show');
}
function closeScarAlert(){ document.getElementById('scar-alert-overlay').classList.remove('show'); }

function askConfirm(message, onYes){
  pendingConfirmAction = onYes;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-overlay').classList.add('show');
}
function closeConfirmModal(){
  document.getElementById('confirm-overlay').classList.remove('show');
  pendingConfirmAction = null;
}
async function runConfirmedAction(){
  const action = pendingConfirmAction;
  closeConfirmModal();
  if(action) await action();
}

async function clearAllScars(empId){
  if(!requireAdmin()) return;
  const emp = employees.find(e => e.id === empId);
  if(!emp) return;
  if(!emp.scars || emp.scars <= 0){ showToast(`${emp.name} hiện không có sẹo để xoá.`); return; }
  askConfirm(`Xoá TẤT CẢ ${emp.scars} sẹo của ${emp.name}?`, async () => {
    const cleared = emp.scars;
    emp.scars = 0;
    emp.violations.push({ id: createEntityId(), date: todayStr(), type:'manual_clear', label:'Xoá Tất Cả Sẹo', amount: -cleared, note:'' });
    await saveEmployees();
    showToast(`Đã xoá tất cả sẹo của ${emp.name}.`);
    render();
  });
}

async function removeViolation(empId, violationId){
  if(!requireAdmin()) return;
  const emp = employees.find(e => e.id === empId);
  if(!emp) return;
  const v = emp.violations.find(x => x.id === violationId);
  if(!v || v.amount <= 0) return;
  askConfirm(`Xoá vi phạm "${v.label}" (${formatDateVN(v.date)}, +${v.amount} sẹo) của ${emp.name}?`, async () => {
    emp.scars = round1(Math.max(0, emp.scars - v.amount));
    emp.violations = emp.violations.filter(x => x.id !== violationId);
    await saveEmployees();
    showToast(`Đã xoá vi phạm và trừ ${v.amount} sẹo cho ${emp.name}.`);
    render();
  });
}

function openViolationModal(empId, mode){
  violationContext = { empId, mode };
  const emp = employees.find(e => e.id === empId);
  if(!emp) return;
  document.getElementById('violation-emp-name').textContent = emp.name + (emp.position ? ' · ' + emp.position : '');
  document.getElementById('violation-note').value = '';
  document.getElementById('violation-reasons').innerHTML = VIOLATION_REASONS.map(r => `
    <button type="button" class="reason-btn" onclick="confirmViolation('${r.key}')">
      <span>${r.label}</span><span class="amt">+${r.amount} Sẹo</span>
    </button>
  `).join('');
  document.getElementById('violation-overlay').classList.add('show');
}
function closeViolationModal(){
  document.getElementById('violation-overlay').classList.remove('show');
  violationContext = null;
}
async function confirmViolation(reasonKey){
  if(!requireAdmin()) return;
  if(!violationContext) return;
  const { empId, mode } = violationContext;
  const note = document.getElementById('violation-note').value;
  if(mode === 'attendance'){
    const day = todayStr();
    if(!attendance[day]) attendance[day] = {};
    attendance[day][empId] = 'absent';
    await saveAttendance();
  }
  await addViolation(empId, reasonKey, note);
  closeViolationModal();
  render();
}

function toggleHistoryDate(date){
  openHistoryDates[date] = !openHistoryDates[date];
  render();
}

function statusLabel(s){
  return s === 'present' ? 'Có Mặt' : s === 'absent' ? 'Vắng' : 'Chưa Điểm Danh';
}

function formatPhoneForDisplay(phone, employeeId){
  const value = String(phone || '').trim();
  if(!value) return '—';
  if(employeeId && revealedPhoneIds.has(employeeId)) return value;
  return '••••••••••';
}
function togglePhoneVisibility(employeeId){
  if(!isManagerOrAbove()) return;
  if(revealedPhoneIds.has(employeeId)) revealedPhoneIds.delete(employeeId);
  else revealedPhoneIds.add(employeeId);
  const cell = document.querySelector(`[data-phone-id="${employeeId}"]`);
  const valueEl = cell?.querySelector('[data-phone-value]');
  const buttonEl = cell?.querySelector('.phone-eye');
  const employee = employees.find(item => item.id === employeeId);
  if(!valueEl || !buttonEl || !employee) return;
  const visible = revealedPhoneIds.has(employeeId);
  valueEl.textContent = formatPhoneForDisplay(employee.phone, employeeId);
  buttonEl.classList.toggle('is-visible', visible);
  buttonEl.title = visible ? 'Ẩn số điện thoại' : 'Hiện số điện thoại';
  buttonEl.setAttribute('aria-label', buttonEl.title);
}

function tableBodyHtml(){
  const canRevealPhone = isManagerOrAbove();
  const DEPT_ORDER = ['Boss','UnderBoss','Quản Lý','Lose Or Win','Thành Viên Mới'];
  const getRank = e => {
    const ri = DEPT_ORDER.indexOf(e.position);
    const di = DEPT_ORDER.indexOf(e.department);
    const r = ri === -1 ? 99 : ri;
    const d = di === -1 ? 99 : di;
    return Math.min(r, d);
  };
  const rows = filteredEmployees().sort((a, b) => getRank(a) - getRank(b));
  if(rows.length === 0){
    return `<tbody id="table-body-slot"><tr><td colspan="${isOwner() ? 9 : 8}"><div class="empty-state">Không tìm thấy nhân viên phù hợp.</div></td></tr></tbody>`;
  }
  return '<tbody id="table-body-slot">' + rows.map(e => `
    <tr class="${e.scars >= MAX_SCARS ? 'suspended' : ''}">
      <td>
        <div class="emp-name">${escapeHtml(e.name)}${scarBadge(e)}</div>
      </td>
      <td class="phone-cell"${canRevealPhone ? ` data-phone-id="${escapeHtml(e.id)}"` : ''}><span data-phone-value>${canRevealPhone ? escapeHtml(formatPhoneForDisplay(e.phone, e.id)) : '••••••••••'}</span>${canRevealPhone ? `<button type="button" class="phone-eye${revealedPhoneIds.has(e.id) ? ' is-visible' : ''}" onclick="togglePhoneVisibility('${escapeHtml(e.id)}')" title="${revealedPhoneIds.has(e.id) ? 'Ẩn số điện thoại' : 'Hiện số điện thoại'}" aria-label="${revealedPhoneIds.has(e.id) ? 'Ẩn số điện thoại' : 'Hiện số điện thoại'}">👁</button>` : ''}</td>
      <td>${escapeHtml(e.hometown || '—')}</td>
      <td>${e.birthDate ? escapeHtml(formatDateVN(e.birthDate)) : '—'}</td>
      <td>${escapeHtml(e.position || '—')}</td>
      <td>${escapeHtml(e.department || '—')}</td>
      <td>${e.joinDate ? escapeHtml(formatDateVN(e.joinDate)) : '—'}</td>
      <td><span class="badge ${e.status === 'active' ? 'badge-active' : 'badge-inactive'}">${e.status === 'active' ? 'Đang Hoạt Động' : 'Đang Off'}</span></td>
      ${isAdmin() ? `<td>
        <div class="row-actions">
          <button class="icon-btn admin-only" onclick="openModal('${e.id}')">Sửa</button>
          <button class="icon-btn danger admin-only" onclick="deleteEmployee('${e.id}')">Xoá</button>
        </div>
      </td>` : ''}
    </tr>
  `).join('') + '</tbody>';
}

function renderListView(){
  const pendingCount = employees.filter(e => e.registrationStatus === 'pending').length;
  return `
    <div class="topbar">
      <div>
        <h2>Danh Sách Thành Viên</h2>
        <p class="sub">${employees.filter(e=>e.registrationStatus === 'approved').length} nhân viên · ${employees.filter(e=>e.registrationStatus === 'approved' && e.status==='active').length} đang hoạt động</p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
        ${isAdmin() ? `<button class="btn btn-ghost" onclick="setView('pending')">Chờ Xét Duyệt ${pendingCount ? `<span class="notification-badge">${pendingCount}</span>` : ''}</button>` : ''}
        ${!isAdmin() && !hasMembershipRegistration() ? '<button class="btn btn-primary" onclick="openModal()">+ Đăng Ký Thành Viên</button>' : ''}
      </div>
    </div>
    <div class="filters">
      <input type="text" placeholder="${isAdmin() ? 'Tìm Theo Tên Hoặc Số Điện Thoại…' : 'Tìm Theo Tên…'}" value="${escapeHtml(searchTerm)}" oninput="onSearchInput(this.value)">
      <select onchange="onFilterDept(this.value)">
        <option value="all" ${filterDept==='all'?'selected':''}>Chức Vụ</option>
        ${DEPARTMENTS.map(d => `<option value="${d}" ${filterDept===d?'selected':''}>${d}</option>`).join('')}
      </select>
      <select onchange="onFilterStatus(this.value)">
        <option value="all" ${filterStatus==='all'?'selected':''}>Tất Cả Trạng Thái</option>
        <option value="active" ${filterStatus==='active'?'selected':''}>Đang Hoạt Động</option>
        <option value="inactive" ${filterStatus==='inactive'?'selected':''}>Đang Off</option>
      </select>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Tên</th><th>Số Điện Thoại</th><th>Quê Quán</th><th>Ngày Sinh</th><th>Chức Vụ</th><th>Tên Ingame</th><th>Ngày Vào LOW</th><th>Trạng Thái</th>${isAdmin() ? '<th>Thao Tác</th>' : ''}</tr></thead>
        ${tableBodyHtml()}
      </table>
    </div>
  `;
}

function renderMemberPendingView(){
  const ownPending = employees.filter(e => e.registrationStatus === 'pending' && belongsToCurrentUser(e));
  const ownRejected = employees.find(e => e.registrationStatus === 'rejected' && belongsToCurrentUser(e));
  if(!ownPending.length && !ownRejected){
    currentView = 'about';
    return renderAboutView();
  }
  return `
    <div class="topbar">
      <div>
        <h2>Đợi Xét Duyệt</h2>
        <p class="sub">Theo dõi hồ sơ đăng ký thành viên của bạn</p>
      </div>
      ${!hasMembershipRegistration() ? '<button class="btn btn-primary" onclick="openModal()">+ Đăng Ký Thành Viên</button>' : ''}
    </div>
    ${ownRejected ? '<div class="empty-state"><b>Hồ sơ đăng ký đã bị từ chối.</b><br>Tài khoản này đã sử dụng lượt đăng ký thành viên và không thể đăng ký lại.</div>' : ownPending.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Họ Tên</th><th>Số Điện Thoại</th><th>Chức Vụ</th><th>Trạng Thái</th></tr></thead>
      <tbody>${ownPending.map(e => `<tr><td><div class="emp-name">${escapeHtml(e.name)}</div></td><td>${formatPhoneForDisplay(e.phone)}</td><td>${escapeHtml(e.position || 'Thành Viên Mới')}</td><td><span class="badge" style="background:rgba(217,164,65,.18);color:var(--amber);">Đang Chờ Duyệt</span></td></tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-state">Bạn chưa có hồ sơ nào đang chờ xét duyệt.</div>'}
  `;
}

async function approveRegistration(empId){
  if(!requireAdmin()) return;
  const emp = employees.find(e => e.id === empId);
  if(!emp || emp.registrationStatus !== 'pending') return;
  emp.registrationStatus = 'approved';
  emp.status = 'active';
  const regUid = emp.regUid;
  delete emp._pendingReg; delete emp.regUid;
  await saveEmployees();
  if(regUid){ try{ await firebaseStorageDelete(`${KEY_REGS}/${regUid}`); }catch(e){} }
  showToast(`Đã duyệt hồ sơ của ${emp.name}.`);
  await notifyRegistrationApproved(emp);

  if(employees.some(e => e.registrationStatus === 'pending')){
    render();
  }else{
    currentView = 'list';
    if(appHistoryInitialized) history.replaceState({ ...(history.state || {}), lowPortal:true, view:'list' }, '', location.href);
    render();
  }
}

async function rejectRegistration(empId){
  if(!requireAdmin()) return;
  const emp = employees.find(e => e.id === empId);
  if(!emp || emp.registrationStatus !== 'pending') return;
  askConfirm(`Từ chối hồ sơ đăng ký của "${emp.name}"? Thành viên có thể đăng ký lại sau khi nhận thông báo.`, async () => {
    const rejectedEmp = { ...emp };
    const regUid = rejectedEmp.regUid;
    const remainingEmployees = employees.filter(item => item.id !== empId);
    delete rejectedEmp._pendingReg; delete rejectedEmp.regUid;
    await saveEmployees(remainingEmployees);
    if(regUid){ try{ await firebaseStorageDelete(`${KEY_REGS}/${regUid}`); }catch(e){} }
    await notifyRegistrationRejected(rejectedEmp);
    employees = remainingEmployees;
    showToast(`Đã từ chối hồ sơ của ${emp.name}. Thành viên có thể đăng ký lại.`);
    render();
  });
}

function renderPendingView(){
  if(!isAdmin()) return renderListView();
  const pending = employees.filter(e => e.registrationStatus === 'pending');
  if(!pending.length){
    currentView = 'list';
    if(appHistoryInitialized) history.replaceState({ ...(history.state || {}), lowPortal:true, view:'list' }, '', location.href);
    setTimeout(() => {
      if(isAdmin() && currentView === 'pending' && !employees.some(e => e.registrationStatus === 'pending')){
        currentView = 'list';
        render();
      }
    }, 0);
    return renderListView();
  }
  return `
    <div class="topbar">
      <div>
        <h2>Hồ Sơ Chờ Xét Duyệt</h2>
        <p class="sub">${pending.length} hồ sơ đang chờ Chủ Gia Đình xem xét</p>
      </div>
      <button class="btn btn-ghost" onclick="setView('list')">Quay Lại Danh Sách</button>
    </div>
    ${pending.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Tên</th><th>Số Điện Thoại</th><th>Quê Quán</th><th>Ngày Sinh</th><th>Chức Vụ</th><th>Tên Ingame</th><th>Ngày Vào LOW</th><th>Trạng Thái</th><th>Thao Tác</th></tr></thead>
      <tbody>${pending.map(e => `<tr>
        <td><div class="emp-name">${escapeHtml(e.name)}</div></td>
        <td>${escapeHtml(formatPhoneForDisplay(e.phone))}</td>
        <td>${escapeHtml(e.hometown || '—')}</td>
        <td>${e.birthDate ? escapeHtml(formatDateVN(e.birthDate)) : '—'}</td>
        <td>${escapeHtml(e.position || '—')}</td>
        <td>${escapeHtml(e.department || '—')}</td>
        <td>${e.joinDate ? escapeHtml(formatDateVN(e.joinDate)) : '—'}</td>
        <td><span class="badge" style="background:rgba(217,164,65,.18);color:var(--amber);">Đang Chờ Duyệt</span><div class="emp-email">Đăng ký bởi: ${escapeHtml(e.registeredBy || '—')}</div></td>
        <td><div class="row-actions"><button class="icon-btn" onclick="approveRegistration('${e.id}')">Duyệt</button><button class="icon-btn danger" onclick="rejectRegistration('${e.id}')">Từ Chối</button></div></td>
      </tr>`).join('')}</tbody>
    </table></div>` : '<div class="empty-state">Hiện không có hồ sơ nào chờ xét duyệt.</div>'}
  `;
}

let attendanceSearchTerm = '';
let selectedDate = todayStr();

function attendanceBodyHtml(){
  if(!isAdmin()) return '';
  const active = approvedEmployees().filter(e => e.status === 'active');
  const requests = Object.values(checkinRequests).filter(r => r.sessionId === checkinSession?.id);
  const pending = requests.filter(r => r.status === 'pending').length;
  const present = requests.filter(r => r.status === 'present').length;
  return `<div class="summary-row"><div class="summary-card"><div class="num">${present}</div><div class="lbl">Đã Xác Nhận</div></div><div class="summary-card"><div class="num">${pending}</div><div class="lbl">Chờ Duyệt</div></div><div class="summary-card"><div class="num">${Math.max(0,active.length-present-pending)}</div><div class="lbl">Chưa Báo Danh</div></div></div>
    <div class="filters"><input type="text" placeholder="Tìm theo tên hoặc chức vụ…" value="${escapeHtml(attendanceSearchTerm)}" oninput="onAttendanceSearchInput(this.value)"></div>
    <div class="table-wrap"><table><thead><tr><th>Thành viên</th><th>Thời gian</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
    ${active.filter(e => !attendanceSearchTerm || e.name.toLowerCase().includes(attendanceSearchTerm.toLowerCase()) || (e.position||'').toLowerCase().includes(attendanceSearchTerm.toLowerCase())).map(e => {
      const r = requests.find(x => x.memberId === e.id);
      return `<tr><td><b>${escapeHtml(e.name)}</b><div class="emp-email">${escapeHtml(e.position || e.department || '')}</div></td><td>${r?.time ? new Date(r.time).toLocaleTimeString('vi-VN') : '—'}</td><td><span class="badge">${r?.status === 'present' ? 'Đã xác nhận' : r?.status === 'pending' ? 'Chờ duyệt' : r?.status === 'rejected' ? 'Đã từ chối' : 'Chưa báo danh'}</span></td><td>${r?.status === 'pending' ? `<button class="icon-btn admin-only" onclick="updateCheckin('${r.uid}','present')">Xác nhận</button><button class="icon-btn danger admin-only" onclick="updateCheckin('${r.uid}','rejected')">Từ chối</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function onAttendanceSearchInput(val){
  attendanceSearchTerm = val;
  render();
}

function onDateChange(val){
  if(!val) return;
  selectedDate = val;
  render();
}

function jumpToDate(d){
  selectedDate = d;
  render();
  window.scrollTo({ top:0, behavior:'smooth' });
}



/* ================= CỐNG HIẾN / CREW ================= */
function getFactionRole(emp){
  const d=(emp.department||'').toLowerCase();
  if(d.includes('under')) return 'Commissioner / Underboss';
  if(d.includes('boss')) return 'Leader / Boss';
  if(d.includes('quản')) return 'Lieutenant / Đội trưởng';
  if(d.includes('lose or win')) return 'Representative / Thành viên nòng cốt';
  if(d.includes('mới')) return 'Prospect / Rookie';
  return 'Muscle / Enforcer';
}
function formatVault(n){ return new Intl.NumberFormat('vi-VN').format(Number(n||0)) + ' $'; }
function contributionTimestamp(){ return new Date().toISOString(); }
function formatContributionTime(log){
  if(log.timestamp){
    const d=new Date(log.timestamp);
    if(!Number.isNaN(d.getTime())) return new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'medium'}).format(d);
  }
  return log.date ? `${log.date} · Chưa có giờ chi tiết` : 'Chưa có thời gian';
}
function openVaultModal(){
  const body=document.getElementById('vault-modal-body'); if(!body) return;
  const ranked=[...approvedEmployees()].sort((a,b)=>(b.vault||0)-(a.vault||0));
  const total=ranked.reduce((n,e)=>n+(e.vault||0),0);
  const logs=ranked.flatMap(e=>(e.contributionLog||[]).filter(x=>x.type==='vault').map(x=>({...x,member:e.name,role:getFactionRole(e)})));
  body.innerHTML=`
    <div class="vault-total-banner"><div><span>Tổng quỹ gia đình hiện tại</span><b>${formatVault(total)}</b></div><div class="vault-count"><b>${ranked.length}</b> thành viên được theo dõi<br><b>${logs.length}</b> lượt ủng hộ đã ghi nhận</div></div>
    <div class="vault-section-title">🏆 Xếp hạng đóng góp — Top 1 trở xuống</div>
    ${ranked.length ? ranked.map((e,i)=>`<div class="vault-rank-row" onclick="openVaultMemberDetail('${e.id}')"><div class="vault-rank-no">#${i+1}</div><div class="vault-rank-name"><b>${escapeHtml(e.name)}</b><span>${escapeHtml(getFactionRole(e))} · ${escapeHtml(e.department||'LOW Crew')} · ${escapeHtml(e.position||'Thành viên')}</span><small class="vault-click-hint">Nhấn vào tên để xem lịch sử chi tiết ›</small></div><div class="vault-rank-amount">${formatVault(e.vault||0)}<span>Tổng đã ủng hộ</span></div></div>`).join('') : '<div class="empty-state">Chưa có thành viên.</div>'}`;
  document.getElementById('vault-overlay').classList.add('show');
}
function openVaultMemberDetail(empId){
  const body=document.getElementById('vault-modal-body');
  const emp=employees.find(e=>e.id===empId); if(!body||!emp) return;
  const logs=(emp.contributionLog||[]).filter(x=>x.type==='vault').sort((a,b)=>new Date(b.timestamp||b.date||0)-new Date(a.timestamp||a.date||0));
  const totalAll=approvedEmployees().reduce((n,e)=>n+(e.vault||0),0);
  const rank=[...approvedEmployees()].sort((a,b)=>(b.vault||0)-(a.vault||0)).findIndex(e=>e.id===emp.id)+1;
  const latest=logs[0];
  body.innerHTML=`
    <div class="vault-member-head"><button class="vault-back-btn" onclick="openVaultModal()">← Quay lại xếp hạng</button><div class="vault-member-summary"><h4>👤 ${escapeHtml(emp.name)}</h4><p>${escapeHtml(getFactionRole(emp))} · ${escapeHtml(emp.department||'LOW Crew')} · ${escapeHtml(emp.position||'Thành viên')}</p><div class="vault-member-total">💰 ${formatVault(emp.vault||0)}</div></div></div>
    <div class="vault-member-stats"><div class="vault-member-stat"><span>Xếp hạng hiện tại</span><b>🏆 TOP #${rank||'-'}</b></div><div class="vault-member-stat"><span>Tổng lượt ủng hộ</span><b>${logs.length} lần</b></div><div class="vault-member-stat"><span>Ủng hộ gần nhất</span><b>${latest ? escapeHtml(formatContributionTime(latest)) : 'Chưa có'}</b></div></div>
    <div class="vault-section-title">🕒 Lịch sử ủng hộ của ${escapeHtml(emp.name)}</div>
    ${logs.length ? logs.map((x,i)=>`<div class="vault-log"><div><b>Lần ủng hộ #${logs.length-i}</b><div class="meta">${escapeHtml(x.label||'Đóng góp Quỹ Gia Đình')}</div><div class="time">📅 ${escapeHtml(formatContributionTime(x))}</div></div><div class="amount">+${formatVault(x.vault||0)}<span>Số tiền ủng hộ</span></div></div>`).join('') : '<div class="vault-detail-empty">Thành viên này chưa có lịch sử ủng hộ.</div>'}`;
}
function closeVaultModal(){ document.getElementById('vault-overlay')?.classList.remove('show'); }

async function addVault(empId){
  if(!requireAdmin()) return;
  const emp=employees.find(e=>e.id===empId); if(!emp) return;
  const amount=Number(prompt('Nhập số tiền/tài nguyên đóng góp vào Quỹ Gia Đình:','100000'));
  if(!Number.isFinite(amount)||amount<=0){showToast('Giá trị đóng góp không hợp lệ.');return;}
  emp.vault=(emp.vault||0)+Math.round(amount);
  emp.contributionLog.push({id:createEntityId(),date:todayStr(),timestamp:contributionTimestamp(),type:'vault',label:'Cập nhật đóng góp Quỹ Gia Đình',vault:Math.round(amount)});
  await saveEmployees(); showToast(`💰 Đã cập nhật đóng góp của ${emp.name}.`); render();
}
async function addQuickVault(empId,amount){
  if(!requireAdmin()) return;
  const emp=employees.find(e=>e.id===empId); if(!emp) return;
  emp.vault=(emp.vault||0)+Math.round(amount);
  emp.contributionLog.push({id:createEntityId(),date:todayStr(),timestamp:contributionTimestamp(),type:'vault',label:'Cập nhật nhanh đóng góp',vault:Math.round(amount)});
  await saveEmployees(); showToast(`💰 +${formatVault(amount)} cho ${emp.name}`); render();
}
async function applyContribution(empId){
  if(!requireAdmin()) return;
  const emp=employees.find(e=>e.id===empId); if(!emp) return;
  const input=document.getElementById('contrib-amount-'+empId);
  const amount=Number((input?.value||'').replace(/[^0-9.-]/g,''));
  if(!Number.isFinite(amount)||amount<=0){showToast('Hãy nhập số tiền đóng góp hợp lệ.');return;}
  emp.vault=(emp.vault||0)+Math.round(amount);
  emp.contributionLog.push({id:createEntityId(),date:todayStr(),timestamp:contributionTimestamp(),type:'vault',label:'Cập nhật đóng góp thủ công',vault:Math.round(amount)});
  await saveEmployees(); showToast(`✓ Đã lưu cống hiến của ${emp.name}`); render();
}
function renderContributionView(){
  const totalVault=approvedEmployees().reduce((n,e)=>n+(e.vault||0),0);
  const ranked=[...approvedEmployees()].sort((a,b)=>(b.vault||0)-(a.vault||0));
  const top=ranked[0];
  return `
    ${renderMembershipCta('contribution')}
    <section class="contrib-hero">
      
      <h2>⚡ Trung Tâm Cống Hiến</h2>
      <p>Quản lý mức đóng góp của từng thành viên vào Quỹ Gia Đình, cập nhật nhanh ngay trong danh sách và theo dõi bảng xếp hạng cống hiến của LOW.</p>
    </section>
    <div class="contrib-stats">
      <div class="contrib-stat green"><b>${approvedEmployees().length}</b><span>Thành viên Crew</span></div>
      <div class="contrib-stat"><b>${top ? escapeHtml(top.name) : '—'}</b><span>${top ? 'Đóng góp cao nhất: '+formatVault(top.vault||0) : 'Chưa có dữ liệu'}</span></div>
      <div class="contrib-stat red"><b>${formatVault(totalVault)}</b><span>Tổng Quỹ Gia Đình đóng góp</span><button class="vault-view-btn" onclick="openVaultModal()">Xem Tổng Quỹ</button></div>
    </div>
    <section class="contrib-board hall-of-fame">
      <div class="contrib-board-head"><h3>🏆 LOSE OR WIN</h3></div>
      ${ranked.length ? `<div class="podium-wrap">
        ${[1,0,2].map(i=>{
          const e=ranked[i];
          if(!e) return '';
          const logs=[...(e.contributionLog||[])].filter(x=>x.type==='vault');
          const cls=i===0?'podium-first':i===1?'podium-second':'podium-third';
          const medal=i===0?'🥇':i===1?'🥈':'🥉';
          return `<div class="podium-card ${cls}">
            <div class="crown">${i===0?'👑':medal}</div>
            <div class="podium-avatar">${escapeHtml((e.name||'?').trim().charAt(0).toUpperCase())}</div>
            <div class="podium-name">${escapeHtml(e.name)}</div>
            <div class="podium-role">${escapeHtml(getFactionRole(e))}</div>
            <div class="podium-count">${logs.length} lần đóng góp</div>
            <div class="podium-step"><b>#${i+1}</b><span>${i===0?'CHAMPION':i===1?'TOP 2':'TOP 3'}</span></div>
          </div>`;
        }).join('')}
      </div>` : '<div class="podium-empty">Chưa có dữ liệu xếp hạng.</div>'}
    </section>

    <section class="contrib-manage">
      <div class="contrib-manage-head"><div><h3>💰 Danh Sách Cập Nhật Cống Hiến</h3><p>Cập nhật đóng góp nhanh cho từng thành viên.</p></div><span class="badge badge-inactive">CREW VAULT</span></div>
      <div class="contrib-member-list">
      ${ranked.length ? ranked.map((e,index)=>{
        const allLogs=[...(e.contributionLog||[])].filter(x=>x.type==='vault');
        const last=allLogs.length ? allLogs[allLogs.length-1] : null;
        return `<div class="contrib-member-row">
          <div class="contrib-profile">
            <div class="contrib-member-name">#${index+1} · ${escapeHtml(e.name)}</div>
            <div class="contrib-member-meta">${escapeHtml(getFactionRole(e))} · ${escapeHtml(e.position||'Thành viên Crew')}</div>
            <div class="contrib-last">${last ? `Lần ủng hộ gần nhất: <b>${escapeHtml(formatContributionTime(last))}</b> · +${formatVault(last.vault||0)}` : 'Chưa có đóng góp nào'}</div>
          </div>
          <div class="contrib-update-panel">
            <div class="quick-row admin-only"><button class="quick-contrib" onclick="addQuickVault('${e.id}',10000)">+10K</button><button class="quick-contrib" onclick="addQuickVault('${e.id}',50000)">+50K</button><button class="quick-contrib" onclick="addQuickVault('${e.id}',100000)">+100K</button></div>
            <div class="contrib-update-box admin-only"><input id="contrib-amount-${e.id}" type="number" min="1" step="1000" placeholder="Số tiền"><button class="contrib-save" onclick="applyContribution('${e.id}')">Cập nhật</button></div>
          </div>
        </div>`;
      }).join('') : '<div class="empty-state">Chưa có thành viên để cập nhật cống hiến.</div>'}
      </div>
    </section>

`;
}

function renderAttendanceView(){
  if(!isAdmin()){
    const ownMember = approvedEmployees().find(e => e.registeredByUid === currentUser?.uid);
    const ownRequest = getOwnCheckinRequest();
    const statusLabel = ownRequest?.sessionId === checkinSession?.id
      ? (ownRequest.status === 'present' ? 'Đã xác nhận' : ownRequest.status === 'rejected' ? 'Đã từ chối — có thể báo danh lại' : 'Đang chờ xác nhận')
      : 'Chưa báo danh';
    const canSubmit = !!checkinSession?.active && !!ownMember && (!ownRequest || ownRequest.sessionId !== checkinSession.id || ownRequest.status === 'rejected');
    return `
      <div class="attendance-header"><div><div class="attendance-kicker">LOW MEMBER PORTAL</div><h2>ĐIỂM DANH</h2><p>Báo danh cho phiên hoạt động của bạn</p></div></div>
      <div class="attendance-member-card">
        <div class="attendance-member-icon">✓</div><div class="attendance-member-info"><span>THÀNH VIÊN</span><h3>${escapeHtml(ownMember?.name || currentUser?.username || 'Thành viên')}</h3><p>${checkinSession?.active ? `Phiên đang mở · còn <strong data-checkin-countdown>${formatCountdown(checkinRemaining())}</strong>` : 'Chưa có phiên điểm danh đang mở'}</p></div>
        <div class="attendance-member-action"><span class="attendance-status ${ownRequest?.status || 'idle'}">${statusLabel}</span>${canSubmit ? '<button class="btn btn-primary" onclick="submitCheckin()">BÁO DANH NGAY</button>' : ''}${ownRequest?.time && ownRequest.sessionId === checkinSession?.id ? `<small>Gửi lúc ${new Date(ownRequest.time).toLocaleTimeString('vi-VN')}</small>` : ''}</div>
      </div>`;
  }
  const historyQuery = historySearchTerm.trim().toLowerCase();
  const filteredHistory = checkinHistory.filter(h => {
    const ended = true;
    const matchesFilter = historyFilter === 'all' || (historyFilter === 'ended' && ended);
    const matchesDate = !selectedDate || String(h.date || '') === String(selectedDate);
    const haystack = `${h.date || ''} ${h.by || ''}`.toLowerCase();
    return matchesFilter && matchesDate && (!historyQuery || haystack.includes(historyQuery));
  });
  const historyHtml = filteredHistory.length
    ? '<div class="attendance-history-list">' + filteredHistory.map((h, index) => {
        const rate = Math.max(0, Math.min(100, Number(h.rate) || 0));
        const tone = rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'low';
        const id = escapeHtml(String(h.id || `${h.date}-${index}`));
        const details = expandedHistoryId === String(h.id) ? `<div class="attendance-history-details">${Array.isArray(h.requests) && h.requests.length ? h.requests.map(r => `<div><span>${escapeHtml(r.memberName || 'Thành viên')}</span><b class="${r.status || 'pending'}">${r.status === 'present' ? 'Có mặt' : r.status === 'rejected' ? 'Từ chối' : 'Chờ xác nhận'}</b></div>`).join('') : '<span class="attendance-history-empty">Phiên cũ chưa lưu danh sách chi tiết thành viên.</span>'}</div>` : '';
        return `<article class="attendance-history-card">
          <div class="attendance-history-index">${String(index + 1).padStart(2, '0')}</div>
          <div class="attendance-history-main"><div class="attendance-history-date">CUỘC HỌP ĐIỂM DANH</div><div class="attendance-history-meta">▣ ${escapeHtml(formatDateVN(h.date))} · Mở bởi <strong>${escapeHtml(h.by || 'Không rõ')}</strong></div><div class="attendance-history-progress"><i class="${tone}" style="width:${rate}%"></i></div></div>
          <span class="attendance-history-status ended">✓ ĐÃ KẾT THÚC</span><div class="attendance-history-result"><strong>${h.present}/${h.total}</strong><span>có mặt</span></div><div class="attendance-history-rate ${tone}">${rate}%</div>
          <button class="attendance-history-detail-btn" onclick="toggleHistoryDetails('${id}')">${expandedHistoryId === String(h.id) ? 'Thu gọn' : 'Xem chi tiết'} <span>→</span></button>${details}
        </article>`;
      }).join('') + '</div>'
    : '<div class="empty-state">Không tìm thấy phiên phù hợp.</div>';
  const selectedHistory = checkinHistory.filter(h => String(h.date || '') === String(selectedDate || todayStr()));
  const warningMembers = approvedEmployees().map((e) => {
    let streak = 0;
    for (const h of [...selectedHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())) {
      const request = (h.requests || []).find(r => String(r.memberId) === String(e.id));
      if (!request || request.status !== 'present') {
        streak += 1;
      } else {
        break;
      }
    }
    if (streak === 1) return { memberId: e.id, streak, label: 'Cảnh báo nhẹ', level: 'low' };
    if (streak === 2) return { memberId: e.id, streak, label: 'Cảnh báo nặng', level: 'medium' };
    if (streak >= 3) return { memberId: e.id, streak, label: 'Cần xử lý / nhắc nhở chính thức', level: 'high' };
    return { memberId: e.id, streak: 0, label: 'Bình thường', level: 'normal' };
  });

  const statsRows = approvedEmployees().map((e) => {
    const totalSessions = Math.max(1, selectedHistory.length);
    const attendedSessions = selectedHistory.filter(h => (h.requests || []).some(r => String(r.memberId) === String(e.id) && r.status === 'present')).length;
    const rate = Math.min(100, Math.max(0, Math.round((attendedSessions / totalSessions) * 100)));
    const latestHistory = [...selectedHistory].reverse().find(h => (h.requests || []).some(r => String(r.memberId) === String(e.id)));
    const latestRequest = latestHistory ? (latestHistory.requests || []).find(r => String(r.memberId) === String(e.id)) : null;
    const latestText = latestHistory && latestRequest ? `${formatDateVN(latestHistory.date)} (${latestRequest.status === 'present' ? 'Có mặt' : 'Vắng mặt'})` : 'Chưa tham gia';
    const warning = warningMembers.find(w => w.memberId === e.id) || { streak: 0, label: 'Bình thường', level: 'normal' };
    return `
      <tr>
        <td class="stats-name-cell"><span class="stats-avatar">👤</span> ${escapeHtml(e.name)}</td>
        <td>${attendedSessions} / ${totalSessions}</td>
        <td>
          <div class="stats-progress-bar"><span style="width:${rate}%"></span></div>
          <span class="stats-rate-text">${rate}%</span>
        </td>
        <td>${latestText}</td>
        <td><span class="warning-badge ${warning.level}">${warning.streak > 0 ? warning.label : 'Bình thường'}</span></td>
        <td><span class="stats-status ${e.status === 'active' ? 'active' : 'inactive'}">${e.status === 'active' ? 'Theo dõi' : 'Vắng mặt'}</span></td>
      </tr>`;
  }).join('');

  const statsHtml = `
    <div class="stats-summary-grid">
      <div class="stats-summary-card">
        <div class="stats-summary-icon">📄</div>
        <div class="stats-summary-value">${selectedHistory.length}</div>
        <div class="stats-summary-label">Phiên đã lưu</div>
      </div>
      <div class="stats-summary-card">
        <div class="stats-summary-icon">📈</div>
        <div class="stats-summary-value">${selectedHistory.length ? Math.round(selectedHistory.reduce((n,h)=>n+h.rate,0)/selectedHistory.length) : 0}%</div>
        <div class="stats-summary-label">Tỷ lệ chung</div>
      </div>
      <div class="stats-summary-card">
        <div class="stats-summary-icon">👥</div>
        <div class="stats-summary-value">${approvedEmployees().length}</div>
        <div class="stats-summary-label">Tổng thành viên</div>
      </div>
      <div class="stats-summary-card">
        <div class="stats-summary-icon">⚠</div>
        <div class="stats-summary-value">${warningMembers.filter(w => w.streak > 0).length}</div>
        <div class="stats-summary-label">Cảnh báo</div>
      </div>
    </div>
    <section class="stats-panel">
      <div class="stats-panel-head">
        <h3>BẢNG THỐNG KÊ TỶ LỆ CHUYÊN CẦN</h3>
        <label class="stats-search-box"><span>⌕</span><input type="search" placeholder="Tìm tên thành viên..." value="${escapeHtml(attendanceSearchTerm)}" oninput="onAttendanceSearchInput(this.value)"></label>
      </div>
      <div class="stats-table-wrap">
        <table class="stats-table">
          <thead>
            <tr>
              <th>Thành viên</th>
              <th>Phiên dự / Tổng phiên</th>
              <th>Tỷ lệ chuyên cần (%)</th>
              <th>Phiên gần nhất</th>
              <th>Cảnh báo</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>${statsRows || '<tr><td colspan="6" class="empty-state">Chưa có dữ liệu thành viên.</td></tr>'}</tbody>
        </table>
      </div>
    </section>`;
  const membersHtml = '<div class="check-panel"><h3>Danh sách thành viên</h3>' + approvedEmployees().map(e => '<div class="att-row"><div><div class="att-name">' + escapeHtml(e.name) + '</div><div class="att-dept">' + escapeHtml(e.position || e.department || 'Thành viên') + '</div></div><span class="badge">' + (e.status === 'active' ? 'Đang hoạt động' : 'Không hoạt động') + '</span></div>').join('') + '</div>';
  const active = approvedEmployees().filter(e => e.status === 'active');
  const requests = Object.values(checkinRequests).filter(r => r.sessionId === checkinSession?.id);
  const present = requests.filter(r => r.status === 'present').length;
  const pending = requests.filter(r => r.status === 'pending').length;
  const filteredMembers = active.filter(e => {
    if (!attendanceSearchTerm) return true;
    const term = attendanceSearchTerm.toLowerCase();
    return e.name.toLowerCase().includes(term) || (e.position || e.department || '').toLowerCase().includes(term);
  });
  const rows = filteredMembers.map((e, i) => {
    const r = requests.find(x => x.memberId === e.id);
    const label = r?.status === 'present' ? 'Đã xác nhận' : r?.status === 'pending' ? 'Chờ xác nhận' : r?.status === 'rejected' ? 'Đã từ chối' : 'Chưa báo danh';
    const action = r?.status === 'pending'
      ? `<div class="attendance-actions"><button class="table-action confirm" onclick="updateCheckin('${r.uid}','present')">✓ Xác nhận</button><button class="table-action reject" onclick="updateCheckin('${r.uid}','rejected')">✕ Từ chối</button></div>`
      : `<span class="attendance-action-state ${r?.status || 'idle'}">${r?.status === 'present' ? 'Đã xử lý' : r?.status === 'rejected' ? 'Đã từ chối' : 'Đang chờ báo danh'}</span>`;
    return `<tr><td>${i + 1}</td><td><b>${escapeHtml(e.name)}</b><small>${escapeHtml(e.position || e.department || '')}</small></td><td>${r?.time ? new Date(r.time).toLocaleTimeString('vi-VN') : '—'}</td><td><span class="attendance-status ${r?.status || 'idle'}">${label}</span></td><td>${action}</td></tr>`;
  }).join('');
  const scheduledState = checkinSession && !checkinSession.active && checkinSession.scheduledAt ? `
    <div class="attendance-scheduled-box">
      <strong>Đã lên lịch mở lúc ${new Date(checkinSession.scheduledAt).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' })}</strong>
      <span>mở trong <b data-checkin-countdown>${formatCountdown(Math.max(0, Number(checkinSession.scheduledAt) - Date.now()))}</b></span>
    </div>` : '';

  const manage = `
    <div class="attendance-control-grid">
      <div class="attendance-control-card">
        <div class="attendance-card-icon">＋</div>
        <div>
          <h3>Mở phiên họp</h3>
          <p>Tạo mã điểm danh mới cho thành viên</p>
        </div>
        ${checkinSession?.active || checkinSession?.scheduledAt ? `<span class="attendance-open-badge">${checkinSession?.active ? 'ĐANG MỞ' : 'ĐÃ LÊN LỊCH'}</span>` : `<div class="attendance-form-row attendance-schedule-form"><input id="checkin-schedule-date" type="date" value="${selectedDate}" onchange="onDateChange(this.value)"><input id="checkin-schedule-time" type="time" value="09:00"><label class="attendance-duration-label">Phút <input id="checkin-duration" type="number" min="1" max="1440" step="1" value="30" aria-label="Thời lượng phiên tính bằng phút"></label><button class="btn btn-primary" onclick="openCheckinPhase('start')">HẸN MỞ</button></div>`}
      </div>
      <div class="attendance-control-card active">
        <div class="attendance-card-icon">◉</div>
        <div>
          <h3>${checkinSession?.active ? 'Phiên đang hoạt động' : checkinSession?.scheduledAt ? 'Lịch mở phiên' : 'Phiên đang hoạt động'}</h3>
          <p>${checkinSession?.active ? `Mã <strong class="attendance-code">${checkinSession.code}</strong> · còn <span data-checkin-countdown>${formatCountdown(checkinRemaining())}</span>` : checkinSession?.scheduledAt ? `Mở lúc <strong>${new Date(checkinSession.scheduledAt).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' })}</strong> · còn <span data-checkin-countdown>${formatCountdown(Math.max(0, Number(checkinSession.scheduledAt) - Date.now()))}</span>` : 'Chưa có phiên nào đang hoạt động'}</p>
        </div>
        ${checkinSession?.active ? '<button class="btn btn-danger-outline" onclick="closeCheckinSession()">ĐÓNG PHIÊN</button>' : checkinSession?.scheduledAt ? '<button class="btn btn-danger-outline" onclick="cancelScheduledCheckinSession()">HỦY LỊCH</button>' : ''}
      </div>
    </div>
    ${scheduledState}
    <div class="attendance-stats"><div><b>${present}</b><span>CÓ MẶT</span></div><div><b>${pending}</b><span>CHỜ XÁC NHẬN</span></div><div><b>${Math.max(0, active.length - present - pending)}</b><span>CHƯA BÁO DANH</span></div><div><b>${active.length}</b><span>TỔNG</span></div></div>
    <section class="attendance-list-card"><div class="attendance-list-head"><div><h3>DANH SÁCH HÔM NAY</h3><p>${formatDateVN(selectedDate)} · ${filteredMembers.length} thành viên</p></div><div class="attendance-list-tools"><input type="search" placeholder="Tìm thành viên..." value="${attendanceSearchTerm}" oninput="onAttendanceSearchInput(this.value)">${checkinSession?.active ? '<button class="btn btn-primary" onclick="confirmAllCheckins()">XÁC NHẬN TẤT CẢ</button>' : ''}</div></div><div class="table-wrap"><table class="attendance-table"><thead><tr><th>STT</th><th>THÀNH VIÊN</th><th>BÁO LÚC</th><th>TRẠNG THÁI</th><th>THAO TÁC</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty-state">Chưa có thành viên.</td></tr>'}</tbody></table></div></section>`;
  const visibleHistoryCount = filteredHistory.length;
  const historyToolbar = `<div class="attendance-history-toolbar"><div class="attendance-history-count">▣ <strong>${visibleHistoryCount}</strong> cuộc họp đã được ghi nhận</div><div class="attendance-history-filters"><button class="${historyFilter==='all'?'active':''}" onclick="setHistoryFilter('all')">Tất cả</button><button class="${historyFilter==='ended'?'active':''}" onclick="setHistoryFilter('ended')">Đã kết thúc</button><label><input type="search" value="${escapeHtml(historySearchTerm)}" placeholder="Tìm kiếm cuộc họp..." oninput="setHistorySearch(this.value)">⌕</label></div></div>`;
  const topDateInput = attendanceTab === 'manage' ? '' : `<input type="date" class="attendance-date-picker" value="${selectedDate || todayStr()}" onchange="onDateChange(this.value)">`;
  return `<div class="attendance-header"><div><div class="attendance-kicker">QUẢN LÝ THÀNH VIÊN</div><h2>ĐIỂM DANH</h2><p>Mở phiên, theo dõi và xác nhận điểm danh theo thời gian thực</p></div>${topDateInput}</div><div class="att-tabs"><button class="btn ${attendanceTab==='manage'?'btn-primary':'btn-ghost'}" onclick="attendanceTab='manage';render()">Quản lý phiên</button><button class="btn ${attendanceTab==='history'?'btn-primary':'btn-ghost'}" onclick="attendanceTab='history';render()">Lịch sử</button><button class="btn ${attendanceTab==='stats'?'btn-primary':'btn-ghost'}" onclick="attendanceTab='stats';render()">Thống kê</button></div>${attendanceTab==='manage' ? manage : attendanceTab==='history' ? `<section class="attendance-history-section"><div class="attendance-section-heading"><div><h3>LỊCH SỬ CUỘC HỌP</h3><p>Theo dõi và xem lại các cuộc họp thành viên trong clan</p></div><span class="attendance-section-icon">▣</span></div>${historyToolbar}${historyHtml}</section>` : statsHtml}`;
}

function renderScarsView(){
  const official = approvedEmployees();
  const totalScars = official.reduce((s,e) => s + (e.scars||0), 0);
  const suspendedCount = official.filter(e => e.scars >= MAX_SCARS).length;
  const cleanCount = official.filter(e => !(e.scars||0)).length;
  // Chỉ đưa người đã đủ 3 sẹo vào khu vực cần xử lý.
  const needHandling = official
    .filter(e => (e.scars||0) >= MAX_SCARS)
    .sort((a,b)=>(b.scars||0)-(a.scars||0));
  return `
    <div class="topbar"><div><h2>Trung Tâm Cảnh Báo & Sẹo</h2><p class="sub">Theo dõi sẹo và xử lý ngay thành viên đạt mốc 3 sẹo</p></div></div>
    <div class="check-grid">
      <div class="check-card"><b>${official.length}</b><span>Tổng thành viên</span></div>
      <div class="check-card"><b>${round1(totalScars)}</b><span>Tổng sẹo hiện tại</span></div>
      <div class="check-card danger"><b>${suspendedCount}</b><span>Đủ 3 sẹo – cần xử lý</span></div>
    </div>
    <div class="check-panel"><div class="check-panel-head"><h3>🚨 Danh Sách Chờ Xử Lý</h3><span class="badge ${suspendedCount ? 'badge-inactive' : 'badge-active'}">${suspendedCount ? suspendedCount + ' cần xử lý' : cleanCount + ' thành viên sạch sẹo'}</span></div>
      ${needHandling.length ? needHandling.map((e,i)=>`<div class="risk-row"><div class="risk-person"><b>#${i+1} ${escapeHtml(e.name)} <span class="scar-level suspend">CẦN XỬ LÝ</span></b><span>${escapeHtml(e.position||'—')} · ${escapeHtml(e.department||'—')}</span></div><div class="risk-meta"><b style="color:#ff8a80">${e.scars||0} / ${MAX_SCARS} sẹo</b><br>${(e.violations||[]).length} lần ghi nhận</div></div>`).join(''):'<div class="empty-state">✓ Hiện chưa có thành viên nào đạt mốc 3 sẹo cần xử lý.</div>'}
    </div>
    <div class="filters"><input type="text" placeholder="Tìm Theo Tên Hoặc Chức Vụ…" value="${escapeHtml(scarSearchTerm)}" oninput="onScarSearchInput(this.value)"></div>
    ${scarsListHtml()}
  `;
}
function scarsListHtml(){
  const term = scarSearchTerm.toLowerCase();
  const sorted = [...approvedEmployees()]
    .filter(e => !term || e.name.toLowerCase().includes(term) || (e.position||'').toLowerCase().includes(term) || (e.department||'').toLowerCase().includes(term))
    .sort((a,b) => (b.scars||0) - (a.scars||0));

  return `<div id="scars-list-slot">${
    sorted.length === 0 ? '<p class="empty-state">Không tìm thấy thành viên phù hợp.</p>' : sorted.map(e => {
      const level = scarLevel(e.scars || 0);
      const isOpen = !!openHistoryDates['scar_' + e.id];
      const history = [...(e.violations||[])].sort((a,b) => b.id.localeCompare(a.id));
      return `
        <div class="scar-card ${e.scars >= MAX_SCARS ? 'suspended' : ''}">
          <div style="flex:1; min-width:0;">
            <div class="who">
              <b>${escapeHtml(e.name)} <span class="scar-level ${level.key}">${level.label}</span></b>
              <span>${escapeHtml(e.position || '—')} · ${escapeHtml(e.department || '—')} · ${e.scars || 0} sẹo (tối đa ${MAX_SCARS})</span>
            </div>
            ${history.length > 0 ? `
              <div class="scar-history-toggle" style="margin-top:8px; font-size:12px; color:var(--accent-2); cursor:pointer;" onclick="toggleHistoryDate('scar_${e.id}')">
                ${isOpen ? '▲ Ẩn lịch sử vi phạm' : `▼ Xem lịch sử vi phạm (${history.length})`}
              </div>
              ${isOpen ? `
                <div class="scar-history">
                  ${history.map(v => `
                    <div class="line">
                      <b>${escapeHtml(formatDateVN(v.date))} — ${escapeHtml(v.label)}${v.note ? ' ('+escapeHtml(v.note)+')' : ''}</b>
                      <span style="display:flex; align-items:center; gap:8px;">
                        ${v.amount > 0 ? '+' : ''}${v.amount} sẹo
                        ${v.amount > 0 ? `<button class="icon-btn danger admin-only" style="padding:2px 8px; font-size:11px;" onclick="removeViolation('${e.id}','${v.id}')" title="Xoá vi phạm này">✕</button>` : ''}
                      </span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            ` : ''}
          </div>
          <div class="scar-actions">
            <button class="icon-btn warn admin-only" onclick="openViolationModal('${e.id}','manual')">🩹 Thêm Vi Phạm</button>
            <button class="icon-btn danger admin-only" onclick="clearAllScars('${e.id}')" ${e.scars > 0 ? '' : 'disabled style="opacity:.4;cursor:not-allowed;"'}>🗑️ Xoá Tất Cả</button>
          </div>
        </div>
      `;
    }).join('')
  }</div>`;
}

function renderAboutView(){
  const photos = [
    { src: ABOUT_PHOTOS[0], cap: 'Chuyến đi cùng anh em LOW' },
    { src: ABOUT_PHOTOS[1], cap: 'Sinh nhật đại gia đình LOW' },
    { src: ABOUT_PHOTOS[2], cap: 'Kỷ niệm cùng nhau lớn mạnh' },
  ];
  return `
    ${renderMembershipCta('about')}
    <div class="about-hero">
      <div class="tagline">Lose Or Win</div>
      <h2>Giới Thiệu LOW</h2>
      <p>LOW (Lose Or Win) là một cộng đồng gắn kết bởi tinh thần đồng đội, nơi mỗi thành viên
      đều xem nhau như anh em một nhà. Không quan trọng thắng hay thua, điều giữ chân mọi người
      ở lại là những chuyến đi, những bữa tiệc, và những kỷ niệm đã cùng nhau xây dựng qua từng năm.</p>
      <div class="about-stats">
        <div class="stat"><b>${approvedEmployees().length}</b><span>Thành Viên</span></div>
        <div class="stat"><b>6</b><span>Năm Đồng Hành</span></div>
        <div class="stat"><b>∞</b><span>Kỷ Niệm</span></div>
      </div>
    </div>
    <div class="about-gallery">
      ${photos.map(p => `
        <div class="about-photo" onclick="openLightbox('${p.src}')">
          <img src="${p.src}" alt="${p.cap}" loading="lazy">
          <span class="cap">${p.cap}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMembershipCta(view){
  if(isAdmin() || (hasApprovedMembership() && !currentUser?.membershipRevoked)) return '';
  if(currentUser?.membershipRevoked) return `
    <section class="membership-cta" aria-label="Đăng ký lại thành viên LOW">
      <div><div class="membership-cta-kicker">Hồ sơ thành viên</div><h3>Hồ sơ cũ đã được hủy</h3><p>Bạn có thể gửi lại hồ sơ đăng ký thành viên để Chủ Gia Đình xét duyệt.</p></div>
      <button class="btn btn-primary" type="button" onclick="openModal()">+ Đăng ký thành viên</button>
    </section>`;
  if(hasPendingRegistration()) return `
    <section class="membership-cta" aria-label="Trạng thái đăng ký thành viên">
      <div><div class="membership-cta-kicker">Hồ sơ thành viên</div><h3>Đăng ký của bạn đang được xem xét</h3><p>Trong lúc chờ Chủ Gia Đình duyệt hồ sơ, bạn vẫn có thể tìm hiểu về LOW và theo dõi tinh thần cống hiến của anh em.</p><div class="membership-status">Đang chờ xét duyệt</div></div>
      <button class="btn btn-ghost" type="button" onclick="setView('member-pending')">Xem hồ sơ</button>
    </section>`;
  const destination = view === 'about' ? 'Giới thiệu' : 'Cống hiến';
  return `
    <section class="membership-cta" aria-label="Đăng ký thành viên LOW">
      <div><div class="membership-cta-kicker">Tham gia cùng LOW</div><h3>Sẵn sàng trở thành một phần của anh em?</h3><p>Bạn đang xem ${destination.toLowerCase()}. Hoàn tất hồ sơ để được ghi nhận chính thức, tham gia hoạt động và cùng xây dựng những dấu mốc mới cho LOW.</p></div>
      <button class="btn btn-primary" type="button" onclick="openModal()">+ Đăng ký thành viên</button>
    </section>`;
}

function openLightbox(src){
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-overlay').classList.add('show');
}
function closeLightbox(){ document.getElementById('lightbox-overlay').classList.remove('show'); }

function render(){
  if(isAdmin() && currentView === 'pending' && !employees.some(e => e.registrationStatus === 'pending')){
    currentView = 'list';
    if(appHistoryInitialized) history.replaceState({ ...(history.state || {}), lowPortal:true, view:'list' }, '', location.href);
  }
  if(!canAccessView(currentView)) currentView = isOwner() || hasApprovedMembership() ? 'list' : getMemberFallbackView();
  const app = document.getElementById('app');
  app.classList.add('dashboard-3d');
  app.innerHTML = `
    <nav class="sidebar">
      <h1>LOSE OR WIN</h1>
      <img src="assets/logo.png" decoding="async" alt="LOSE OR WIN Logo" class="sidebar-logo">
      ${canAccessView('list') ? `<button class="nav-btn ${currentView==='list'?'active':''}" onclick="setView('list')">Danh Sách Thành Viên</button>` : ''}
      ${!isAdmin() && hasPendingRegistration() ? `<button class="nav-btn ${currentView==='member-pending'?'active':''}" onclick="setView('member-pending')">Đợi Xét Duyệt<span class="notification-badge">!</span></button>` : ''}
      ${canAccessView('attendance') ? `<button class="nav-btn ${currentView==='attendance'?'active':''}" onclick="setView('attendance')">Điểm Danh</button>` : ''}
      ${canAccessView('scars') ? `<button class="nav-btn ${currentView==='scars'?'active':''}" onclick="setView('scars')">Bảng Sẹo</button>` : ''}
      <button class="nav-btn ${currentView==='contribution'?'active':''}" onclick="setView('contribution')">Cống Hiến</button>
      <button class="nav-btn ${currentView==='about'?'active':''}" onclick="setView('about')">Giới Thiệu LOW</button>
      <div class="sidebar-user">
        <div class="user-summary">
          <div class="user-avatar" id="sidebar-avatar"></div>
          <div class="who">
            <b>${currentUser ? escapeHtml(currentUser.username) : ''}</b>
            ${currentUser ? `<span class="role-tag ${getCurrentUserRoleClass()}">${escapeHtml(getCurrentUserRoleLabel())}</span>` : ''}
          </div>
          <button class="gear-btn" type="button" onclick="openProfileModal()" title="Cài đặt tài khoản / Profile">⚙️</button>
        </div>
      </div>
    </nav>
    <main>
      ${currentUser?.membershipNotice?.type === 'revoked' ? `<div class="membership-removal-overlay" role="alertdialog" aria-modal="true"><div class="membership-removal-alert"><div><strong>Bạn đã bị hủy khỏi LOSE OR WIN</strong><p>Quyền thành viên của bạn đã được Chủ Gia Đình hủy. Bạn vẫn có thể xem phần Giới thiệu và Cống hiến.</p></div><button class="btn btn-ghost" type="button" onclick="acknowledgeMembershipNotice()">Đã hiểu</button></div></div>` : ''}
      ${currentUser?.membershipNotice?.type === 'checkin-opened' ? `<div class="membership-removal-overlay" role="alertdialog" aria-modal="true"><div class="membership-removal-alert"><div><strong>Đã mở phiên điểm danh</strong><p>${escapeHtml(currentUser.membershipNotice.message || 'Chủ Gia Đình đã mở phiên điểm danh. Vui lòng báo danh ngay.')}</p></div><button class="btn btn-primary" type="button" onclick="acknowledgeCheckinNotice()">Báo danh ngay</button></div></div>` : ''}
      ${currentView === 'list' ? renderListView() : currentView === 'pending' ? renderPendingView() : currentView === 'member-pending' ? renderMemberPendingView() : currentView === 'attendance' ? renderAttendanceView() : currentView === 'scars' ? renderScarsView() : currentView === 'contribution' ? renderContributionView() : renderAboutView()}
    </main>
  `;
  if(!app.dataset.dashboardParallaxBound){
    app.dataset.dashboardParallaxBound = 'true';
    applyGlobalParallax();
  }
}
