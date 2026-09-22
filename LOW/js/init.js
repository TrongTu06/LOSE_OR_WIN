function populateStaticSelects(){
  const opts = DEPARTMENTS.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  document.getElementById('f-position').innerHTML = opts;
}

async function enterPortal(){
  document.getElementById('landing-overlay').style.display = 'none';
  const hasSession = await loadSession();
  if(hasSession){
    await enterApp();
  }else{
    document.getElementById('auth-overlay').classList.remove('hide');
  }
}

function startLandingCursorEffect(){
  const overlay = document.getElementById('landing-overlay');
  const glow = document.getElementById('landing-cursor-glow');
  const content = document.querySelector('.landing-content');
  const cube = document.querySelector('.logo-cube');
  if(!overlay || !glow || !content || !window.matchMedia('(pointer:fine)').matches) return;
  let frame = 0;

  overlay.addEventListener('pointermove', ev => {
    const rect = overlay.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const localX = (x / rect.width) - 0.5;
    const localY = (y / rect.height) - 0.5;
    const rotateY = localX * 22;
    const rotateX = (0.5 - localY) * 18;
    const driftY = localY * 20;

    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      glow.style.left = `${x}px`;
      glow.style.top = `${y}px`;
      content.style.transform = `perspective(1600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(${driftY * -0.4}px)`;
      content.style.boxShadow = '0 28px 70px -30px rgba(216,42,58,0.8), 0 0 34px rgba(35,126,160,0.12)';
      content.style.transition = 'transform 0.18s ease, box-shadow 0.2s ease';
      if(cube){
        cube.style.transform = `rotateX(${rotateX * 1.3}deg) rotateY(${rotateY * 1.4}deg) rotateZ(${rotateY * 0.5}deg) translateY(${driftY * 0.5}px)`;
      }
    });
    overlay.classList.add('cursor-active');
  });

  overlay.addEventListener('pointerleave', () => {
    overlay.classList.remove('cursor-active');
    content.style.transform = 'perspective(1600px) rotateX(0deg) rotateY(0deg) translateY(0)';
    content.style.boxShadow = 'none';
    if(cube){ cube.style.transform = 'rotateX(0deg) rotateY(0deg) rotateZ(0deg) translateY(0)'; }
  });

  const onScroll = () => {
    const scrolled = window.scrollY * 0.12;
    if (content) {
      content.style.transform = `perspective(1600px) rotateX(${Math.min(12, scrolled * 0.08)}deg) rotateY(${Math.min(8, scrolled * 0.05)}deg) translateY(${Math.min(20, scrolled * -0.08)}px)`;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function applyGlobalParallax(){
  const root = document.documentElement;
  const app = document.getElementById('app');
  if(!root || !app) return;

  const move = (ev) => {
    const rect = app.getBoundingClientRect();
    const px = rect.width ? ((ev.clientX - rect.left) / rect.width) * 100 : 50;
    const py = rect.height ? ((ev.clientY - rect.top) / rect.height) * 100 : 50;
    root.style.setProperty('--pointer-x', `${px}%`);
    root.style.setProperty('--pointer-y', `${py}%`);
    root.style.setProperty('--tilt-x', `${(50 - py) / 4}deg`);
    root.style.setProperty('--tilt-y', `${(px - 50) / 4}deg`);
  };

  app.addEventListener('pointermove', move, { passive: true });
  app.addEventListener('pointerleave', () => {
    root.style.setProperty('--pointer-x', '50%');
    root.style.setProperty('--pointer-y', '50%');
    root.style.setProperty('--tilt-x', '0deg');
    root.style.setProperty('--tilt-y', '0deg');
  }, { passive: true });

  const scrollParallax = () => {
    const shift = window.scrollY * 0.14;
    root.style.setProperty('--scroll-shift', `${shift}px`);
  };

  window.addEventListener('scroll', scrollParallax, { passive: true });
  scrollParallax();
}

/* =========================================================
   NÂNG CẤP DỮ LIỆU CŨ — chạy 1 lần duy nhất
   Các tài khoản đăng ký trước bản này chưa có low-roles và
   low-username-index. Đăng nhập bằng Chủ Bang, mở Console (F12)
   và gõ:  migrateIndexes()
========================================================= */
async function migrateIndexes(){
  if(!isOwner()){ console.warn('Cần đăng nhập bằng tài khoản Chủ Bang.'); return; }
  const db = await getUsersDb();
  let done = 0;
  for(const [name, rec] of Object.entries(db)){
    if(!rec || !rec.uid) { console.warn('Bỏ qua (thiếu uid):', name); continue; }
    try{
      await firebaseStorageSet(`${KEY_ROLES}/${rec.uid}`, JSON.stringify(rec.role || 'member'));
      if(rec.email) await firebaseStorageSet(`${KEY_UINDEX}/${usernameKey(name)}`, JSON.stringify(String(rec.email).toLowerCase()));
      done++;
    }catch(e){ console.error('Lỗi ở', name, e.message); }
  }
  console.log(`Đã nâng cấp ${done}/${Object.keys(db).length} tài khoản.`);
  showToast(`Đã nâng cấp chỉ mục cho ${done} tài khoản.`);
}
window.migrateIndexes = migrateIndexes;

(async function init(){
  render();
  if(handlePasswordResetReturn()) return;
  if(handleEmailVerificationReturn()) return;
  document.getElementById('landing-overlay').style.display = 'flex';
  startLandingCursorEffect();
})();
