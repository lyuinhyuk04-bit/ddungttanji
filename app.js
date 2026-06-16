/* ==========================================================================
   app.js  —  Dduntanzy Crew Schedule Board  (multi-member)
   data.js 가 window.APP_CONFIG / window.APP_SCHEDULE 으로 데이터 주입.
   fetch() 없이 file:// 에서도 동작.
   ========================================================================== */

// ── State ─────────────────────────────────────────────────────────────────────
let appConfig       = null;
let rawSchedules    = [];          // 전체 멤버 일정 배열
let activeMember    = null;        // 현재 선택된 멤버 key
let currentWeekStart = null;       // Date: 보고 있는 주의 월요일
let isAdminMode     = false;       // 관리자 모드 활성화 여부
let isDirty         = false;       // 수정사항 저장 여부

// ── DOM refs ──────────────────────────────────────────────────────────────────
const sidebar              = document.getElementById('sidebar');
const menuToggleBtn        = document.getElementById('menuToggleBtn');
const sidebarCloseBtn      = document.getElementById('sidebarCloseBtn');
const crewLinksContainer   = document.getElementById('crewLinksContainer');
const membersListContainer = document.getElementById('membersListContainer');
const activeMemberProfile  = document.getElementById('activeMemberProfile');
const searchInput          = document.getElementById('searchInput');
const liveStatusSection    = document.getElementById('liveStatusSection');
const liveGridContainer    = document.getElementById('liveGridContainer');
const liveRefreshBtn       = document.getElementById('liveRefreshBtn');
const liveRefreshText      = document.getElementById('liveRefreshText');

// Admin & Modal DOM refs
const adminModeToggle      = document.getElementById('adminModeToggle');
const scheduleModal        = document.getElementById('scheduleModal');
const scheduleForm         = document.getElementById('scheduleForm');
const modalCloseBtn        = document.getElementById('modalCloseBtn');
const editIndex            = document.getElementById('editIndex');
const editOrigDate         = document.getElementById('editOrigDate');
const editDate             = document.getElementById('editDate');
const editTime             = document.getElementById('editTime');
const editTitle            = document.getElementById('editTitle');
const editNote             = document.getElementById('editNote');
const editLock             = document.getElementById('editLock');
const deleteBtn            = document.getElementById('deleteBtn');
const floatingSaveAction   = document.getElementById('floatingSaveAction');
const floatingSaveBtn      = document.getElementById('floatingSaveBtn');
const clearSearchBtn       = document.getElementById('clearSearchBtn');
const prevWeekBtn          = document.getElementById('prevWeekBtn');
const nextWeekBtn          = document.getElementById('nextWeekBtn');
const todayBtn             = document.getElementById('todayBtn');
const currentWeekLabel     = document.getElementById('currentWeekLabel');
const weeklyGridContainer  = document.getElementById('weeklyGridContainer');
const scheduleViewSection  = document.getElementById('scheduleViewSection');
const searchResultsSection = document.getElementById('searchResultsSection');
const searchResultsList    = document.getElementById('searchResultsList');
const searchCount          = document.getElementById('searchCount');
const backToWeekBtn        = document.getElementById('backToWeekBtn');

// Mobile overlay
const sidebarOverlay = document.createElement('div');
sidebarOverlay.className = 'sidebar-overlay';
document.body.appendChild(sidebarOverlay);

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!window.APP_CONFIG || !window.APP_SCHEDULE) {
    weeklyGridContainer.innerHTML = `
      <div class="loading-container" style="grid-column:span 7">
        <p style="color:var(--accent-pink);font-size:15px;">⚠️ data.js 파일을 찾을 수 없습니다.</p>
        <p style="color:var(--color-text-muted);font-size:12px;">
          먼저 <code style="background:var(--bg-tertiary);padding:2px 6px;border-radius:4px;">
          python sync_schedule.py</code> 를 실행해 주세요.
        </p>
      </div>`;
    return;
  }

  appConfig    = window.APP_CONFIG;
  rawSchedules = window.APP_SCHEDULE;
  activeMember = appConfig.defaultMember;

  setupEventListeners();
  renderCrewLinks();
  renderMembersList();
  renderActiveMemberProfile();
  setWeekStartToDate(new Date());
  renderWeeklySchedule();
  fetchLiveStatus();
});

