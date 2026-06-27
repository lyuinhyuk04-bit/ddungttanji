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
let isLoaded        = false;       // 데이터 로드 완료 여부

let rawEvents       = [];          // 전체 이벤트 배열
let currentEventImageBase64 = '';  // 현재 작업 중인 이벤트의 Base64 이미지


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
  setupEventListeners();

  let apiSchedulesUrl = '/api/schedules';
  if (window.location.protocol === 'file:') {
    apiSchedulesUrl = 'http://localhost:8000/api/schedules';
  }

  fetch(apiSchedulesUrl)
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      return resp.json();
    })
    .then(data => {
      appConfig = data.config;
      rawSchedules = data.schedules;
      activeMember = appConfig.defaultMember;
      isLoaded = true;

      renderCrewLinks();
      selectMember(activeMember);
      fetchLiveStatus();
      handleRouting();
    })
    .catch(err => {
      console.warn('API fetch failed, trying local fallback window data:', err);
      isLoaded = true;
      if (window.APP_CONFIG && window.APP_SCHEDULE) {
        appConfig = window.APP_CONFIG;
        rawSchedules = window.APP_SCHEDULE;
        activeMember = appConfig.defaultMember;

        renderCrewLinks();
        selectMember(activeMember);
        fetchLiveStatus();
        handleRouting();
      } else {
        weeklyGridContainer.innerHTML = `
          <div class="loading-container" style="grid-column:span 7">
            <p style="color:var(--accent-pink);font-size:15px;">⚠️ 일정 데이터를 불러오지 못했습니다.</p>
            <p style="color:var(--color-text-muted);font-size:12px;">로컬 서버(python server.py)가 켜져 있는지 확인해 주세요.</p>
          </div>`;
      }
    });
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
      renderEvents();
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

  // Sidebar navigation
  const btnGoHome = document.getElementById('btnGoHome');
  const btnGoEvents = document.getElementById('btnGoEvents');
  
  if (btnGoHome) {
    btnGoHome.addEventListener('click', () => {
      if (window.location.protocol === 'file:') {
        window.location.hash = '#';
      } else {
        window.history.pushState({}, '', '/');
      }
      handleRouting();
    });
  }
  if (btnGoEvents) {
    btnGoEvents.addEventListener('click', () => {
      if (window.location.protocol === 'file:') {
        window.location.hash = '#events';
      } else {
        window.history.pushState({}, '', '/events');
      }
      handleRouting();
    });
  }
  
  window.addEventListener('popstate', handleRouting);
  
  // Event Add & Form
  const addEventBtn = document.getElementById('addEventBtn');
  if (addEventBtn) {
    addEventBtn.addEventListener('click', () => {
      window.openEventAddModal();
    });
  }
  
  const eventModal = document.getElementById('eventModal');
  const eventModalCloseBtn = document.getElementById('eventModalCloseBtn');
  const eventForm = document.getElementById('eventForm');
  const deleteEventBtn = document.getElementById('deleteEventBtn');
  const btnFetchOg = document.getElementById('btnFetchOg');
  const eventImageFile = document.getElementById('eventImageFile');
  const btnRemoveImage = document.getElementById('btnRemoveImage');
  const eventImagePreview = document.getElementById('eventImagePreview');
  const eventUploadPlaceholder = document.getElementById('eventUploadPlaceholder');
  
  if (eventModalCloseBtn) {
    eventModalCloseBtn.addEventListener('click', () => {
      if (eventModal) eventModal.classList.remove('active');
    });
  }
  if (eventModal) {
    eventModal.addEventListener('click', e => {
      if (e.target === eventModal) eventModal.classList.remove('active');
    });
  }
  if (eventForm) {
    eventForm.addEventListener('submit', handleEventFormSubmit);
  }
  if (deleteEventBtn) {
    deleteEventBtn.addEventListener('click', handleDeleteEventClick);
  }
  if (btnFetchOg) {
    btnFetchOg.addEventListener('click', handleFetchOgClick);
  }
  
  if (eventImageFile) {
    eventImageFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) {
        compressImage(file, base64Data => {
          currentEventImageBase64 = base64Data;
          if (eventImagePreview) {
            eventImagePreview.src = base64Data;
            eventImagePreview.classList.remove('hidden');
          }
          if (eventUploadPlaceholder) {
            eventUploadPlaceholder.classList.add('hidden');
          }
          if (btnRemoveImage) {
            btnRemoveImage.classList.remove('hidden');
          }
        });
      }
    });
  }
  
  if (btnRemoveImage) {
    btnRemoveImage.addEventListener('click', () => {
      currentEventImageBase64 = '';
      if (eventImageFile) eventImageFile.value = '';
      if (eventImagePreview) {
        eventImagePreview.src = '';
        eventImagePreview.classList.add('hidden');
      }
      if (eventUploadPlaceholder) {
        eventUploadPlaceholder.classList.remove('hidden');
      }
      btnRemoveImage.classList.add('hidden');
    });
  }
  
  // Event Detail Modal Close
  const eventDetailModal = document.getElementById('eventDetailModal');
  const eventDetailCloseBtn = document.getElementById('eventDetailCloseBtn');
  if (eventDetailCloseBtn) {
    eventDetailCloseBtn.addEventListener('click', () => {
      if (eventDetailModal) eventDetailModal.classList.remove('active');
    });
  }
  if (eventDetailModal) {
    eventDetailModal.addEventListener('click', e => {
      if (e.target === eventDetailModal) eventDetailModal.classList.remove('active');
    });
  }

}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDisplayTime(timeStr, memberKey) {
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
    const isMorningMember = memberKey && ['yuki', 'maribyeol', 'neboring'].includes(memberKey);
    
    if (h < 12) {
      ampm = isMorningMember ? '오전' : '오후'; // yuki, maribyeol, neboring default to AM, others default to PM
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
  
  // Auto-navigate to the latest schedule's week if current week is empty for this member
  const memberScheds = rawSchedules.filter(s => s.member === key);
  if (memberScheds.length > 0) {
    const today = new Date();
    const curWeekD = new Date(today);
    const curWeekDay = curWeekD.getDay();
    const curWeekDiff = curWeekD.getDate() - curWeekDay + (curWeekDay === 0 ? -6 : 1);
    const curWeekStart = new Date(curWeekD.setDate(curWeekDiff));
    curWeekStart.setHours(0,0,0,0);
    
    const curWeekEnd = new Date(curWeekStart);
    curWeekEnd.setDate(curWeekStart.getDate() + 6);
    curWeekEnd.setHours(23,59,59,999);
    
    const hasCurrentWeekSched = memberScheds.some(s => {
      const sDate = new Date(s.date);
      return sDate >= curWeekStart && sDate <= curWeekEnd;
    });
    
    if (!hasCurrentWeekSched) {
      const sorted = [...memberScheds].sort((a, b) => b.date.localeCompare(a.date));
      setWeekStartToDate(new Date(sorted[0].date));
    } else {
      setWeekStartToDate(today);
    }
  } else {
    setWeekStartToDate(new Date());
  }

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

    let schedulesHtml = '';
    const isRest = dayScheds.some(s => s.title === '휴방');

    if (isRest) {
      schedulesHtml = `
        <div class="empty-day rest-day">
          <i class="fa-solid fa-moon" style="color:var(--accent-pink);font-size:22px;margin-bottom:6px;"></i>
          <p style="color:var(--accent-pink);font-weight:600;">휴방</p>
        </div>`;
    } else if (dayScheds.length > 0) {
      schedulesHtml = dayScheds.map(s => {
        const isCrew       = s.title.startsWith('[크루]');
        const rawTitle     = isCrew ? s.title.replace('[크루]','').trim() : s.title;
        const displayTitle = rawTitle.replace(/\.\.\.$/,'').trim();
        const timeDisplay = formatDisplayTime(s.time, s.member);

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
    } else {
      if (!isLoaded) {
        schedulesHtml = `
          <div class="empty-day loading-day">
            <i class="fa-solid fa-spinner fa-spin" style="color:var(--accent-blue);font-size:22px;margin-bottom:6px;"></i>
            <p style="color:var(--color-text-muted);">일정 확인 중</p>
          </div>`;
      } else {
        schedulesHtml = `
          <div class="empty-day tbd-day">
            <i class="fa-regular fa-calendar" style="color:var(--color-text-muted);font-size:22px;margin-bottom:6px;"></i>
            <p style="color:var(--color-text-muted);">일정 미정</p>
          </div>`;
      }
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
                <i class="fa-regular fa-clock"></i> ${formatDisplayTime(s.time, s.member)}
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
  }).join('');
}


// ── Events Section Controllers & SPA Router ────────────────────────────────────

function handleRouting() {
  const path = window.location.pathname;
  const hash = window.location.hash;
  const isEventsPath = path === '/events' || path === '/events/' || hash === '#events';
  
  const scheduleViewSection = document.getElementById('scheduleViewSection');
  const liveStatusSection = document.getElementById('liveStatusSection');
  const searchResultsSection = document.getElementById('searchResultsSection');
  const eventsViewSection = document.getElementById('eventsViewSection');
  const membersSection = document.getElementById('membersSection');
  
  const btnGoHome = document.getElementById('btnGoHome');
  const btnGoEvents = document.getElementById('btnGoEvents');

  if (isEventsPath) {
    if (btnGoHome) btnGoHome.classList.remove('active');
    if (btnGoEvents) btnGoEvents.classList.add('active');
    
    if (scheduleViewSection) scheduleViewSection.classList.add('hidden');
    if (liveStatusSection) liveStatusSection.classList.add('hidden');
    if (searchResultsSection) searchResultsSection.classList.add('hidden');
    if (eventsViewSection) eventsViewSection.classList.remove('hidden');
    if (membersSection) membersSection.classList.add('hidden');
    
    loadEvents();
  } else {
    if (btnGoHome) btnGoHome.classList.add('active');
    if (btnGoEvents) btnGoEvents.classList.remove('active');
    
    if (scheduleViewSection) scheduleViewSection.classList.remove('hidden');
    if (liveStatusSection) liveStatusSection.classList.remove('hidden');
    if (searchResultsSection) searchResultsSection.classList.add('hidden');
    if (eventsViewSection) eventsViewSection.classList.add('hidden');
    if (membersSection) membersSection.classList.remove('hidden');
    
    renderWeeklySchedule();
  }
}

let isEventsLoaded = false;
function loadEvents() {
  let apiEventsUrl = '/api/events';
  if (window.location.protocol === 'file:') {
    apiEventsUrl = 'http://localhost:8000/api/events';
  }
  
  const eventsGrid = document.getElementById('eventsGrid');
  if (eventsGrid) {
    eventsGrid.innerHTML = `
      <div class="loading-container" style="grid-column: 1 / -1; padding: 40px 0;">
        <div class="loading-spinner"></div>
        <p>이벤트 목록을 불러오는 중입니다...</p>
      </div>`;
  }
  
  fetch(apiEventsUrl)
    .then(resp => {
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      return resp.json();
    })
    .then(data => {
      rawEvents = data;
      isEventsLoaded = true;
      renderEvents();
    })
    .catch(err => {
      console.error('Failed to fetch events:', err);
      rawEvents = [];
      isEventsLoaded = true;
      renderEvents();
    });
}

function getEventStatus(startDateStr, endDateStr) {
  const today = new Date();
  today.setHours(0,0,0,0);
  
  const start = new Date(startDateStr);
  start.setHours(0,0,0,0);
  
  const end = new Date(endDateStr);
  end.setHours(23,59,59,999);
  
  if (today < start) {
    return 'upcoming';
  } else if (today > end) {
    return 'ended';
  } else {
    return 'ongoing';
  }
}

function sortEvents(eventsList) {
  return [...eventsList].sort((a, b) => {
    const statusA = getEventStatus(a.start_date, a.end_date);
    const statusB = getEventStatus(b.start_date, b.end_date);
    
    const priority = { ongoing: 1, upcoming: 2, ended: 3 };
    if (priority[statusA] !== priority[statusB]) {
      return priority[statusA] - priority[statusB];
    }
    
    if (statusA === 'ongoing') {
      return a.end_date.localeCompare(b.end_date);
    } else if (statusA === 'upcoming') {
      return a.start_date.localeCompare(b.start_date);
    } else {
      return b.end_date.localeCompare(a.end_date);
    }
  });
}

function renderEvents() {
  const eventsGrid = document.getElementById('eventsGrid');
  const addEventBtn = document.getElementById('addEventBtn');
  if (!eventsGrid) return;
  
  if (addEventBtn) {
    if (isAdminMode) {
      addEventBtn.classList.remove('hidden');
    } else {
      addEventBtn.classList.add('hidden');
    }
  }
  
  if (rawEvents.length === 0) {
    eventsGrid.innerHTML = `
      <div class="loading-container" style="grid-column: 1 / -1; padding: 60px 0;">
        <i class="fa-regular fa-star" style="font-size: 40px; color: var(--color-text-muted); margin-bottom: 12px;"></i>
        <p style="color: var(--color-text-secondary); font-weight: 500;">등록된 이벤트가 없습니다.</p>
        ${isAdminMode ? '<p style="font-size:12px; color:var(--color-text-muted); margin-top:8px;">우측 상단의 "새 이벤트 추가" 버튼을 눌러 첫 이벤트를 등록해 보세요!</p>' : ''}
      </div>`;
    return;
  }
  
  const sorted = sortEvents(rawEvents);
  
  eventsGrid.innerHTML = sorted.map(e => {
    const status = getEventStatus(e.start_date, e.end_date);
    const statusLabels = { ongoing: '진행중', upcoming: '예정', ended: '종료' };
    const dateRangeStr = `${e.start_date.replace(/-/g, '.')} ~ ${e.end_date.replace(/-/g, '.')}`;
    
    const imageHtml = e.image 
      ? `<img src="${e.image}" alt="${e.title}" class="event-card-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">`
      : '';
    const placeholderHtml = `
      <div class="event-card-img-placeholder" style="${e.image ? 'display:none;' : ''}">
        <i class="fa-regular fa-image"></i>
        <span>포스터 없음</span>
      </div>`;
      
    const linkBtnDisabled = e.link ? '' : 'disabled';
    const detailBtnHtml = `<button class="event-card-btn btn-primary" onclick="window.openEventDetail(${rawEvents.indexOf(e)})">상세보기</button>`;
    const linkBtnHtml = `<button class="event-card-btn btn-link" ${linkBtnDisabled} onclick="window.openEventLink('${e.link}')"><i class="fa-solid fa-up-right-from-square"></i> 바로가기</button>`;
    
    const adminActionsHtml = isAdminMode
      ? `<button class="event-card-btn btn-edit-event" onclick="window.openEventEditModal(event, ${rawEvents.indexOf(e)})"><i class="fa-solid fa-pencil"></i> 수정</button>`
      : '';
      
    return `
      <div class="event-card">
        <div class="event-card-img-wrap">
          <div class="event-badge-container">
            <span class="event-badge ${status}">${statusLabels[status]}</span>
          </div>
          ${imageHtml}
          ${placeholderHtml}
        </div>
        <div class="event-card-body">
          <h3 class="event-card-title">${e.title}</h3>
          <div class="event-card-date">
            <i class="fa-regular fa-calendar"></i>
            <span>${dateRangeStr}</span>
          </div>
          <div class="event-card-desc">${e.description || '이벤트 설명이 없습니다.'}</div>
          <div class="event-card-actions">
            ${detailBtnHtml}
            ${adminActionsHtml || linkBtnHtml}
          </div>
        </div>
      </div>`;
  }).join('');
}

window.openEventDetail = function(index) {
  const e = rawEvents[index];
  const eventDetailModal = document.getElementById('eventDetailModal');
  if (!e || !eventDetailModal) return;
  
  const status = getEventStatus(e.start_date, e.end_date);
  const statusLabels = { ongoing: '진행중', upcoming: '예정', ended: '종료' };
  
  const detailEventBadge = document.getElementById('detailEventBadge');
  const detailEventImage = document.getElementById('detailEventImage');
  const detailEventTitle = document.getElementById('detailEventTitle');
  const detailEventDatesText = document.getElementById('detailEventDatesText');
  const detailEventDesc = document.getElementById('detailEventDesc');
  const detailEventLink = document.getElementById('detailEventLink');
  
  if (detailEventBadge) {
    detailEventBadge.className = `event-badge ${status}`;
    detailEventBadge.textContent = statusLabels[status];
  }
  
  if (detailEventImage) {
    if (e.image) {
      detailEventImage.src = e.image;
      detailEventImage.parentElement.style.display = 'block';
    } else {
      detailEventImage.src = '';
      detailEventImage.parentElement.style.display = 'none';
    }
  }
  
  if (detailEventTitle) detailEventTitle.textContent = e.title;
  if (detailEventDatesText) {
    detailEventDatesText.textContent = `${e.start_date.replace(/-/g, '.')} ~ ${e.end_date.replace(/-/g, '.')}`;
  }
  if (detailEventDesc) detailEventDesc.textContent = e.description || '상세 설명이 없습니다.';
  
  if (detailEventLink) {
    if (e.link) {
      detailEventLink.href = e.link;
      detailEventLink.style.display = 'flex';
    } else {
      detailEventLink.href = '#';
      detailEventLink.style.display = 'none';
    }
  }
  
  eventDetailModal.classList.add('active');
};

window.openEventLink = function(url) {
  if (url) {
    window.open(url, '_blank');
  }
};

function compressImage(file, callback) {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = function(event) {
    const img = new Image();
    img.src = event.target.result;
    img.onload = function() {
      const maxW = 800;
      let w = img.width;
      let h = img.height;
      
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      callback(dataUrl);
    };
  };
}

function saveEventsToServer() {
  let apiSaveEventsUrl = '/api/save_events';
  if (window.location.protocol === 'file:') {
    apiSaveEventsUrl = 'http://localhost:8000/api/save_events';
  }
  
  return fetch(apiSaveEventsUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rawEvents)
  })
  .then(resp => {
    if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
    return resp.json();
  })
  .then(data => {
    if (data.status === 'ok') {
      return true;
    } else {
      throw new Error(data.message || '저장 중 서버 실패');
    }
  });
}

