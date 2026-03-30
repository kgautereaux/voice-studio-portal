/* ============================================================
   Voice Studio Portal — Application Logic
   ============================================================
   Handles Supabase auth, data loading, form submission,
   and page routing. All data flows through Supabase directly
   from the browser (no backend server).
   ============================================================ */

// ============================================================
// CONFIGURATION
// ============================================================

const SUPABASE_URL = 'https://ukvkljztinkzmkbtsfuo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrdmtsanp0aW5rem1rYnRzZnVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTAxMTUsImV4cCI6MjA4OTI4NjExNX0.dh0zSDQyTjvBrArPA7szI_NekBF1_V6CU8e7pLdpV1k';

let sb = null;
let currentUser = null;
let studentData = null;

const JURY_REQUIREMENTS = {
    'MFA_MT_Vocal_Pedagogy': ['Golden Age MT', 'Ballad', 'Up-tempo', 'Jazz/Folk/Rock/Pop', 'Contemporary MT (post-2000)', 'English art song', 'Wildcard'],
    'MM_Vocal_Pedagogy': ['Operatic aria', 'MT standard (belt or legit)', 'Art song 1', 'Art song 2', 'Art song 3', 'Art song 4', 'Wildcard'],
    'BFA_MT_Sophomore': ['32-bar cut', 'Legit selection', 'Additional selection 1', 'Additional selection 2', 'Wildcard']
};

function programKeyFromDegree(degree) {
    if (!degree) return null;
    const d = degree.toLowerCase();
    if (d.includes('mfa') && d.includes('mt')) return 'MFA_MT_Vocal_Pedagogy';
    if (d.includes('mm') && d.includes('ped')) return 'MM_Vocal_Pedagogy';
    if (d.includes('bfa') && d.includes('mt') && d.includes('soph')) return 'BFA_MT_Sophomore';
    if (d.includes('mfa')) return 'MFA_MT_Vocal_Pedagogy';
    if (d.includes('mm')) return 'MM_Vocal_Pedagogy';
    if (d.includes('bfa')) return 'BFA_MT_Sophomore';
    return null;
}

// ============================================================
// INITIALIZATION
// ============================================================

async function initApp() {
    console.log('[VS] initApp starting');

    // Initialize Supabase client (CDN v2 exports createClient on window.supabase)
    const { createClient } = window.supabase;
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Check for existing session
    const { data: { session } } = await sb.auth.getSession();
    console.log('[VS] session:', session ? session.user.email : 'none');

    // Set up navigation first so form handlers are always bound
    setupNavigation();

    if (session) {
        currentUser = session.user;
        const hasConsent = await checkConsent();
        console.log('[VS] hasConsent:', hasConsent);

        if (!hasConsent) {
            if (!window.location.pathname.includes('consent.html')) {
                console.log('[VS] redirecting to consent.html');
                window.location.href = 'consent.html';
                return;
            }
        } else {
            try {
                await loadStudentData();
            } catch (err) {
                console.error('[VS] loadStudentData error:', err);
            }
            if (window.location.pathname.includes('consent.html')) {
                window.location.href = 'dashboard.html';
                return;
            }
            showDashboard();
        }
    } else {
        if (window.location.pathname.includes('consent.html')) {
            window.location.href = 'dashboard.html';
            return;
        }
        showLogin();
    }

    // Listen for auth changes
    sb.auth.onAuthStateChange(async (event, session) => {
        console.log('[VS] auth change:', event);
        if (event === 'SIGNED_IN' && session) {
            currentUser = session.user;
            const hasConsent = await checkConsent();
            if (!hasConsent) {
                window.location.href = 'consent.html';
            } else {
                try {
                    await loadStudentData();
                } catch (err) {
                    console.error('[VS] loadStudentData error:', err);
                }
                showDashboard();
            }
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            studentData = null;
            showLogin();
        }
    });
}

// ============================================================
// AUTHENTICATION
// ============================================================

async function handleLogin(event) {
    event.preventDefault();
    const usernameInput = document.getElementById('login-username') || document.getElementById('login-email');
    const username = usernameInput.value.trim().toLowerCase();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    errorEl.style.display = 'none';

    // Convert username to internal email format
    const email = username.includes('@') ? username : username + '@studio.kaylagautereaux.com';

    const { data, error } = await sb.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        errorEl.textContent = 'Invalid username or password.';
        errorEl.style.display = 'block';
    }
}

async function handleLogout() {
    await sb.auth.signOut();
}

// ============================================================
// CONSENT
// ============================================================

async function checkConsent() {
    if (!currentUser) return false;

    const { data: student } = await sb
        .from('students')
        .select('consent_accepted_at')
        .eq('id', currentUser.id)
        .single();

    if (!student) return false;
    return student.consent_accepted_at !== null;
}

async function acceptConsent() {
    if (!currentUser) return false;

    const { data, error } = await sb
        .from('students')
        .update({ consent_accepted_at: new Date().toISOString() })
        .eq('id', currentUser.id);

    if (error) {
        console.error('Consent error:', error);
        alert('Error saving consent. Please try again or contact Prof. Gautereaux.');
        return false;
    }
    return true;
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadStudentData() {
    if (!currentUser) return;

    // Load student profile
    const { data: student } = await sb
        .from('students')
        .select('*')
        .eq('id', currentUser.id)
        .single();

    if (!student) {
        console.warn('No student record found for user:', currentUser.id);
        return;
    }

    studentData = { student };

    // Load practice plans
    const { data: plans } = await sb
        .from('practice_plans')
        .select('*')
        .eq('student_id', currentUser.id)
        .in('status', ['approved', 'delivered'])
        .order('date_generated', { ascending: false })
        .limit(5);

    studentData.practicePlans = plans || [];

    // Load reflections
    const { data: reflections } = await sb
        .from('reflections')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('date_submitted', { ascending: false })
        .limit(5);

    studentData.reflections = reflections || [];

    // Load all repertoire (active + previous)
    const { data: allRepertoire } = await sb
        .from('repertoire')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('timeline');

    const allRep = allRepertoire || [];
    studentData.repertoire = allRep.filter(r =>
        ['assigned', 'in_progress', 'performance_ready'].includes(r.status));
    studentData.previousRepertoire = allRep.filter(r => r.status === 'shelved');

    // Load acoustic measurements
    const { data: acoustics } = await sb
        .from('acoustic_measurements')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('date');

    studentData.acoustics = acoustics || [];

    // Load studio class feedback
    const { data: studioFeedback } = await sb
        .from('studio_class_feedback')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('studio_class_date', { ascending: false })
        .limit(3);

    studentData.studioFeedback = studioFeedback || [];

    // Load lesson logs (student-visible fields: four-section debrief)
    const { data: lessonLogs } = await sb
        .from('lesson_logs')
        .select('id, date, duration_minutes, repertoire_worked, exercises, breakthroughs, pivots, motor_learning_phase, next_steps, plan_for_next_lesson')
        .eq('student_id', currentUser.id)
        .eq('approved', true)
        .order('date', { ascending: false })
        .limit(10);

    studentData.lessonLogs = lessonLogs || [];

    // Load jury/hearing feedback
    const { data: juryFeedback } = await sb
        .from('jury_feedback')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('date', { ascending: false });

    studentData.juryFeedback = juryFeedback || [];

    // Load upcoming events
    const { data: events } = await sb
        .from('performance_events')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('date');

    studentData.events = events || [];

    // Load studio class plans
    const { data: studioPlans } = await sb
        .from('studio_class_plans')
        .select('*')
        .order('studio_class_date');

    studentData.studioPlans = studioPlans || [];

    // Load jury plan
    const { data: juryPlans } = await sb
        .from('jury_plans')
        .select('*')
        .eq('student_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(1);

    studentData.juryPlan = (juryPlans || [])[0] || null;

    if (studentData.juryPlan) {
        const { data: jurySelections } = await sb
            .from('jury_selections')
            .select('*')
            .eq('jury_plan_id', studentData.juryPlan.id)
            .order('requirement_slot');

        studentData.jurySelections = jurySelections || [];
    } else {
        studentData.jurySelections = [];
    }
}

// ============================================================
// PAGE RENDERING
// ============================================================

function showLogin() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-login').classList.add('active');
    document.getElementById('nav-authenticated').style.display = 'none';
    document.getElementById('nav-actions').style.display = 'none';
}

function showDashboard() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-dashboard').classList.add('active');
    document.getElementById('nav-authenticated').style.display = 'flex';
    document.getElementById('nav-actions').style.display = 'flex';

    renderDashboard();
}

function showReflection() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-reflect').classList.add('active');
    updateNavActive('reflect');
}

function showProgress() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-progress').classList.add('active');
    updateNavActive('progress');
    renderProgress();
}

function setupNavigation() {
    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    // Logout
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', showSettings);
    }

    // Nav links
    document.querySelectorAll('[data-nav]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = link.dataset.nav;
            if (target === 'dashboard') showDashboard();
            else if (target === 'reflect') showReflection();
            else if (target === 'progress') showProgress();
        });
    });

    // Reflection form
    const reflectForm = document.getElementById('reflection-form');
    if (reflectForm) {
        reflectForm.addEventListener('submit', handleReflectionSubmit);
    }

    // Vocal load add button
    const addLoadBtn = document.getElementById('add-vocal-load');
    if (addLoadBtn) {
        addLoadBtn.addEventListener('click', addVocalLoadEntry);
    }

    // Range inputs
    document.querySelectorAll('input[type="range"]').forEach(input => {
        const display = document.getElementById(input.id + '-value');
        if (display) {
            input.addEventListener('input', () => {
                display.textContent = input.value;
            });
        }
    });
}