// ── Event listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  menuToggleBtn.addEventListener('click', () => {
    sidebar.classList.add('open');
    sidebarOverlay.classList.add('active');
  });
  const closeSidebar = () => {
    sidebar.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  };
  sidebarCloseBtn.addEventListener('click', closeSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  prevWeekBtn.addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    renderWeeklySchedule();
  });
  nextWeekBtn.addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    renderWeeklySchedule();
  });
  todayBtn.addEventListener('click', () => {
    setWeekStartToDate(new Date());
    renderWeeklySchedule();
  });

  searchInput.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    clearSearchBtn.style.display = q ? 'block' : 'none';
    q ? performSearch(q) : showScheduleView();
  });
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    showScheduleView();
  });
  backToWeekBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    showScheduleView();
  });

  // Admin Event Listeners
  if (adminModeToggle) {
    adminModeToggle.addEventListener('change', e => {
      isAdminMode = e.target.checked;
      if (isAdminMode) {
        document.body.classList.add('admin-mode-active');
      } else {
        document.body.classList.remove('admin-mode-active');
      }
      renderWeeklySchedule();
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }
  if (scheduleModal) {
    scheduleModal.addEventListener('click', e => {
      if (e.target === scheduleModal) closeModal();
    });
  }
  if (scheduleForm) {
    scheduleForm.addEventListener('submit', handleFormSubmit);
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', handleDeleteClick);
  }
  if (floatingSaveBtn) {
    floatingSaveBtn.addEventListener('click', saveToServer);
  }
  if (liveRefreshBtn) {
    liveRefreshBtn.addEventListener('click', fetchLiveStatus);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDisplayTime(timeStr) {
  if (!timeStr || timeStr === '미정') {
    return `<span style="color:var(--color-text-muted)">시간 미정</span>`;
  }
  
  // 1. If it's in HH:MM format
  const hhmmMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    let h = parseInt(hhmmMatch[1], 10);
    const m = parseInt(hhmmMatch[2], 10);
    
    let ampm = '오후';
    if (h < 12) {
      ampm = '오전';
    } else if (h === 12) {
      ampm = '오후';
    } else if (h === 24 || h === 0) {
      ampm = '오전';
      h = 12;
    }
    
    let displayHour = h;
    if (h > 12) {
      displayHour = h - 12;
    } else if (h === 0) {
      displayHour = 12;
    }
    
    if (m > 0) {
      return `${ampm} ${displayHour}시 ${m}분`;
    } else {
      return `${ampm} ${displayHour}시`;
    }
  }
  
  // 2. If it's already a Korean string containing 오전/오후/새벽/밤/낮
  if (timeStr.includes('오전') || timeStr.includes('오후') || timeStr.includes('새벽') || timeStr.includes('밤') || timeStr.includes('낮')) {
    return timeStr.replace(/시\s*분/, '시 분').trim();
  }
  
  // 3. If it is just digits followed by "시" (e.g. "12시", "5시")
  const siMatch = timeStr.match(/^(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?$/);
  if (siMatch) {
    let h = parseInt(siMatch[1], 10);
    const m = siMatch[2] ? parseInt(siMatch[2], 10) : 0;
    
    let ampm = '오후';
    if (h < 12) {
      ampm = '오후'; // standard streams default to PM
    } else if (h === 12) {
      ampm = '오후';
    } else {
      if (h >= 12) {
        ampm = '오후';
        h = h > 12 ? h - 12 : h;
      } else {
        ampm = '오전';
      }
    }
    
    if (m > 0) {
      return `${ampm} ${h}시 ${m}분`;
    } else {
      return `${ampm} ${h}시`;
    }
  }
  
  return timeStr;
}

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setWeekStartToDate(target) {
  const d   = new Date(target);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  currentWeekStart = new Date(d.setDate(diff));
  currentWeekStart.setHours(0, 0, 0, 0);
}

/** 현재 활성 멤버의 일정만 필터링 */
function getMemberSchedules() {
  return rawSchedules.filter(s => s.member === activeMember);
}

// ── Sidebar renders ───────────────────────────────────────────────────────────
function renderCrewLinks() {
  const L = appConfig.crewLinks;
  const links = [
    { key:'youtube', name:'YouTube',     desc:'뚱딴지 공식 유튜브', icon:'fa-brands fa-youtube',     url: L.youtube },
    { key:'cafe',    name:'네이버 카페', desc:'뚱딴지 팬카페',       icon:'fa-solid fa-mug-hot',       url: L.cafe    },
    { key:'sheet',   name:'구글 시트',   desc:'크루 공용 일정표',    icon:'fa-solid fa-table-columns', url: L.sheet   },
  ];
  crewLinksContainer.innerHTML = links.map(l => `
    <a href="${l.url}" target="_blank" class="crew-link-card">
      <div class="crew-link-icon ${l.key}"><i class="${l.icon}"></i></div>
      <div class="crew-link-info">
        <h3>${l.name}</h3><p>${l.desc}</p>
      </div>
    </a>`).join('');
}

function renderMembersList() {
  membersListContainer.innerHTML = Object.entries(appConfig.members)
    .map(([key, m]) => `
      <div class="member-item ${key === activeMember ? 'active' : ''}"
           onclick="selectMember('${key}')">
        <div class="member-info-wrapper">
          <div class="member-avatar">
            ${m.avatar 
              ? `<img src="${m.avatar}" alt="${m.name}" class="member-avatar-img">`
              : m.emoji}
          </div>
          <span class="member-name-text">${m.name}</span>
        </div>
        ${key === activeMember ? '<div class="active-dot"></div>' : ''}
      </div>`).join('');
}

function selectMember(key) {
  activeMember = key;
  renderMembersList();
  renderActiveMemberProfile();
  renderWeeklySchedule();
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

function renderActiveMemberProfile() {
  const m = appConfig.members[activeMember];
  // Use the first board URL as the primary link
  const primaryBoard = (m.soopBoards && m.soopBoards[0]) || '#';
  activeMemberProfile.innerHTML = `
    ${m.avatar 
      ? `<img src="${m.avatar}" alt="${m.name}" class="active-member-avatar-img">`
      : `<div class="active-member-emoji">${m.emoji}</div>`}
    <div class="active-member-details">
      <h2>${m.name} 일정표</h2>
      <p>
        <a href="${primaryBoard}" target="_blank">
          <i class="fa-solid fa-square-rss" style="color:var(--accent-blue);margin-right:4px;"></i>
          SOOP 방송국 공지 바로가기
        </a>
      </p>
    </div>`;
}

// ── Weekly grid ───────────────────────────────────────────────────────────────
function renderWeeklySchedule() {
  if (!currentWeekStart) return;

  const year  = currentWeekStart.getFullYear();
  const month = currentWeekStart.getMonth() + 1;
  const weekEnd = new Date(currentWeekStart);
  weekEnd.setDate(currentWeekStart.getDate() + 6);

  const weekOfMonth = Math.ceil(currentWeekStart.getDate() / 7);
  const ordKor = ['첫','두','세','네','다섯'];
  const ordLabel = (ordKor[weekOfMonth - 1] ?? weekOfMonth) + '번째주';
  const endMonth = weekEnd.getMonth() + 1;
  const rangeLabel = endMonth !== month
    ? `${month}월 ${currentWeekStart.getDate()}일 ~ ${endMonth}월 ${weekEnd.getDate()}일`
    : `${month}월 ${currentWeekStart.getDate()}일 ~ ${weekEnd.getDate()}일`;

  currentWeekLabel.textContent = `${year}년 ${ordLabel} · ${rangeLabel}`;

  const TODAY_STR  = formatDateISO(new Date());
  const DAY_NAMES  = ['월','화','수','목','금','토','일'];
  const memberScheds = getMemberSchedules();

  weeklyGridContainer.innerHTML = DAY_NAMES.map((dayName, idx) => {
    const dateObj = new Date(currentWeekStart);
    dateObj.setDate(currentWeekStart.getDate() + idx);
    const dateStr = formatDateISO(dateObj);
    const isToday = dateStr === TODAY_STR;

    // Filter & sort
    const dayScheds = memberScheds
      .filter(s => s.date === dateStr)
      .sort((a, b) => {
        const aC = a.title.startsWith('[크루]'), bC = b.title.startsWith('[크루]');
        if (aC && !bC) return 1; if (!aC && bC) return -1;
        if (a.time === '미정' && b.time !== '미정') return 1;
        if (a.time !== '미정' && b.time === '미정') return -1;
        return a.time.localeCompare(b.time);
      });

    let schedulesHtml = `
      <div class="empty-day">
        <i class="fa-regular fa-calendar-xmark"></i>
        <p>방송 일정 없음</p>
      </div>`;

    if (dayScheds.length > 0) {
      schedulesHtml = dayScheds.map(s => {
        const isCrew       = s.title.startsWith('[크루]');
        const rawTitle     = isCrew ? s.title.replace('[크루]','').trim() : s.title;
        const displayTitle = rawTitle.replace(/\.\.\.$/,'').trim();
        const timeDisplay = formatDisplayTime(s.time);

        const sourceLinkHtml = s.url
          ? `<a href="${s.url}" target="_blank" class="schedule-source"><i class="fa-solid fa-link"></i> 본문 링크</a>`
          : '';

        const globalIdx = rawSchedules.indexOf(s);
        const adminActionsHtml = isAdminMode
          ? `<div class="schedule-card-actions">
               <button class="btn-card-edit" onclick="window.openEditModal(event, ${globalIdx})" title="수정">
                 <i class="fa-solid fa-pencil"></i>
               </button>
               <button class="btn-card-delete" onclick="window.deleteScheduleDirect(event, ${globalIdx})" title="삭제">
                 <i class="fa-solid fa-trash"></i>
               </button>
             </div>`
          : '';

        return `
          <div class="schedule-card${isCrew ? ' crew-event' : ''}">
            <div class="schedule-time"><i class="fa-regular fa-clock"></i> ${timeDisplay}</div>
            <div class="schedule-title">
              ${isCrew ? '<span class="crew-tag">[크루]</span> ' : ''}${displayTitle}
            </div>
            ${sourceLinkHtml}
            ${adminActionsHtml}
          </div>`;
      }).join('');
    }

    const headerHtml = isAdminMode
      ? `<div class="day-header-admin">
           <div class="day-header-left">
             <span class="day-date">${dateObj.getDate()}</span>
             <span class="day-name">${dayName}요일</span>
           </div>
           <button class="btn-add-schedule" onclick="window.openAddModal('${dateStr}')" title="일정 추가">
             <i class="fa-solid fa-plus"></i>
           </button>
         </div>`
      : `<div class="day-header">
           <span class="day-date">${dateObj.getDate()}</span>
           <span class="day-name">${dayName}요일</span>
         </div>`;

    return `
      <div class="day-card ${isToday ? 'today' : ''}" data-day="${dayName}">
        ${headerHtml}
        <div class="schedules-container">${schedulesHtml}</div>
      </div>`;
  }).join('');
}

// ── Search ────────────────────────────────────────────────────────────────────
function performSearch(query) {
  scheduleViewSection.classList.add('hidden');
  if (liveStatusSection) liveStatusSection.classList.add('hidden');
  searchResultsSection.classList.remove('hidden');

  // Search within the active member's schedules only
  const memberScheds = getMemberSchedules();
  const results = memberScheds.filter(s =>
    s.date.includes(query) ||
    s.title.toLowerCase().includes(query) ||
    (s.note || '').toLowerCase().includes(query) ||
    s.day.includes(query)
  );

  searchCount.textContent = `${results.length}건`;

  if (results.length === 0) {
    searchResultsList.innerHTML = `
      <div class="loading-container">
        <i class="fa-regular fa-folder-open" style="font-size:32px;color:var(--color-text-muted)"></i>
        <p>검색 결과가 없습니다.</p>
      </div>`;
    return;
  }

  const MON_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN',
                    'JUL','AUG','SEP','OCT','NOV','DEC'];

  searchResultsList.innerHTML = results.map(s => {
    const d        = new Date(s.date);
    const isCrew   = s.title.startsWith('[크루]');
    const dispTitle= isCrew ? s.title.replace('[크루]','').trim() : s.title;
    const srcTag   = s.source === 'soop'
      ? `<span style="color:var(--accent-purple);font-size:10px">
           <i class="fa-solid fa-square-rss"></i> SOOP
         </span>`
      : `<span style="color:var(--accent-green);font-size:10px">
           <i class="fa-regular fa-table-cells"></i> 시트
         </span>`;

    return `
      <div class="search-result-item" onclick="jumpToDate('${s.date}')">
        <div class="search-result-left">
          <div class="search-result-date-badge">
            <span class="search-result-month">${MON_ABBR[d.getMonth()]}</span>
            <span class="search-result-day-num">${d.getDate()}</span>
          </div>
          <div class="search-result-info">
            <div class="search-result-meta">
              <span class="search-result-day-name">${s.day}요일</span>
              <span class="search-result-time">
                <i class="fa-regular fa-clock"></i> ${formatDisplayTime(s.time)}
              </span>
            </div>
            <div class="search-result-title">
              ${isCrew ? '<span class="crew-tag">[크루]</span> ' : ''}${dispTitle}
            </div>
          </div>
        </div>
        <div class="search-result-right">
          <div class="view-btn" title="이 주차로 이동">
            <i class="fa-solid fa-arrow-right"></i>
          </div>
        </div>
      </div>`;
  }).join('');
}

function jumpToDate(dateStr) {
  setWeekStartToDate(new Date(dateStr + 'T12:00:00'));
  searchInput.value = '';
  clearSearchBtn.style.display = 'none';
  showScheduleView();
  renderWeeklySchedule();
}

function showScheduleView() {
  searchResultsSection.classList.add('hidden');
  scheduleViewSection.classList.remove('hidden');
  if (liveStatusSection) liveStatusSection.classList.remove('hidden');
}

// ── Admin Form & Modal Operations ─────────────────────────────────────────────
function closeModal() {
  if (scheduleModal) {
    scheduleModal.classList.remove('active');
  }
}

window.openAddModal = function(dateStr) {
  if (!scheduleModal) return;
  document.getElementById('modalTitle').textContent = '일정 추가';
  editIndex.value = '';
  editOrigDate.value = '';
  editDate.value = dateStr;
  editTime.value = '미정';
  editTitle.value = '';
  editNote.value = '';
  editLock.checked = true;
  deleteBtn.style.display = 'none';
  scheduleModal.classList.add('active');
};

window.openEditModal = function(e, index) {
  e.stopPropagation();
  const s = rawSchedules[index];
  if (!s || !scheduleModal) return;

  document.getElementById('modalTitle').textContent = '일정 수정';
  editIndex.value = index;
  editOrigDate.value = s.date;
  editDate.value = s.date;
  editTime.value = s.time;
  editTitle.value = s.title;
  editNote.value = s.note || '';
  editLock.checked = s.source === 'manual';
  deleteBtn.style.display = 'block';
  scheduleModal.classList.add('active');
};

window.deleteScheduleDirect = function(e, index) {
  e.stopPropagation();
  if (confirm('이 일정을 삭제하시겠습니까?')) {
    rawSchedules.splice(index, 1);
    markDirty();
    renderWeeklySchedule();
  }
};

function handleDeleteClick() {
  const index = editIndex.value;
  if (index !== '' && confirm('이 일정을 삭제하시겠습니까?')) {
    rawSchedules.splice(index, 1);
    markDirty();
    closeModal();
    renderWeeklySchedule();
  }
}

function handleFormSubmit(e) {
  e.preventDefault();
  const index = editIndex.value;
  const dateVal = editDate.value;
  const timeVal = editTime.value.trim();
  const titleVal = editTitle.value.trim();
  const noteVal = editNote.value.trim();
  const isLocked = editLock.checked;

  const dayMap = ['일','월','화','수','목','금','토'];
  const dayName = dayMap[new Date(dateVal + 'T12:00:00').getDay()];

  const item = {
    member: activeMember,
    date: dateVal,
    day: dayName,
    time: timeVal,
    title: titleVal,
    note: noteVal || '수동 수정',
    source: isLocked ? 'manual' : 'soop'
  };

  if (index === '') {
    // Add new
    rawSchedules.push(item);
  } else {
    // Edit existing
    const orig = rawSchedules[index];
    if (orig.url) item.url = orig.url;
    rawSchedules[index] = item;
  }

  // Sort rawSchedules by date, member, and time
  rawSchedules.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.member !== b.member) return a.member.localeCompare(b.member);
    return a.time.localeCompare(b.time);
  });

  markDirty();
  closeModal();
  renderWeeklySchedule();
}