window.openEventAddModal = function() {
  const eventModal = document.getElementById('eventModal');
  const eventModalTitle = document.getElementById('eventModalTitle');
  const editEventId = document.getElementById('editEventId');
  const eventTitle = document.getElementById('eventTitle');
  const eventStartDate = document.getElementById('eventStartDate');
  const eventEndDate = document.getElementById('eventEndDate');
  const eventDesc = document.getElementById('eventDesc');
  const eventLink = document.getElementById('eventLink');
  
  const eventImagePreview = document.getElementById('eventImagePreview');
  const eventUploadPlaceholder = document.getElementById('eventUploadPlaceholder');
  const btnRemoveImage = document.getElementById('btnRemoveImage');
  const deleteEventBtn = document.getElementById('deleteEventBtn');
  
  if (!eventModal) return;
  eventModalTitle.textContent = '새 이벤트 등록';
  editEventId.value = '';
  eventTitle.value = '';
  eventStartDate.value = '';
  eventEndDate.value = '';
  eventDesc.value = '';
  eventLink.value = '';
  currentEventImageBase64 = '';
  
  if (eventImagePreview) {
    eventImagePreview.src = '';
    eventImagePreview.classList.add('hidden');
  }
  if (eventUploadPlaceholder) {
    eventUploadPlaceholder.classList.remove('hidden');
  }
  if (btnRemoveImage) {
    btnRemoveImage.classList.add('hidden');
  }
  if (deleteEventBtn) {
    deleteEventBtn.style.display = 'none';
  }
  
  eventModal.classList.add('active');
};

