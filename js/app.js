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
            await loadStudentData();
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
                await loadStudentData();
                showDashboard();
            }
        } else if (event === 'SIGNED_OUT') {
            currentUser = null;
            studentData = null;
            showLogin();
        }
    });

    // Set up navigation
    setupNavigation();
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

    // Load lesson logs (student-visible fields)
    const { data: lessonLogs } = await sb
        .from('lesson_logs')
        .select('id, date, duration_minutes, repertoire_worked, head_observations, heart_observations, hand_observations, warmth_brightness_notes, ease_assessment, breakthroughs, next_steps, plan_for_next_lesson, exercise_categories_addressed')
        .eq('student_id', currentUser.id)
        .order('date', { ascending: false })
        .limit(10);

    studentData.lessonLogs = lessonLogs || [];

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
}

// ============================================================
// PAGE RENDERING
// ============================================================

function showLogin() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-login').classList.add('active');
    document.getElementById('nav-authenticated').style.display = 'none';
}

function showDashboard() {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById('page-dashboard').classList.add('active');
    document.getElementById('nav-authenticated').style.display = 'flex';

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
    // NEXT LESSON (from events) + LATEST LESSON (from logs)
    const events = studentData.events || [];
    const todayStr = new Date().toISOString().split('T')[0];
    const nextLesson = events.find(e =>
        e.date >= todayStr && e.title && e.title.includes('Voice Lesson')
    );
    if (nextLesson) {
        const d = new Date(nextLesson.date + 'T12:00:00');
        document.getElementById('dash-lesson-date').textContent =
            d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        document.getElementById('dash-lesson-summary').textContent =
            nextLesson.notes || 'Scheduled';
    } else {
        // Fall back to most recent lesson log
        const lessons = studentData.lessonLogs || [];
        if (lessons.length > 0) {
            const l = lessons[0];
            const d = new Date(l.date + 'T12:00:00');
            document.getElementById('dash-lesson-date').textContent =
                'Last: ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const rep = typeof l.repertoire_worked === 'string' ? JSON.parse(l.repertoire_worked) : (l.repertoire_worked || []);
            document.getElementById('dash-lesson-summary').textContent =
                rep.length > 0 ? rep.map(r => r.split('—')[0].split('(')[0].trim()).join(', ') : 'Lesson recorded';
        } else {
            document.getElementById('dash-lesson-date').textContent = '--';
            document.getElementById('dash-lesson-summary').textContent = 'No lessons scheduled';
        }
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

    // Find next lesson date to calculate reflection due date (day before)
    const events = studentData.events || [];
    const todayStr = new Date().toISOString().split('T')[0];
    const nextLessonEvent = events.find(e =>
        e.date >= todayStr && e.title && e.title.includes('Voice Lesson')
    );

    let reflectionDueStr = '';
    if (nextLessonEvent) {
        const lessonDate = new Date(nextLessonEvent.date + 'T12:00:00');
        const dueDate = new Date(lessonDate);
        dueDate.setDate(dueDate.getDate() - 1);
        reflectionDueStr = dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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
            'Submit before your next lesson';
    }

    // REPERTOIRE
    const rep = studentData.repertoire || [];
    document.getElementById('dash-rep-count').textContent =
        rep.length > 0 ? rep.length + ' pieces' : '--';
    if (rep.length > 0) {
        const nearest = rep.filter(r => r.timeline).sort((a, b) => a.timeline.localeCompare(b.timeline))[0];
        document.getElementById('dash-rep-summary').textContent =
            nearest ? 'Next: ' + new Date(nearest.timeline + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    } else {
        document.getElementById('dash-rep-summary').textContent = 'No repertoire tracked yet';
    }

    // VOCAL PROGRESS
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
            document.getElementById('dash-progress-value').textContent = '--';
            document.getElementById('dash-progress-summary').textContent = 'No assessments yet';
        }
    } else {
        document.getElementById('dash-progress-value').textContent = '--';
        document.getElementById('dash-progress-summary').textContent = 'Assessments will appear here';
    }

    // STUDIO CLASS — show next upcoming studio class
    const studioPlans = studentData.studioPlans || [];
    const today = new Date().toISOString().split('T')[0];
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
    else if (panelId === 'detail-studio') { renderStudioFeedback(); renderStudioClassPlan(); }
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

        const rep = typeof l.repertoire_worked === 'string' ? JSON.parse(l.repertoire_worked) : (l.repertoire_worked || []);

        html += `<div class="lesson-debrief-entry">
            <div class="practice-plan-letter">
                <p class="plan-date">${dateStr}${l.duration_minutes ? ' · ' + l.duration_minutes + ' min' : ''}</p>`;

        if (rep.length > 0) {
            html += '<h3>What We Worked On</h3><ul>';
            for (const r of rep) html += `<li>${escapeHtml(r)}</li>`;
            html += '</ul>';
        }

        if (l.head_observations || l.heart_observations || l.hand_observations) {
            html += '<h3>Observations</h3>';
            if (l.head_observations) html += `<p><strong>Intention + Learning:</strong> ${escapeHtml(l.head_observations)}</p>`;
            if (l.heart_observations) html += `<p><strong>Expression:</strong> ${escapeHtml(l.heart_observations)}</p>`;
            if (l.hand_observations) html += `<p><strong>Function:</strong> ${escapeHtml(l.hand_observations)}</p>`;
        }

        if (l.warmth_brightness_notes) {
            html += `<h3>Warmth + Brightness</h3><p>${escapeHtml(l.warmth_brightness_notes)}</p>`;
        }

        if (l.breakthroughs) {
            html += `<h3>Breakthroughs</h3><p>${escapeHtml(l.breakthroughs)}</p>`;
        }

        if (l.plan_for_next_lesson) {
            html += `<h3>Plan for Next Lesson</h3><p>${escapeHtml(l.plan_for_next_lesson)}</p>`;
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
            html += '<h3>' + line.replace(/^### /, '') + '</h3>';
            continue;
        }
        if (line.match(/^## (.+)$/)) {
            if (inList) { html += '</ul>'; inList = false; }
            html += '<h2>' + line.replace(/^## /, '') + '</h2>';
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

    if (rep.length === 0 && prevRep.length === 0) {
        container.innerHTML = '<p class="text-muted">No repertoire tracked yet.</p>';
        return;
    }

    let html = '';

    // Active repertoire
    if (rep.length > 0) {
        html += '<table><thead><tr><th>Piece</th><th>Learning Phase</th><th>Status</th><th>Due</th></tr></thead><tbody>';
        for (const r of rep) {
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

            html += `<tr>
                <td><strong>${escapeHtml(r.title)}</strong>${r.composer ? '<br><span class="text-muted text-small">' + escapeHtml(r.composer) + '</span>' : ''}</td>
                <td>${phaseSelect}</td>
                <td>${statusSelect}</td>
                <td>${timeline}</td>
            </tr>`;
        }
        html += '</tbody></table>';
    } else {
        html += '<p class="text-muted">No active repertoire.</p>';
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
            // If shelved, reload to shift it to previous section
            if (newStatus === 'shelved') {
                await loadStudentData();
                renderRepertoire();
            }
        });
    });
}

async function updateRepertoireField(repId, field, value) {
    const { error } = await sb
        .from('repertoire')
        .update({ [field]: value })
        .eq('id', repId);

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

    if (!currentUser) return;

    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

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

    const { data, error } = await sb
        .from('reflections')
        .insert(reflection);

    if (error) {
        alert('Error submitting reflection: ' + error.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Reflection';
        return;
    }

    // Success
    form.reset();
    document.querySelectorAll('input[type="range"]').forEach(input => {
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
    await loadStudentData();
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

        if (!title) return;

        const { data, error } = await sb
            .from('repertoire')
            .insert({
                student_id: currentUser.id,
                title: title,
                composer: composer || null,
                style: style || null,
                status: 'in_progress',
                assignment_type: 'short_term',
            });

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
    const todayStr = new Date().toISOString().split('T')[0];
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

    // Update the lineup in the studio class plan
    const lineup = typeof plan.lineup === 'string'
        ? JSON.parse(plan.lineup) : (plan.lineup || []);

    const entry = lineup.find(e => e.student_id === currentUser.id);
    if (entry) {
        entry.repertoire = [{ title, composer: composer || '' }];
        entry.confirmed = true;
    }

    const { error } = await sb
        .from('studio_class_plans')
        .update({ lineup: JSON.stringify(lineup) })
        .eq('id', plan.id);

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