function markDirty() {
  isDirty = true;
  if (floatingSaveAction) {
    floatingSaveAction.classList.add('active');
  }
}

function saveToServer() {
  if (!floatingSaveBtn) return;
  floatingSaveBtn.disabled = true;
  floatingSaveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장 중...';

  fetch('/api/save_schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rawSchedules)
  })
  .then(resp => resp.json())
  .then(data => {
    if (data.status === 'ok') {
      showToast('일정이 성공적으로 저장되었습니다.', 'success');
      isDirty = false;
      if (floatingSaveAction) {
        floatingSaveAction.classList.remove('active');
      }
    } else {
      showToast('저장 중 오류 발생: ' + data.message, 'error');
    }
  })
  .catch(err => {
    showToast('서버 연결 실패: ' + err.message, 'error');
  })
  .finally(() => {
    floatingSaveBtn.disabled = false;
    floatingSaveBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> 변경사항 서버에 저장하기';
  });
}

function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast-notification ${type}`;
  toast.innerHTML = type === 'success'
    ? `<i class="fa-solid fa-circle-check"></i> <span>${msg}</span>`
    : `<i class="fa-solid fa-circle-exclamation"></i> <span>${msg}</span>`;

  document.body.appendChild(toast);
  // Trigger reflow
  toast.offsetHeight;
  toast.classList.add('active');

  setTimeout(() => {
    toast.classList.remove('active');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Live Status ──────────────────────────────────────────────────────────────
let isFetchingLive = false;

function renderOfflineFallback() {
  if (!appConfig || !appConfig.members) return;
  const fallbackData = Object.entries(appConfig.members).map(([key, m]) => {
    const stationUrl = (m.soopBoards && m.soopBoards[0]) || `https://www.sooplive.com/station/${m.soopId}`;
    return {
      member: key,
      name: m.name,
      is_live: false,
      profile_image: m.avatar || 'logo.png',
      broad_title: '방송 준비 중',
      url: stationUrl,
      thumbnail: m.avatar || 'logo.png'
    };
  });
  renderLiveStatus(fallbackData);
}