window.openEventEditModal = function(e, index) {
  e.stopPropagation();
  const eventItem = rawEvents[index];
  
  const eventModal = document.getElementById('eventModal');
  const eventModalTitle = document.getElementById('eventModalTitle');
  const editEventId = document.getElementById('editEventId');
  const eventTitle = document.getElementById('eventTitle');
  const eventStartDate = document.getElementById('eventStartDate');
  const eventEndDate = document.getElementById('eventEndDate');
  const eventDesc = document.getElementById('eventDesc');
  const eventLink = document.getElementById('eventLink');
  
  const eventImagePreview = document.getElementById('eventImagePreview');
  const eventUploadPlaceholder = document.getElementById('eventUploadPlaceholder');
  const btnRemoveImage = document.getElementById('btnRemoveImage');
  const deleteEventBtn = document.getElementById('deleteEventBtn');
  
  if (!eventItem || !eventModal) return;
  
  eventModalTitle.textContent = '이벤트 수정';
  editEventId.value = index;
  eventTitle.value = eventItem.title;
  eventStartDate.value = eventItem.start_date;
  eventEndDate.value = eventItem.end_date;
  eventDesc.value = eventItem.description || '';
  eventLink.value = eventItem.link || '';
  currentEventImageBase64 = eventItem.image || '';
  
  if (eventImagePreview) {
    if (currentEventImageBase64) {
      eventImagePreview.src = currentEventImageBase64;
      eventImagePreview.classList.remove('hidden');
      if (eventUploadPlaceholder) eventUploadPlaceholder.classList.add('hidden');
      if (btnRemoveImage) btnRemoveImage.classList.remove('hidden');
    } else {
      eventImagePreview.src = '';
      eventImagePreview.classList.add('hidden');
      if (eventUploadPlaceholder) eventUploadPlaceholder.classList.remove('hidden');
      if (btnRemoveImage) btnRemoveImage.classList.add('hidden');
    }
  }
  
  if (deleteEventBtn) {
    deleteEventBtn.style.display = 'block';
  }
  
  eventModal.classList.add('active');
};