function updateNavActive(page) {
    document.querySelectorAll('[data-nav]').forEach(link => {
        link.classList.toggle('active', link.dataset.nav === page);
    });
}

// ============================================================
// DASHBOARD RENDERING
// ============================================================

function renderDashboard() {
    if (!studentData) return;

    const welcomeEl = document.getElementById('welcome-name');
    if (welcomeEl) {
        welcomeEl.textContent = studentData.student.name;
    }

    // Hide all detail panels, show the grid
    document.querySelectorAll('.detail-panel').forEach(p => p.style.display = 'none');
    const grid = document.getElementById('dashboard-grid');
    if (grid) grid.style.display = 'grid';

    // Upcoming events
    renderUpcomingEvents();

    // Populate dashboard cards
    renderDashCards();

    // Set up card click handlers
    setupCardNavigation();

    updateNavActive('dashboard');
}

function renderUpcomingEvents() {
    const container = document.getElementById('upcoming-events');
    if (!container) return;

    // We'll load events from Supabase if available
    // For now, check if studentData has events (we'll add this to loadStudentData)
    const events = studentData.events || [];
    const upcoming = events.filter(e => e.status === 'upcoming').slice(0, 3);

    if (upcoming.length === 0) {
        container.innerHTML = '';
        return;
    }

    const items = upcoming.map(e => {
        const d = new Date(e.date + 'T12:00:00');
        const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<strong>${dayName} ${dateStr}</strong>: ${escapeHtml(e.title)}${e.notes ? ' (' + escapeHtml(e.notes) + ')' : ''}`;
    });

    container.innerHTML = `<div class="upcoming-events">${items.join(' &nbsp;·&nbsp; ')}</div>`;
}

function renderDashCards() {
    const events = studentData.events || [];
    const todayStr = new Date().toLocaleDateString('en-CA');
    const nextLesson = events.find(e =>
        e.date >= todayStr && e.title && e.title.includes('Voice Lesson')
    );

    // LATEST LESSON (from logs, always show last lesson)
    const lessons = studentData.lessonLogs || [];
    if (lessons.length > 0) {
        const l = lessons[0];
        const d = new Date(l.date + 'T12:00:00');
        document.getElementById('dash-lesson-date').textContent =
            d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const rep = typeof l.repertoire_worked === 'string' ? JSON.parse(l.repertoire_worked) : (l.repertoire_worked || []);
        let summary = rep.length > 0 ? rep.map(r => r.split('—')[0].split('(')[0].trim()).join(', ') : 'Lesson recorded';
        if (nextLesson) {
            const nd = new Date(nextLesson.date + 'T12:00:00');
            summary += ' · Next: ' + nd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        }
        document.getElementById('dash-lesson-summary').textContent = summary;
    } else {
        document.getElementById('dash-lesson-date').textContent = '--';
        document.getElementById('dash-lesson-summary').textContent =
            nextLesson ? 'Next: ' + new Date(nextLesson.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'No lessons yet';
    }

    // PRACTICE PLAN
    const plans = studentData.practicePlans || [];
    if (plans.length > 0) {
        const p = plans[0];
        const d = new Date(p.date_generated + 'T12:00:00');
        document.getElementById('dash-plan-date').textContent =
            d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const repFocus = typeof p.repertoire_focus === 'string' ? JSON.parse(p.repertoire_focus) : (p.repertoire_focus || []);
        const exercises = typeof p.exercises === 'string' ? JSON.parse(p.exercises) : (p.exercises || []);
        const parts = [];
        if (exercises.length > 0) {
            parts.push(exercises.length + ' exercise' + (exercises.length > 1 ? 's' : ''));
        }
        if (repFocus.length > 0) {
            parts.push(repFocus.map(r => r.title || r).join(', '));
        }
        document.getElementById('dash-plan-summary').textContent =
            parts.length > 0 ? parts.join(' · ') : 'Plan available';
    } else {
        document.getElementById('dash-plan-date').textContent = '--';
        document.getElementById('dash-plan-summary').textContent = 'Check back after your next lesson';
    }

    // REFLECTION
    const reflections = studentData.reflections || [];
    const latestPlanDate = plans.length > 0 ? new Date(plans[0].date_generated) : null;
    const hasRecentReflection = latestPlanDate && reflections.some(r => new Date(r.date_submitted) > latestPlanDate);

    // Reflection due date and next lesson naming
    let reflectionDueStr = '';
    let nextLessonLabel = 'your next lesson';
    if (nextLesson) {
        const lessonDate = new Date(nextLesson.date + 'T12:00:00');
        const dueDate = new Date(lessonDate);
        dueDate.setDate(dueDate.getDate() - 1);
        reflectionDueStr = dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        nextLessonLabel = lessonDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' lesson';
    }

    if (hasRecentReflection) {
        document.getElementById('dash-reflection-status').textContent = 'Submitted';
        const latest = reflections[0];
        document.getElementById('dash-reflection-summary').textContent =
            `Voice: ${latest.voice_feeling || '-'}/10 · Confidence: ${latest.artistic_confidence || '-'}/10`;
    } else {
        document.getElementById('dash-reflection-status').textContent =
            reflectionDueStr ? 'Due ' + reflectionDueStr : 'Due';
        document.getElementById('dash-reflection-summary').textContent =
            'Submit before ' + nextLessonLabel;
    }

    // REPERTOIRE & JURY
    const rep = studentData.repertoire || [];
    const jurySels = studentData.jurySelections || [];
    const juryPlanCard = studentData.juryPlan;
    const activeSels = jurySels.filter(s => s.status !== 'dropped');
    const pkCard = studentData.student.program_key || programKeyFromDegree(studentData.student.degree_program);
    const jurySlotsCard = (pkCard && JURY_REQUIREMENTS[pkCard]) ? JURY_REQUIREMENTS[pkCard] : [];

    document.getElementById('dash-rep-count').textContent =
        rep.length > 0 ? rep.length + ' pieces' : '--';
    if (rep.length > 0 || juryPlanCard) {
        const parts = [];
        if (rep.length > 0) {
            const nearest = rep.filter(r => r.timeline).sort((a, b) => a.timeline.localeCompare(b.timeline))[0];
            if (nearest) parts.push('Next: ' + new Date(nearest.timeline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        }
        if (juryPlanCard && jurySlotsCard.length > 0) {
            const filledCount = activeSels.filter(s => s.status === 'accepted' || s.status === 'confirmed' || s.status === 'approved').length;
            parts.push('Jury: ' + filledCount + '/' + jurySlotsCard.length);
        }
        document.getElementById('dash-rep-summary').textContent = parts.join(' · ') || 'No repertoire tracked yet';
    } else {
        document.getElementById('dash-rep-summary').textContent = 'No repertoire tracked yet';
    }

    // VOICE ANALYTICS
    const acoustics = studentData.acoustics || [];
    if (acoustics.length > 0) {
        const sv = acoustics.filter(a => a.task_type === 'sv');
        if (sv.length > 0) {
            const latest = sv[sv.length - 1];
            document.getElementById('dash-progress-value').textContent =
                latest.f0_range_st ? latest.f0_range_st.toFixed(1) + ' st range' : 'Data available';
            document.getElementById('dash-progress-summary').textContent =
                sv.length + ' assessment' + (sv.length > 1 ? 's' : '');
        } else {
            document.getElementById('dash-progress-value').textContent = 'Coming Soon';
            document.getElementById('dash-progress-summary').textContent = 'Data collection pending';
        }
    } else {
        document.getElementById('dash-progress-value').textContent = 'Coming Soon';
        document.getElementById('dash-progress-summary').textContent = 'Data collection pending';
    }

    // VOCAL PROGRESS (qualitative wins)
    const lessonLogs = studentData.lessonLogs || [];
    const allReflections = studentData.reflections || [];
    const studioFb = studentData.studioFeedback || [];

    // Collect wins from all sources
    const wins = [];
    for (const l of lessonLogs) {
        if (l.breakthroughs) {
            wins.push({ date: l.date, type: 'lesson', text: l.breakthroughs });
        }
    }
    for (const r of allReflections) {
        if (r.wins) {
            const d = r.date_submitted ? r.date_submitted.split('T')[0] : '';
            wins.push({ date: d, type: 'reflection', text: r.wins });
        }
    }
    for (const f of studioFb) {
        if (f.kayla_feedback) {
            wins.push({ date: f.studio_class_date, type: 'studio', text: f.kayla_feedback });
        }
    }
    wins.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (wins.length > 0) {
        document.getElementById('dash-wins-value').textContent = wins.length + ' highlight' + (wins.length > 1 ? 's' : '');
        const latest = wins[0];
        const preview = latest.text.length > 60 ? latest.text.substring(0, 60) + '...' : latest.text;
        document.getElementById('dash-wins-summary').textContent = preview;
    } else {
        document.getElementById('dash-wins-value').textContent = '--';
        document.getElementById('dash-wins-summary').textContent = 'Wins and breakthroughs will appear here';
    }

    // PERFORMANCE FEEDBACK — show most recent event with notes
    const perfEvents = (studentData.events || []).filter(e => e.notes && e.notes.length > 20 && e.status === 'completed');
    perfEvents.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const juryFb = studentData.juryFeedback || [];
    const totalFeedback = perfEvents.length + (juryFb.length > 0 ? 1 : 0);

    if (totalFeedback > 0) {
        const latest = perfEvents.length > 0 ? perfEvents[0] : null;
        const latestJury = juryFb.length > 0 ? juryFb[0] : null;
        let displayDate = latest ? latest.date : (latestJury ? latestJury.date : '');
        let displayTitle = latest ? latest.title : (latestJury ? latestJury.event_type.replace(/_/g, ' ') : '');
        const d = new Date(displayDate + 'T12:00:00');
        document.getElementById('dash-feedback-value').textContent =
            d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        document.getElementById('dash-feedback-summary').textContent =
            displayTitle + (juryFb.length > 0 ? ' · ' + juryFb.length + ' panel comment' + (juryFb.length > 1 ? 's' : '') : '');
    } else {
        document.getElementById('dash-feedback-value').textContent = '--';
        document.getElementById('dash-feedback-summary').textContent = 'Feedback from performances will appear here';
    }

    // STUDIO CLASS — show next upcoming studio class
    const studioPlans = studentData.studioPlans || [];
    const today = new Date().toLocaleDateString('en-CA');
    const nextStudio = studioPlans.find(p => p.studio_class_date >= today);
    if (nextStudio) {
        const d = new Date(nextStudio.studio_class_date + 'T12:00:00');
        document.getElementById('dash-studio-date').textContent =
            d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        document.getElementById('dash-studio-summary').textContent =
            (nextStudio.time || '') + (nextStudio.location ? ' · ' + nextStudio.location : '');
    } else {
        document.getElementById('dash-studio-date').textContent = '--';
        document.getElementById('dash-studio-summary').textContent = 'No upcoming studio class';
    }

}

function setupCardNavigation() {
    document.querySelectorAll('.dash-card').forEach(card => {
        card.addEventListener('click', () => {
            const target = card.dataset.detail;
            if (!target) return;

            // If it's a page (reflection, progress), navigate to that page
            if (target.startsWith('page-')) {
                if (target === 'page-reflect') showReflection();
                else if (target === 'page-progress') showProgress();
                return;
            }

            // Otherwise show the detail panel
            const grid = document.getElementById('dashboard-grid');
            const events = document.getElementById('upcoming-events');
            if (grid) grid.style.display = 'none';
            if (events) events.style.display = 'none';

            // Hide all detail panels
            document.querySelectorAll('.detail-panel').forEach(p => p.style.display = 'none');

            // Show the target panel and render its content
            const panel = document.getElementById(target);
            if (panel) {
                panel.style.display = 'block';
                renderDetailPanel(target);
            }
        });
    });

    // Back buttons
    document.querySelectorAll('.detail-back').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.detail-panel').forEach(p => p.style.display = 'none');
            const grid = document.getElementById('dashboard-grid');
            const events = document.getElementById('upcoming-events');
            if (grid) grid.style.display = 'grid';
            if (events) events.style.display = '';
        });
    });
}

function renderDetailPanel(panelId) {
    if (panelId === 'detail-lesson') renderLessonDebrief();
    else if (panelId === 'detail-plan') { renderPracticePlan(); renderPastPlans(); }
    else if (panelId === 'detail-repertoire') { renderRepertoire(); setupRepForm(); }
    else if (panelId === 'detail-wins') renderWins();
    else if (panelId === 'detail-feedback') renderPerformanceFeedback();
    else if (panelId === 'detail-studio') { renderStudioFeedback(); renderStudioClassPlan(); }
}

function renderPerformanceFeedback() {
    const container = document.getElementById('feedback-content');
    if (!container || !studentData) return;

    const events = (studentData.events || []).filter(e => e.notes && e.notes.length > 20);
    const juryFb = studentData.juryFeedback || [];

    if (events.length === 0 && juryFb.length === 0) {
        container.innerHTML = '<p class="text-muted">No performance feedback yet. Notes from dress rehearsals, hearings, and juries will appear here.</p>';
        return;
    }

    let html = '';

    // Performance event notes (dress rehearsals, etc.)
    events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    events.forEach(e => {
        const d = new Date(e.date + 'T12:00:00');
        const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        html += '<div style="margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border-color);">';
        html += '<h3 style="font-size: 1rem; font-weight: 500; margin-bottom: 0.25rem;">' + escapeHtml(e.title || 'Performance') + '</h3>';
        html += '<p class="text-muted" style="font-size: 13px; margin-bottom: 1rem;">' + dateStr + '</p>';
        // Render notes as paragraphs, splitting on double newlines
        const paragraphs = e.notes.split(/\n\n+/).filter(p => p.trim());
        paragraphs.forEach(p => {
            p = p.trim();
            if (p.startsWith('**') || p.includes('**:')) {
                // Bold section header (like "California: ...")
                html += '<p style="margin-bottom: 0.5rem;">' + inlineFormat(escapeHtml(p)) + '</p>';
            } else {
                html += '<p style="margin-bottom: 0.5rem;">' + escapeHtml(p) + '</p>';
            }
        });
        html += '</div>';
    });

    // Jury/hearing panel feedback
    if (juryFb.length > 0) {
        // Group by date + event_type
        const grouped = {};
        juryFb.forEach(j => {
            const key = j.date + '|' + (j.event_type || 'jury');
            if (!grouped[key]) grouped[key] = { date: j.date, event_type: j.event_type, outcome: j.outcome, comments: [] };
            grouped[key].comments.push(j);
        });

        Object.values(grouped).sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach(g => {
            const d = new Date(g.date + 'T12:00:00');
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
            const typeLabel = (g.event_type || 'jury').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            html += '<div style="margin-bottom: 2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--border-color);">';
            html += '<h3 style="font-size: 1rem; font-weight: 500; margin-bottom: 0.25rem;">' + escapeHtml(typeLabel) + '</h3>';
            html += '<p class="text-muted" style="font-size: 13px; margin-bottom: 1rem;">' + dateStr;
            if (g.outcome) html += ' · ' + escapeHtml(g.outcome);
            html += '</p>';

            g.comments.forEach(c => {
                html += '<div style="margin-bottom: 1rem; padding-left: 1rem; border-left: 2px solid var(--border-color);">';
                html += '<p style="font-weight: 500; font-size: 14px; margin-bottom: 0.25rem;">' + escapeHtml(c.panelist_name);
                if (c.panelist_role) html += ' <span class="text-muted" style="font-weight: 400;">(' + escapeHtml(c.panelist_role) + ')</span>';
                html += '</p>';
                html += '<p style="font-size: 14px;">' + escapeHtml(c.comments) + '</p>';
                html += '</div>';
            });
            html += '</div>';
        });
    }

    container.innerHTML = html;
}

function inlineFormat(text) {
    // Handle **bold** patterns
    return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function renderWins() {
    const container = document.getElementById('wins-content');
    if (!container || !studentData) return;

    const lessonLogs = studentData.lessonLogs || [];
    const reflections = studentData.reflections || [];
    const studioFb = studentData.studioFeedback || [];

    // Collect all wins/breakthroughs
    const items = [];

    for (const l of lessonLogs) {
        if (l.breakthroughs) {
            items.push({
                date: l.date,
                source: 'Lesson',
                text: l.breakthroughs,
            });
        }
    }

    for (const r of reflections) {
        if (r.wins) {
            const d = r.date_submitted ? r.date_submitted.split('T')[0] : '';
            items.push({
                date: d,
                source: 'Your Reflection',
                text: r.wins,
            });
        }
    }

    for (const f of studioFb) {
        if (f.kayla_feedback) {
            items.push({
                date: f.studio_class_date,
                source: 'Studio Class',
                text: f.kayla_feedback,
            });
        }
        if (f.performance_observations) {
            items.push({
                date: f.studio_class_date,
                source: 'Studio Class',
                text: f.performance_observations,
            });
        }
    }

    // Sort newest first
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (items.length === 0) {
        container.innerHTML = '<p class="text-muted">No highlights recorded yet. Breakthroughs from lessons, wins from your reflections, and studio class feedback will appear here as they accumulate.</p>';
        return;
    }

    let html = '';
    for (const item of items) {
        const dateStr = item.date
            ? new Date(item.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';

        html += `<div class="card" style="margin-bottom: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.4rem;">
                <span class="tag">${escapeHtml(item.source)}</span>
                <span class="text-muted text-small">${dateStr}</span>
            </div>
            <p style="margin: 0; font-size: 14px; line-height: 1.7;">${escapeHtml(item.text)}</p>
        </div>`;
    }

    container.innerHTML = html;
}

function renderLessonDebrief() {
    const container = document.getElementById('lesson-debrief-content');
    if (!container) return;

    const lessons = studentData.lessonLogs || [];
    if (lessons.length === 0) {
        container.innerHTML = '<p class="text-muted">No lesson logs available yet.</p>';
        return;
    }

    let html = '';
    for (const l of lessons) {
        const dateStr = new Date(l.date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        html += `<div class="lesson-debrief-entry">
            <div class="practice-plan-letter">
                <p class="plan-date">${dateStr}${l.duration_minutes ? ' · ' + l.duration_minutes + ' min' : ''}</p>`;

        // SECTION 1: What We Worked On (repertoire + exercises with purpose and listening targets)
        const rep = typeof l.repertoire_worked === 'string' ? JSON.parse(l.repertoire_worked) : (l.repertoire_worked || []);
        const exercises = typeof l.exercises === 'string' ? JSON.parse(l.exercises || '[]') : (l.exercises || []);

        html += '<h3>What We Worked On</h3>';
        if (rep.length > 0) {
            html += '<ul>';
            for (const r of rep) {
                const title = typeof r === 'string' ? r.split(' — ')[0].split(' -- ')[0] : (r.title || r);
                html += `<li>${escapeHtml(typeof title === 'string' ? title : JSON.stringify(title))}</li>`;
            }
            html += '</ul>';
        }
        if (exercises.length > 0) {
            html += '<p style="margin-top: 0.75rem;"><strong>Exercises:</strong></p><ul>';
            for (const ex of exercises) {
                let desc = escapeHtml(ex.name || 'Unnamed');
                if (ex.functional_purpose) desc += ': ' + escapeHtml(ex.functional_purpose);
                else if (ex.pattern) desc += ': ' + escapeHtml(ex.pattern);
                html += `<li>${desc}</li>`;
            }
            html += '</ul>';
        }

        // SECTION 2: What Shifted (breakthroughs framed as wins)
        const shifted = l.breakthroughs || l.pivots;
        if (shifted) {
            html += `<h3>What Shifted</h3>`;
            html += markdownToHtml(shifted);
        }

        // SECTION 3: Where You Are (motor learning in plain language)
        if (l.motor_learning_phase) {
            html += `<h3>Where You Are</h3><p>${escapeHtml(l.motor_learning_phase)}</p>`;
        }

        // SECTION 4: What's Next
        const nextSteps = l.plan_for_next_lesson || l.next_steps;
        if (nextSteps) {
            html += `<h3>What's Next</h3>`;
            html += markdownToHtml(nextSteps);
        }

        html += `<p class="plan-signoff">Prof. G</p></div></div>`;
    }

    container.innerHTML = html;
}