function fetchLiveStatus() {
  if (isFetchingLive) return;
  isFetchingLive = true;

  if (liveRefreshBtn) {
    const icon = liveRefreshBtn.querySelector('i');
    if (icon) icon.classList.add('spin');
  }
  if (liveRefreshText) {
    liveRefreshText.textContent = '불러오는 중...';
  }

  const handleFailure = (err) => {
    console.error('Error fetching live status:', err);
    renderOfflineFallback();
    if (liveRefreshText) {
      liveRefreshText.textContent = '업데이트 완료';
      setTimeout(() => {
        liveRefreshText.textContent = '새로고침';
      }, 3000);
    }
  };

  if (window.location.protocol === 'file:') {
    handleFailure(new Error('Local file protocol'));
    isFetchingLive = false;
    if (liveRefreshBtn) {
      const icon = liveRefreshBtn.querySelector('i');
      if (icon) icon.classList.remove('spin');
    }
    return;
  }

  fetch('/api/live_status')
    .then(resp => {
      if (!resp.ok) {
        throw new Error(`HTTP error! status: ${resp.status}`);
      }
      return resp.json();
    })
    .then(data => {
      renderLiveStatus(data);
      if (liveRefreshText) {
        liveRefreshText.textContent = '업데이트 완료';
        setTimeout(() => {
          liveRefreshText.textContent = '새로고침';
        }, 3000);
      }
    })
    .catch(err => {
      handleFailure(err);
    })
    .finally(() => {
      isFetchingLive = false;
      if (liveRefreshBtn) {
        const icon = liveRefreshBtn.querySelector('i');
        if (icon) icon.classList.remove('spin');
      }
    });
}