function closeEventModal() {
  const eventModal = document.getElementById('eventModal');
  if (eventModal) eventModal.classList.remove('active');
}

function handleEventFormSubmit(e) {
  e.preventDefault();
  const index = document.getElementById('editEventId').value;
  
  const eventTitle = document.getElementById('eventTitle');
  const eventStartDate = document.getElementById('eventStartDate');
  const eventEndDate = document.getElementById('eventEndDate');
  const eventDesc = document.getElementById('eventDesc');
  const eventLink = document.getElementById('eventLink');

  const item = {
    title: eventTitle.value.trim(),
    start_date: eventStartDate.value,
    end_date: eventEndDate.value,
    description: eventDesc.value.trim(),
    link: eventLink.value.trim(),
    image: currentEventImageBase64 || ''
  };
  
  if (index === '') {
    rawEvents.push(item);
  } else {
    rawEvents[index] = item;
  }
  
  closeEventModal();
  
  saveEventsToServer()
    .then(() => {
      showToast('이벤트가 성공적으로 저장되었습니다.', 'success');
      renderEvents();
    })
    .catch(err => {
      showToast('저장 중 오류가 발생했습니다: ' + err.message, 'error');
    });
}

function handleDeleteEventClick() {
  const index = document.getElementById('editEventId').value;
  if (index !== '' && confirm('이 이벤트를 삭제하시겠습니까?')) {
    rawEvents.splice(index, 1);
    closeEventModal();
    
    saveEventsToServer()
      .then(() => {
        showToast('이벤트가 삭제되었습니다.', 'success');
        renderEvents();
      })
      .catch(err => {
        showToast('삭제 중 오류가 발생했습니다: ' + err.message, 'error');
      });
  }
}