function markdownToHtml(md) {
    // Process line by line for block elements
    const lines = md.split('\n');
    let html = '';
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];

        // Headings
        if (line.match(/^### (.+)$/)) {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<h3>' + escapeHtml(line.replace(/^### /, '')) + '</h3>';
            continue;
        }
        if (line.match(/^## (.+)$/)) {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<h2>' + escapeHtml(line.replace(/^## /, '')) + '</h2>';
            continue;
        }
        if (line.match(/^# (.+)$/)) {
            if (inList) { html += '</ul>'; inList = false; }
            // Skip the title heading (it's redundant with the page header)
            continue;
        }

        // List items
        if (line.match(/^- (.+)$/)) {
            if (!inList) { html += '<ul>'; inList = true; }
            let item = line.replace(/^- /, '');
            item = inlineFormat(item);
            html += '<li>' + item + '</li>';
            continue;
        }

        // Close list if we're no longer in one
        if (inList && !line.match(/^- /)) {
            html += '</ul>';
            inList = false;
        }

        // Empty line = paragraph break
        if (line.trim() === '') {
            continue;
        }

        // Italic line (whole line wrapped in *)
        if (line.match(/^\*([^*]+)\*$/)) {
            html += '<p class="plan-note">' + line.replace(/^\*/, '').replace(/\*$/, '') + '</p>';
            continue;
        }

        // Regular paragraph
        html += '<p>' + inlineFormat(line) + '</p>';
    }

    if (inList) html += '</ul>';
    return html;
}

function inlineFormat(text) {
    text = escapeHtml(text);
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Italic
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Inline code (for vowel notation etc.)
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
}

function renderPracticePlan() {
    const container = document.getElementById('practice-plan-content');
    if (!container) return;

    const plans = studentData.practicePlans;
    if (!plans || plans.length === 0) {
        container.innerHTML = '<p class="text-muted">No practice plan available yet. Check back after your next lesson.</p>';
        return;
    }

    const plan = plans[0];
    const dateStr = new Date(plan.date_generated).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const content = markdownToHtml(plan.content);

    container.innerHTML = `
        <div class="practice-plan-letter">
            <p class="plan-date">${dateStr}</p>
            ${content}
            <p class="plan-signoff">Prof. G</p>
        </div>
    `;
}

function renderReflectionPrompt() {
    const prompt = document.getElementById('reflection-prompt');
    if (!prompt) return;

    const plans = studentData.practicePlans;
    const reflections = studentData.reflections;

    // Show prompt if there's a practice plan
    if (!plans || plans.length === 0) {
        prompt.style.display = 'none';
        return;
    }

    const latestPlanDate = new Date(plans[0].date_generated);

    // Check if there's a reflection submitted after the latest plan
    const hasRecentReflection = reflections && reflections.some(r => {
        return new Date(r.date_submitted) > latestPlanDate;
    });

    if (hasRecentReflection) {
        prompt.style.display = 'none';
    } else {
        prompt.style.display = 'block';
    }
}

function renderPastPlans() {
    const container = document.getElementById('past-plans-content');
    if (!container) return;

    const plans = studentData.practicePlans;
    if (!plans || plans.length <= 1) {
        container.innerHTML = '<p class="text-muted">Past practice plans will appear here as your lessons accumulate.</p>';
        return;
    }

    // Skip the first (current) plan
    const pastPlans = plans.slice(1);
    let html = '';

    pastPlans.forEach((plan, index) => {
        const dateStr = new Date(plan.date_generated).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });

        // Extract a preview from the content (first meaningful paragraph)
        const lines = (plan.content || '').split('\n').filter(l => l.trim() && !l.startsWith('#'));
        const preview = lines.length > 0
            ? lines[0].replace(/\*\*/g, '').replace(/\*/g, '').substring(0, 120) + '...'
            : 'Practice plan';

        const planId = 'past-plan-' + index;

        html += `
            <div class="past-plan-summary" onclick="togglePastPlan('${planId}')">
                <div class="plan-summary-date">${dateStr}</div>
                <div class="plan-summary-preview">${escapeHtml(preview)}</div>
            </div>
            <div class="past-plan-expanded" id="${planId}">
                <div class="practice-plan-letter">
                    <p class="plan-date">${dateStr}</p>
                    ${markdownToHtml(plan.content || '')}
                    <p class="plan-signoff">Prof. G</p>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function togglePastPlan(id) {
    const el = document.getElementById(id);
    if (el) {
        el.classList.toggle('open');
    }
}

function renderRepertoire() {
    const container = document.getElementById('repertoire-content');
    if (!container) return;

    const phaseOptions = [
        ['translation_characterization', 'Translation + Characterization'],
        ['text_rhythm', 'Text + Rhythm'],
        ['melody_text_rhythm', 'Melody + Text + Rhythm'],
        ['characterization_integration', 'Characterization Integration'],
        ['memorization', 'Memorization'],
        ['performance_ready', 'Performance Ready'],
    ];

    const statusOptions = [
        ['assigned', 'Assigned'],
        ['in_progress', 'In Progress'],
        ['performance_ready', 'Performance Ready'],
        ['shelved', 'Shelved'],
    ];

    const rep = studentData.repertoire || [];
    const prevRep = studentData.previousRepertoire || [];

    // Jury plan data
    const juryPlan = studentData.juryPlan;
    const jurySels = studentData.jurySelections || [];
    const pk = studentData.student.program_key || programKeyFromDegree(studentData.student.degree_program);
    const jurySlots = (pk && JURY_REQUIREMENTS[pk]) ? JURY_REQUIREMENTS[pk] : [];
    const activeJurySels = jurySels.filter(s => s.status !== 'dropped');

    // Map: title (lowercase) → jury selection
    const juryByTitle = {};
    activeJurySels.forEach(s => { if (s.title) juryByTitle[s.title.toLowerCase()] = s; });

    let html = '';

    // Jury plan summary
    if (juryPlan) {
        const statusLabel = (juryPlan.status || 'planning').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const filledCount = activeJurySels.filter(s => s.status === 'accepted' || s.status === 'confirmed' || s.status === 'approved').length;
        const proposedCount = activeJurySels.filter(s => s.status === 'proposed').length;
        html += '<div style="font-size: 13px; color: var(--text-muted); margin-bottom: 1rem; padding: 0.75rem 1rem; background: var(--bg-warm, #f9f7f4); border-radius: 6px;">';
        html += '<strong>Jury:</strong> ' + escapeHtml(statusLabel);
        html += ' · ' + filledCount + '/' + jurySlots.length + ' slots filled';
        if (proposedCount > 0) html += ' · ' + proposedCount + ' pending';
        if (juryPlan.jury_date) {
            const jd = new Date(juryPlan.jury_date + 'T12:00:00');
            html += ' · ' + jd.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        }
        if (juryPlan.status === 'exempt') html += ' · ' + escapeHtml(juryPlan.exemption_reason || 'Exempt');
        html += '</div>';
    }

    if (rep.length === 0 && prevRep.length === 0 && activeJurySels.length === 0) {
        html += '<p class="text-muted">No repertoire tracked yet.</p>';
        container.innerHTML = html;
        return;
    }

    // Active repertoire table with jury column
    if (rep.length > 0 || activeJurySels.length > 0) {
        html += '<table><thead><tr><th>Piece</th><th>Learning Phase</th><th>Status</th><th>Sheet Music</th><th>Jury Slot</th></tr></thead><tbody>';

        const juryTitlesShown = new Set();

        for (const r of rep) {
            const jurySel = juryByTitle[(r.title || '').toLowerCase()];
            if (jurySel) juryTitlesShown.add(jurySel.id);

            const timeline = r.timeline
                ? new Date(r.timeline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '';

            // Phase dropdown
            let phaseSelect = `<select class="rep-phase-select" data-rep-id="${r.id}" style="font-size: 12px; padding: 0.2rem 0.4rem;">`;
            for (const [val, label] of phaseOptions) {
                phaseSelect += `<option value="${val}"${r.learning_phase === val ? ' selected' : ''}>${label}</option>`;
            }
            phaseSelect += '</select>';

            // Status dropdown
            let statusSelect = `<select class="rep-status-select" data-rep-id="${r.id}" style="font-size: 12px; padding: 0.2rem 0.4rem;">`;
            for (const [val, label] of statusOptions) {
                statusSelect += `<option value="${val}"${r.status === val ? ' selected' : ''}>${label}</option>`;
            }
            statusSelect += '</select>';

            // Sheet music link
            let sheetMusic = '';
            if (r.sheet_music_url) {
                if (/^https?:\/\//i.test(r.sheet_music_url)) {
                    sheetMusic = `<a href="${escapeHtml(r.sheet_music_url)}" target="_blank" class="btn btn-secondary btn-small" style="font-size: 11px;">View PDF</a>`;
                } else {
                    sheetMusic = `<span class="text-muted" style="font-size: 11px;">${escapeHtml(r.sheet_music_url)}</span>`;
                }
            } else {
                sheetMusic = `<button class="btn btn-secondary btn-small rep-add-link" data-rep-id="${r.id}" style="font-size: 11px;">+ Add Link</button>`;
            }

            // Jury slot column
            let juryCell = '';
            if (jurySel) {
                juryCell = `<span style="font-size: 11px;">${escapeHtml(jurySel.requirement_slot || '')}</span> `;
                if (jurySel.status === 'approved' || jurySel.status === 'accepted' || jurySel.status === 'confirmed') {
                    juryCell += '<span class="tag" style="font-size: 10px; background: rgba(90, 138, 90, 0.12); color: #5a8a5a;">Approved</span>';
                } else if (jurySel.status === 'proposed' && jurySel.proposed_by === 'teacher') {
                    juryCell += '<span class="tag" style="font-size: 10px; background: rgba(196, 154, 60, 0.15); color: #9a7a2a;">Proposed</span>';
                    juryCell += ` <button class="btn btn-primary btn-small btn-jury-accept" data-sel-id="${jurySel.id}" style="font-size: 10px; padding: 0.15rem 0.4rem;">Accept</button>`;
                } else if (jurySel.status === 'proposed' && jurySel.proposed_by === 'student') {
                    juryCell += '<span class="tag" style="font-size: 10px; background: rgba(196, 154, 60, 0.15); color: #9a7a2a;">Awaiting Prof. G</span>';
                }
            }

            html += `<tr>
                <td><strong>${escapeHtml(r.title)}</strong>${r.composer ? '<br><span class="text-muted text-small">' + escapeHtml(r.composer) + '</span>' : ''}</td>
                <td>${phaseSelect}</td>
                <td>${statusSelect}</td>
                <td>${sheetMusic}</td>
                <td>${juryCell}</td>
            </tr>`;
        }

        // Jury selections not yet in repertoire
        activeJurySels.filter(s => !juryTitlesShown.has(s.id)).forEach(sel => {
            let juryCell = `<span style="font-size: 11px;">${escapeHtml(sel.requirement_slot || '')}</span> `;
            if (sel.status === 'proposed' && sel.proposed_by === 'teacher') {
                juryCell += '<span class="tag" style="font-size: 10px; background: rgba(196, 154, 60, 0.15); color: #9a7a2a;">Proposed</span>';
                juryCell += ` <button class="btn btn-primary btn-small btn-jury-accept" data-sel-id="${sel.id}" style="font-size: 10px; padding: 0.15rem 0.4rem;">Accept</button>`;
            } else if (sel.status === 'proposed' && sel.proposed_by === 'student') {
                juryCell += '<span class="tag" style="font-size: 10px; background: rgba(196, 154, 60, 0.15); color: #9a7a2a;">Awaiting Prof. G</span>';
            }
            html += `<tr style="color: var(--text-muted); font-style: italic;">
                <td><strong>${escapeHtml(sel.title || '')}</strong>${sel.composer ? '<br><span class="text-small">' + escapeHtml(sel.composer) + '</span>' : ''}</td>
                <td></td><td></td><td></td>
                <td>${juryCell}</td>
            </tr>`;
        });

        // Unfilled jury slots
        if (juryPlan && juryPlan.status !== 'exempt') {
            const filledSlots = new Set(activeJurySels.map(s => s.requirement_slot));
            jurySlots.filter(slot => !filledSlots.has(slot)).forEach(slot => {
                html += `<tr style="color: var(--text-muted);">
                    <td colspan="4"></td>
                    <td><span style="font-size: 11px;">${escapeHtml(slot)}</span> <span style="font-size: 10px; font-style: italic;">unfilled</span></td>
                </tr>`;
            });
        }

        html += '</tbody></table>';
    }

    // Previous repertoire
    if (prevRep.length > 0) {
        html += '<h3 style="margin-top: 2rem;">Previous Repertoire</h3>';
        html += '<table><thead><tr><th>Piece</th><th>Status</th><th>Style</th></tr></thead><tbody>';
        for (const r of prevRep) {
            const statusLabel = 'Shelved';
            html += `<tr>
                <td>${escapeHtml(r.title)}${r.composer ? ' <span class="text-muted">(' + escapeHtml(r.composer) + ')</span>' : ''}</td>
                <td><span class="tag${r.status === 'performed' ? ' tag-success' : ''}">${statusLabel}</span></td>
                <td class="text-muted">${escapeHtml(r.style || '')}</td>
            </tr>`;
        }
        html += '</tbody></table>';
    }

    // Propose a jury piece form (if jury plan exists and not exempt)
    if (juryPlan && juryPlan.status !== 'exempt') {
        html += '<h3 style="margin-top: 2rem;">Propose a Jury Piece</h3>';
        html += '<form id="jury-student-propose-form" class="dash-add-rep">';
        html += '<div class="form-group"><label for="jury-s-slot">Requirement Slot</label>';
        html += '<select id="jury-s-slot">';
        jurySlots.forEach(s => { html += '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; });
        html += '</select></div>';
        html += '<div class="dash-rep-grid">';
        html += '<div class="form-group"><label for="jury-s-title">Title</label><input type="text" id="jury-s-title" required placeholder="Song or aria title"></div>';
        html += '<div class="form-group"><label for="jury-s-composer">Composer</label><input type="text" id="jury-s-composer" placeholder="Composer name"></div>';
        html += '</div>';
        html += '<div class="form-group"><label for="jury-s-notes">Notes <span class="hint">(optional)</span></label><input type="text" id="jury-s-notes" placeholder="Why this piece, or other context"></div>';
        html += '<button type="submit" class="btn btn-primary btn-small">Propose to Prof. G</button>';
        html += '</form>';
    }

    // Dropped jury selections
    const droppedSels = jurySels.filter(s => s.status === 'dropped');
    if (droppedSels.length > 0) {
        html += '<h3 style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--text-muted);">Dropped Jury Selections</h3>';
        droppedSels.forEach(sel => {
            html += '<p style="text-decoration: line-through; color: var(--text-muted); font-size: 13px;">';
            html += escapeHtml(sel.requirement_slot) + ': ' + escapeHtml(sel.title || '');
            if (sel.composer) html += ' (' + escapeHtml(sel.composer) + ')';
            html += '</p>';
        });
    }

    container.innerHTML = html;

    // Attach change handlers for phase and status dropdowns
    container.querySelectorAll('.rep-phase-select').forEach(select => {
        select.addEventListener('change', async () => {
            const repId = select.dataset.repId;
            const newPhase = select.value;
            await updateRepertoireField(repId, 'learning_phase', newPhase);
        });
    });

    container.querySelectorAll('.rep-status-select').forEach(select => {
        select.addEventListener('change', async () => {
            const repId = select.dataset.repId;
            const newStatus = select.value;
            await updateRepertoireField(repId, 'status', newStatus);
            if (newStatus === 'shelved') {
                await loadStudentData();
                renderRepertoire();
            }
        });
    });

    // Sheet music link buttons
    container.querySelectorAll('.rep-add-link').forEach(btn => {
        btn.addEventListener('click', async () => {
            const repId = btn.dataset.repId;
            const url = prompt('Paste a link to the sheet music (Google Drive, Dropbox, etc.):');
            if (url && url.trim()) {
                if (!/^https?:\/\//i.test(url.trim())) {
                    alert('Please enter a valid URL starting with http:// or https://');
                    return;
                }
                await updateRepertoireField(repId, 'sheet_music_url', url.trim());
                await loadStudentData();
                renderRepertoire();
            }
        });
    });

    // Jury accept buttons
    container.querySelectorAll('.btn-jury-accept').forEach(btn => {
        btn.addEventListener('click', async () => {
            const selId = btn.dataset.selId;
            btn.disabled = true;
            btn.textContent = 'Accepting...';
            const { error } = await sb.from('jury_selections').update({ status: 'accepted' }).eq('id', selId);
            if (error) {
                alert('Error accepting piece: ' + error.message);
                btn.disabled = false;
                btn.textContent = 'Accept';
                return;
            }
            await loadStudentData();
            renderRepertoire();
        });
    });

    // Jury propose form
    const juryForm = document.getElementById('jury-student-propose-form');
    if (juryForm && !juryForm.dataset.bound) {
        juryForm.dataset.bound = 'true';
        juryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser || !studentData.juryPlan) return;

            const title = document.getElementById('jury-s-title').value.trim();
            const composer = document.getElementById('jury-s-composer').value.trim();
            const slot = document.getElementById('jury-s-slot').value;
            const notes = document.getElementById('jury-s-notes').value.trim();

            if (!title) return;

            const btn = juryForm.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            const { error } = await sb.from('jury_selections').insert({
                jury_plan_id: studentData.juryPlan.id,
                requirement_slot: slot,
                title: title,
                composer: composer || null,
                proposed_by: 'student',
                status: 'proposed',
                notes: notes || null
            });

            if (error) {
                alert('Error proposing piece: ' + error.message);
                btn.disabled = false;
                btn.textContent = 'Propose to Prof. G';
                return;
            }

            juryForm.reset();
            btn.disabled = false;
            btn.textContent = 'Propose to Prof. G';
            await loadStudentData();
            renderRepertoire();
        });
    }
}

async function updateRepertoireField(repId, field, value) {
    const { error } = await sb
        .from('repertoire')
        .update({ [field]: value })
        .eq('id', repId)
        .eq('student_id', currentUser.id);

    if (error) {
        alert('Error updating: ' + error.message);
    }
}

function renderRecentReflections() {
    const container = document.getElementById('reflections-content');
    if (!container) return;

    const reflections = studentData.reflections;
    if (!reflections || reflections.length === 0) {
        container.innerHTML = '<p class="text-muted">No reflections submitted yet.</p>';
        return;
    }

    let html = '';
    for (const r of reflections.slice(0, 3)) {
        const dateStr = new Date(r.date_submitted).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric'
        });
        html += `<div class="card">
            <p class="card-date">${dateStr}</p>
            <p><strong>Focus:</strong> ${escapeHtml(r.practice_focus || 'Not specified')}</p>
            <p><strong>Voice feeling:</strong> ${r.voice_feeling || '-'}/10 |
               <strong>Confidence:</strong> ${r.artistic_confidence || '-'}/10 |
               <strong>Engagement:</strong> ${r.engagement || '-'}/10</p>
            ${r.wins ? '<p><strong>Wins:</strong> ' + escapeHtml(r.wins) + '</p>' : ''}
        </div>`;
    }
    container.innerHTML = html;
}

function renderStudioFeedback() {
    const container = document.getElementById('studio-feedback-content');
    if (!container) return;

    const feedback = studentData.studioFeedback;
    if (!feedback || feedback.length === 0) {
        container.innerHTML = '<p class="text-muted">No studio class feedback yet.</p>';
        return;
    }

    let html = '';
    for (const f of feedback) {
        const dateStr = new Date(f.studio_class_date).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric'
        });
        html += `<div class="card">
            <p class="card-title">${dateStr}</p>
            ${f.repertoire_performed ? '<p><strong>Performed:</strong> ' + escapeHtml(f.repertoire_performed) + '</p>' : ''}
            ${f.kayla_feedback ? '<p>' + escapeHtml(f.kayla_feedback) + '</p>' : ''}
            ${f.connections_to_technical_work ? '<p class="text-muted">' + escapeHtml(f.connections_to_technical_work) + '</p>' : ''}
        </div>`;
    }
    container.innerHTML = html;
}

// ============================================================
// PROGRESS PAGE
// ============================================================

function renderProgress() {
    const container = document.getElementById('progress-content');
    if (!container || !studentData) return;

    const acoustics = studentData.acoustics;
    if (!acoustics || acoustics.length === 0) {
        container.innerHTML = '<p class="text-muted">No acoustic assessments recorded yet. Your progress will appear here after your first voice assessment session.</p>';
        return;
    }

    // Build summary metrics
    const sv = acoustics.filter(a => a.task_type === 'sv');
    if (sv.length === 0) {
        container.innerHTML = '<p class="text-muted">Acoustic data available but no sustained vowel assessments yet.</p>';
        return;
    }

    const latest = sv[sv.length - 1];
    const first = sv[0];

    let metricsHtml = '<div class="metric-grid">';

    if (latest.f0_range_st) {
        const trend = sv.length > 1 && first.f0_range_st
            ? (latest.f0_range_st - first.f0_range_st).toFixed(1)
            : null;
        metricsHtml += renderMetricCard(
            latest.f0_range_st.toFixed(1) + ' st',
            'Pitch Range',
            trend ? (trend > 0 ? '+' + trend + ' st' : trend + ' st') : null,
            trend > 0
        );
    }

    if (latest.intensity_range) {
        const trend = sv.length > 1 && first.intensity_range
            ? (latest.intensity_range - first.intensity_range).toFixed(1)
            : null;
        metricsHtml += renderMetricCard(
            latest.intensity_range.toFixed(1) + ' dB',
            'Dynamic Range',
            trend ? (trend > 0 ? '+' + trend + ' dB' : trend + ' dB') : null,
            trend > 0
        );
    }

    if (latest.hnr) {
        const trend = sv.length > 1 && first.hnr
            ? (latest.hnr - first.hnr).toFixed(1)
            : null;
        metricsHtml += renderMetricCard(
            latest.hnr.toFixed(1) + ' dB',
            'Voice Clarity (HNR)',
            trend ? (trend > 0 ? '+' + trend + ' dB' : trend + ' dB') : null,
            trend > 0
        );
    }

    metricsHtml += '</div>';

    // Plotly chart placeholder
    metricsHtml += '<div id="progress-chart" style="margin-top: 2rem;"></div>';

    container.innerHTML = metricsHtml;

    // Render Plotly chart if available
    if (typeof Plotly !== 'undefined' && sv.length > 1) {
        renderProgressChart(sv);
    }
}

function renderMetricCard(value, label, trend, isPositive) {
    let trendHtml = '';
    if (trend) {
        const cls = isPositive ? 'trend-up' : 'trend-down';
        trendHtml = `<div class="metric-trend ${cls}">${trend}</div>`;
    }
    return `<div class="metric-card">
        <div class="metric-value">${value}</div>
        <div class="metric-label">${label}</div>
        ${trendHtml}
    </div>`;
}

function renderProgressChart(sv) {
    const dates = sv.map(s => s.date);
    const traces = [];

    if (sv[0].f0_range_st !== null) {
        traces.push({
            x: dates,
            y: sv.map(s => s.f0_range_st),
            name: 'Pitch Range (st)',
            type: 'scatter',
            mode: 'lines+markers',
        });
    }

    if (sv[0].hnr !== null) {
        traces.push({
            x: dates,
            y: sv.map(s => s.hnr),
            name: 'HNR (dB)',
            type: 'scatter',
            mode: 'lines+markers',
            yaxis: 'y2',
        });
    }

    const layout = {
        font: { family: 'Inter, sans-serif', size: 12 },
        margin: { t: 30, b: 40, l: 50, r: 50 },
        height: 350,
        yaxis: { title: 'Pitch Range (st)' },
        yaxis2: { title: 'HNR (dB)', overlaying: 'y', side: 'right' },
        legend: { orientation: 'h', y: -0.15 },
        template: 'plotly_white',
    };

    Plotly.newPlot('progress-chart', traces, layout, { responsive: true });
}

// ============================================================
// REFLECTION FORM
// ============================================================

async function handleReflectionSubmit(event) {
    event.preventDefault();

    if (!currentUser) {
        alert('You must be logged in to submit a reflection. Please refresh and log in again.');
        return;
    }

    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        // Collect vocal load entries
        const vocalLoad = [];
        document.querySelectorAll('.vocal-load-entry').forEach(entry => {
            const activity = entry.querySelector('[name="vl-activity"]')?.value;
            const duration = entry.querySelector('[name="vl-duration"]')?.value;
            const intensity = entry.querySelector('[name="vl-intensity"]')?.value;
            const fatigue = entry.querySelector('[name="vl-fatigue"]')?.value;
            if (activity) {
                vocalLoad.push({
                    activity,
                    duration_minutes: parseInt(duration) || null,
                    intensity,
                    fatigue_noticed: fatigue === 'yes',
                });
            }
        });

        // Collect repertoire progress
        const repProgress = [];
        document.querySelectorAll('.rep-progress-entry').forEach(entry => {
            const title = entry.querySelector('[name="rep-title"]')?.value;
            const phase = entry.querySelector('[name="rep-phase"]')?.value;
            const notes = entry.querySelector('[name="rep-notes"]')?.value;
            if (title) {
                repProgress.push({ title, current_phase: phase, notes });
            }
        });

        const reflection = {
            student_id: currentUser.id,
            practice_focus: form.querySelector('#practice-focus')?.value || null,
            self_observations: form.querySelector('#self-observations')?.value || null,
            fatigue_notes: form.querySelector('#fatigue-notes')?.value || null,
            vocal_load: vocalLoad,
            voice_feeling: parseInt(form.querySelector('#voice-feeling')?.value) || null,
            artistic_confidence: parseInt(form.querySelector('#artistic-confidence')?.value) || null,
            engagement: parseInt(form.querySelector('#engagement')?.value) || null,
            repertoire_progress: repProgress,
            questions: form.querySelector('#questions')?.value || null,
            wins: form.querySelector('#wins')?.value || null,
        };

        console.log('[VS] Submitting reflection for', currentUser.id);

        const { data, error } = await sb
            .from('reflections')
            .insert(reflection)
            .select();

        if (error) {
            console.error('[VS] Reflection insert error:', error);
            alert('Error submitting reflection: ' + error.message);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Reflection';
            return;
        }

        console.log('[VS] Reflection submitted:', data);

        // Success
        form.reset();
        document.querySelectorAll('#reflection-form input[type="range"]').forEach(input => {
            const display = document.getElementById(input.id + '-value');
            if (display) display.textContent = '5';
            input.value = 5;
        });

        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Reflection';

        // Show confirmation
        const msg = document.createElement('div');
        msg.className = 'card';
        msg.style.borderLeftColor = 'var(--success-color)';
        msg.innerHTML = '<p><strong>Reflection submitted.</strong> Your input will be part of your next pre-lesson brief.</p>';
        form.parentNode.insertBefore(msg, form);
        setTimeout(() => msg.remove(), 5000);

        // Reload data
        try {
            await loadStudentData();
        } catch (err) {
            console.error('[VS] Reload after reflection failed:', err);
        }
    } catch (err) {
        console.error('[VS] Reflection submission error:', err);
        alert('Something went wrong submitting your reflection. Please try again, or let Prof. G know.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Reflection';
    }
}

function addVocalLoadEntry() {
    const container = document.getElementById('vocal-load-entries');
    const entry = document.createElement('div');
    entry.className = 'vocal-load-entry';
    entry.innerHTML = `
        <div class="form-group">
            <label>Activity</label>
            <input type="text" name="vl-activity" placeholder="Choir rehearsal, show, practice...">
        </div>
        <div class="form-group">
            <label>Duration (min)</label>
            <input type="number" name="vl-duration" min="0">
        </div>
        <div class="form-group">
            <label>Intensity</label>
            <select name="vl-intensity">
                <option value="low">Low</option>
                <option value="moderate" selected>Moderate</option>
                <option value="high">High</option>
                <option value="very_demanding">Very demanding</option>
            </select>
        </div>
        <div class="form-group">
            <label>Fatigue?</label>
            <select name="vl-fatigue">
                <option value="no">No</option>
                <option value="yes">Yes</option>
            </select>
        </div>
    `;
    container.appendChild(entry);
}

// ============================================================
// SETTINGS / PASSWORD CHANGE
// ============================================================

function showSettings() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-settings').classList.add('active');
    setupPasswordForm();
}

function setupPasswordForm() {
    const form = document.getElementById('change-password-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = 'true';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPw = document.getElementById('current-password').value;
        const newPw = document.getElementById('new-password').value;
        const confirmPw = document.getElementById('confirm-password').value;
        const msgEl = document.getElementById('password-message');
        const btn = form.querySelector('button[type="submit"]');

        msgEl.style.display = 'none';

        if (newPw !== confirmPw) {
            msgEl.textContent = 'New passwords do not match.';
            msgEl.style.color = 'var(--error-color)';
            msgEl.style.display = 'block';
            return;
        }

        if (newPw.length < 8) {
            msgEl.textContent = 'Password must be at least 8 characters.';
            msgEl.style.color = 'var(--error-color)';
            msgEl.style.display = 'block';
            return;
        }

        btn.textContent = 'Updating...';
        btn.disabled = true;

        // Verify current password by re-authenticating
        const email = currentUser.email;
        const { error: authError } = await sb.auth.signInWithPassword({
            email: email,
            password: currentPw,
        });

        if (authError) {
            msgEl.textContent = 'Current password is incorrect.';
            msgEl.style.color = 'var(--error-color)';
            msgEl.style.display = 'block';
            btn.textContent = 'Update Password';
            btn.disabled = false;
            return;
        }

        // Update password
        const { error: updateError } = await sb.auth.updateUser({
            password: newPw,
        });

        if (updateError) {
            msgEl.textContent = 'Error updating password: ' + updateError.message;
            msgEl.style.color = 'var(--error-color)';
            msgEl.style.display = 'block';
        } else {
            msgEl.textContent = 'Password updated successfully.';
            msgEl.style.color = 'var(--success-color)';
            msgEl.style.display = 'block';
            form.reset();
        }

        btn.textContent = 'Update Password';
        btn.disabled = false;
    });
}

// ============================================================
// REPERTOIRE FORM
// ============================================================

function setupRepForm() {
    const form = document.getElementById('add-rep-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = 'true';

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const title = document.getElementById('rep-title').value.trim();
        const composer = document.getElementById('rep-composer').value.trim();
        const style = document.getElementById('rep-style').value;
        const sheetMusic = document.getElementById('rep-sheet-music')?.value.trim();

        if (!title) return;

        const record = {
            student_id: currentUser.id,
            title: title,
            composer: composer || null,
            style: style || null,
            status: 'in_progress',
            assignment_type: 'short_term',
        };
        if (sheetMusic) record.sheet_music_url = sheetMusic;

        const { data, error } = await sb
            .from('repertoire')
            .insert(record);

        if (error) {
            alert('Error adding piece: ' + error.message);
            return;
        }

        form.reset();
        await loadStudentData();
        renderRepertoire();
    });
}

// ============================================================
// STUDIO CLASS PLAN (in student dashboard)
// ============================================================

function renderStudioClassPlan() {
    const container = document.getElementById('studio-class-plan');
    if (!container || !studentData) return;

    const plans = studentData.studioPlans || [];
    const todayStr = new Date().toLocaleDateString('en-CA');
    const nextPlan = plans.find(p => p.studio_class_date >= todayStr);

    if (!nextPlan) {
        container.innerHTML = '<p class="text-muted">No upcoming studio class scheduled.</p>';
        return;
    }

    const d = new Date(nextPlan.studio_class_date + 'T12:00:00');
    const dateStr = d.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric'
    });

    const lineup = typeof nextPlan.lineup === 'string'
        ? JSON.parse(nextPlan.lineup) : (nextPlan.lineup || []);
    lineup.sort((a, b) => (a.order || 0) - (b.order || 0));

    // Find this student in the lineup
    const myEntry = lineup.find(e => e.student_id === currentUser.id);
    const myRep = myEntry ? (myEntry.repertoire || []) : [];

    let html = `
        <div class="card">
            <p class="card-title">${dateStr}</p>
            <p class="text-small">${escapeHtml(nextPlan.time || '')} · ${escapeHtml(nextPlan.location || '')}</p>

            <h3 style="margin-top: 1rem;">Lineup</h3>
            <table style="width: 100%; font-size: 14px;">
    `;

    lineup.forEach(entry => {
        const isMe = entry.student_id === currentUser.id;
        const rep = entry.repertoire || [];
        const repStr = rep.length > 0
            ? rep.map(r => escapeHtml(r.title || r) + (r.composer ? ' (' + escapeHtml(r.composer) + ')' : '')).join(', ')
            : '<span class="text-muted">Not yet selected</span>';

        html += `<tr style="${isMe ? 'font-weight: 500;' : ''}">
            <td style="padding: 0.4rem 0; width: 30px;">${entry.order || ''}</td>
            <td style="padding: 0.4rem 0.5rem;">${escapeHtml(entry.student_name)}${isMe ? ' (you)' : ''}</td>
            <td style="padding: 0.4rem 0;">${repStr}</td>
        </tr>`;
    });

    html += '</table>';

    // If this student hasn't selected rep yet, show selector
    if (myEntry && myRep.length === 0) {
        html += `
            <h3 style="margin-top: 1rem;">Select Your Repertoire</h3>
            <p class="text-small text-muted">Choose what you'll sing at studio class.</p>
            <form id="studio-rep-form">
                <div class="form-group">
                    <label for="studio-rep-select">Piece</label>
                    <select id="studio-rep-select">
                        <option value="">Choose from your repertoire...</option>
        `;

        const myRepertoire = studentData.repertoire || [];
        myRepertoire.forEach(r => {
            html += `<option value="${escapeHtml(r.id)}" data-title="${escapeHtml(r.title)}" data-composer="${escapeHtml(r.composer || '')}">${escapeHtml(r.title)}${r.composer ? ' (' + escapeHtml(r.composer) + ')' : ''}</option>`;
        });

        html += `
                        <option value="__new__">+ Add a new piece...</option>
                    </select>
                </div>
                <div id="studio-new-piece" style="display: none;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                        <div class="form-group">
                            <label for="studio-new-title">Title</label>
                            <input type="text" id="studio-new-title">
                        </div>
                        <div class="form-group">
                            <label for="studio-new-composer">Composer</label>
                            <input type="text" id="studio-new-composer">
                        </div>
                    </div>
                </div>
                <button type="submit" class="btn btn-primary btn-small">Confirm Selection</button>
            </form>
        `;
    }

    html += '</div>';

    // View full plan link
    html += `<p style="margin-top: 0.75rem;"><a href="studio-class.html" target="_blank" class="text-small">View full studio class plan</a></p>`;

    container.innerHTML = html;

    // Set up rep select handler
    const select = document.getElementById('studio-rep-select');
    if (select) {
        select.addEventListener('change', () => {
            const newPiece = document.getElementById('studio-new-piece');
            if (newPiece) {
                newPiece.style.display = select.value === '__new__' ? 'block' : 'none';
            }
        });
    }

    // Set up form submission
    const form = document.getElementById('studio-rep-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await submitStudioRep(nextPlan, myEntry);
        });
    }
}

async function submitStudioRep(plan, myEntry) {
    const select = document.getElementById('studio-rep-select');
    if (!select) return;

    let title, composer;

    if (select.value === '__new__') {
        title = document.getElementById('studio-new-title').value.trim();
        composer = document.getElementById('studio-new-composer').value.trim();
        if (!title) { alert('Please enter a title.'); return; }

        // Add to student's repertoire
        await sb.from('repertoire').insert({
            student_id: currentUser.id,
            title: title,
            composer: composer || null,
            status: 'in_progress',
            assignment_type: 'short_term',
        });
    } else if (select.value) {
        const opt = select.selectedOptions[0];
        title = opt.dataset.title;
        composer = opt.dataset.composer;
    } else {
        alert('Please select a piece.');
        return;
    }

    // Update only this student's lineup entry via secure RPC function
    const rep = JSON.stringify([{ title, composer: composer || '' }]);
    const { error } = await sb.rpc('update_my_lineup_entry', {
        plan_id: plan.id,
        rep: rep,
    });

    if (error) {
        alert('Error saving selection: ' + error.message);
        return;
    }

    await loadStudentData();
    renderStudioClassPlan();
}

// ============================================================
// UTILITIES
// ============================================================

// ============================================================
// JURY PLAN (Student Portal)
// ============================================================

function renderJuryPlan() {
    const container = document.getElementById('jury-plan-content');
    if (!container || !studentData) return;

    const juryPlan = studentData.juryPlan;
    const sels = studentData.jurySelections || [];
    const pk = studentData.student.program_key || programKeyFromDegree(studentData.student.degree_program);
    const slots = (pk && JURY_REQUIREMENTS[pk]) ? JURY_REQUIREMENTS[pk] : [];

    if (!juryPlan) {
        container.innerHTML = '<p class="text-muted">No jury plan has been created yet. Contact Prof. G if you have questions about your jury requirements.</p>';
        return;
    }

    const statusLabel = (juryPlan.status || 'planning').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    let html = '<p style="font-size: 14px; margin-bottom: 1rem;">';
    html += '<strong>Status:</strong> ' + escapeHtml(statusLabel);
    if (juryPlan.jury_date) {
        const jd = new Date(juryPlan.jury_date + 'T12:00:00');
        html += ' · <strong>Jury Date:</strong> ' + jd.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
    if (juryPlan.status === 'exempt' && juryPlan.exemption_reason) {
        html += ' · ' + escapeHtml(juryPlan.exemption_reason);
    }
    html += '</p>';

    if (juryPlan.status === 'exempt') {
        container.innerHTML = html;
        return;
    }

    // Requirements table
    const activeSelections = sels.filter(s => s.status !== 'dropped');
    const droppedSelections = sels.filter(s => s.status === 'dropped');

    html += '<table><thead><tr><th>Requirement</th><th>Piece</th><th>Composer</th><th>Status</th></tr></thead><tbody>';

    slots.forEach(slot => {
        const matching = activeSelections.filter(s => s.requirement_slot === slot);
        if (matching.length === 0) {
            html += '<tr><td>' + escapeHtml(slot) + '</td><td colspan="3" class="text-muted">No selection yet</td></tr>';
        } else {
            matching.forEach(sel => {
                html += '<tr>';
                html += '<td>' + escapeHtml(slot) + '</td>';
                html += '<td><strong>' + escapeHtml(sel.title || '') + '</strong></td>';
                html += '<td>' + escapeHtml(sel.composer || '') + '</td>';
                html += '<td>';
                if (sel.status === 'approved') {
                    html += '<span class="tag" style="background: rgba(90, 138, 90, 0.12); color: #5a8a5a;">Approved</span>';
                } else if (sel.status === 'proposed' && sel.proposed_by === 'teacher') {
                    html += '<span class="tag" style="background: rgba(196, 154, 60, 0.15); color: #9a7a2a;">Proposed by Prof. G</span>';
                    html += ' <button class="btn btn-primary btn-small btn-jury-accept" data-sel-id="' + sel.id + '" style="font-size: 11px; padding: 0.2rem 0.5rem; margin-left: 0.35rem;">Accept</button>';
                } else if (sel.status === 'proposed' && sel.proposed_by === 'student') {
                    html += '<span class="tag" style="background: rgba(196, 154, 60, 0.15); color: #9a7a2a;">Awaiting Prof. G</span>';
                }
                html += '</td></tr>';
            });
        }
    });

    html += '</tbody></table>';

    // Dropped pieces
    if (droppedSelections.length > 0) {
        html += '<h3 style="margin-top: 1.5rem; font-size: 0.9rem; color: var(--text-muted);">Dropped</h3>';
        droppedSelections.forEach(sel => {
            html += '<p style="text-decoration: line-through; color: var(--text-muted); font-size: 13px;">';
            html += escapeHtml(sel.requirement_slot) + ': ' + escapeHtml(sel.title || '');
            if (sel.composer) html += ' (' + escapeHtml(sel.composer) + ')';
            html += '</p>';
        });
    }

    // Propose a piece form
    html += '<h3 style="margin-top: 2rem;">Propose a Piece</h3>';
    html += '<form id="jury-student-propose-form" class="dash-add-rep">';
    html += '<div class="form-group"><label for="jury-s-slot">Requirement Slot</label>';
    html += '<select id="jury-s-slot">';
    slots.forEach(s => { html += '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>'; });
    html += '</select></div>';
    html += '<div class="dash-rep-grid">';
    html += '<div class="form-group"><label for="jury-s-title">Title</label><input type="text" id="jury-s-title" required placeholder="Song or aria title"></div>';
    html += '<div class="form-group"><label for="jury-s-composer">Composer</label><input type="text" id="jury-s-composer" placeholder="Composer name"></div>';
    html += '</div>';
    html += '<div class="form-group"><label for="jury-s-notes">Notes <span class="hint">(optional)</span></label><input type="text" id="jury-s-notes" placeholder="Why this piece, or other context"></div>';
    html += '<button type="submit" class="btn btn-primary btn-small">Propose to Prof. G</button>';
    html += '</form>';

    container.innerHTML = html;

    // Bind form submit
    const form = document.getElementById('jury-student-propose-form');
    if (form && !form.dataset.bound) {
        form.dataset.bound = 'true';
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!currentUser || !studentData.juryPlan) return;

            const title = document.getElementById('jury-s-title').value.trim();
            const composer = document.getElementById('jury-s-composer').value.trim();
            const slot = document.getElementById('jury-s-slot').value;
            const notes = document.getElementById('jury-s-notes').value.trim();

            if (!title) return;

            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            const { error } = await sb.from('jury_selections').insert({
                jury_plan_id: studentData.juryPlan.id,
                requirement_slot: slot,
                title: title,
                composer: composer || null,
                proposed_by: 'student',
                status: 'proposed',
                notes: notes || null
            });

            if (error) {
                alert('Error proposing piece: ' + error.message);
                btn.disabled = false;
                btn.textContent = 'Propose to Prof. G';
                return;
            }

            form.reset();
            btn.disabled = false;
            btn.textContent = 'Propose to Prof. G';

            // Reload data and re-render
            await loadStudentData();
            renderJuryPlan();
        });
    }

    // Bind accept buttons
    container.querySelectorAll('.btn-jury-accept').forEach(btn => {
        btn.addEventListener('click', async () => {
            const selId = btn.dataset.selId;
            btn.disabled = true;
            btn.textContent = 'Accepting...';

            const { error } = await sb.from('jury_selections')
                .update({ status: 'approved' })
                .eq('id', selId);

            if (error) {
                alert('Error: ' + error.message);
                btn.disabled = false;
                btn.textContent = 'Accept';
                return;
            }

            // Reload and re-render
            await loadStudentData();
            renderJuryPlan();
        });
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ============================================================
// INIT
// ============================================================

document.addEventListener('DOMContentLoaded', initApp);