function renderLiveStatus(results) {
  if (!liveGridContainer || !results) return;

  // Render cards sorted: live streams first, then offline streams
  const sortedResults = [...results].sort((a, b) => {
    if (a.is_live && !b.is_live) return -1;
    if (!a.is_live && b.is_live) return 1;
    return 0; // maintain original config order otherwise
  });

  liveGridContainer.innerHTML = sortedResults.map(r => {
    const mConfig = appConfig.members[r.member] || {};
    
    // Choose avatar source based on live status
    const avatarSrc = r.is_live ? (mConfig.avatar || r.profile_image || 'logo.png') : (mConfig.avatar || 'logo.png');
    
    const avatarHtml = `<img src="${avatarSrc}" alt="${r.name}" class="live-card-avatar" onerror="this.src='logo.png'">`;

    const cardClass = r.is_live ? 'live-card live-active' : 'live-card offline-active';
    const statusText = r.is_live ? 'LIVE' : 'OFFLINE';
    const statusClass = r.is_live ? 'status-badge live' : 'status-badge offline';
    const displayTitle = r.is_live ? r.broad_title : '방송 준비 중';

    // Thumbnail: if live, use the animated SOOP live thumbnail. If offline, use member avatar or logo.png
    const thumbnailSrc = r.is_live ? r.thumbnail : (mConfig.avatar || 'logo.png');

    return `
      <div class="${cardClass}" onclick="window.open('${r.url}', '_blank')">
        <div class="live-card-header">
          <div class="live-card-member">
            ${avatarHtml}
            <span class="live-card-name">${r.name}</span>
          </div>
          <span class="${statusClass}">${statusText}</span>
        </div>
        <div class="live-thumbnail-wrapper">
          <img src="${thumbnailSrc}" alt="${r.name} 방송 미리보기" class="live-thumbnail-img" loading="lazy" onerror="this.src='logo.png'">
          <div class="live-thumbnail-overlay">
            <div class="live-title-text">${displayTitle}</div>
          </div>
          <div class="live-thumbnail-play">
            <i class="fa-solid fa-play"></i>
          </div>
        </div>
      </div>
    `;
  }).join('');
}