function handleFetchOgClick() {
  const eventLink = document.getElementById('eventLink');
  const eventTitle = document.getElementById('eventTitle');
  const eventDesc = document.getElementById('eventDesc');
  const btnFetchOg = document.getElementById('btnFetchOg');
  const eventImagePreview = document.getElementById('eventImagePreview');
  const eventUploadPlaceholder = document.getElementById('eventUploadPlaceholder');
  const btnRemoveImage = document.getElementById('btnRemoveImage');
  
  const urlVal = eventLink.value.trim();
  if (!urlVal) {
    showToast('링크 URL을 입력해 주세요.', 'error');
    return;
  }
  
  btnFetchOg.disabled = true;
  btnFetchOg.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 불러오는 중...';
  
  let apiFetchOgUrl = `/api/fetch_og?url=${encodeURIComponent(urlVal)}`;
  if (window.location.protocol === 'file:') {
    apiFetchOgUrl = `http://localhost:8000/api/fetch_og?url=${encodeURIComponent(urlVal)}`;
  }
  
  fetch(apiFetchOgUrl)
    .then(resp => {
      if (!resp.ok) throw new Error('OG metadata fetch failed');
      return resp.json();
    })
    .then(data => {
      if (data.title && !eventTitle.value.trim()) {
        eventTitle.value = data.title;
      }
      if (data.description && !eventDesc.value.trim()) {
        eventDesc.value = data.description;
      }
      if (data.image) {
        currentEventImageBase64 = data.image;
        if (eventImagePreview) {
          eventImagePreview.src = data.image;
          eventImagePreview.classList.remove('hidden');
          if (eventUploadPlaceholder) eventUploadPlaceholder.classList.add('hidden');
          if (btnRemoveImage) btnRemoveImage.classList.remove('hidden');
        }
      }
      showToast('링크 정보를 불러왔습니다.', 'success');
    })
    .catch(err => {
      console.error(err);
      showToast('링크 정보를 가져오지 못했습니다. 직접 입력해 주세요.', 'error');
    })
    .finally(() => {
      btnFetchOg.disabled = false;
      btnFetchOg.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> 불러오기';
    });
}


