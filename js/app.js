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

    // Load repertoire
    const { data: repertoire } = await sb
        .from('repertoire')
        .select('*')
        .eq('student_id', currentUser.id)
        .in('status', ['assigned', 'in_progress', 'performance_ready'])
        .order('timeline');

    studentData.repertoire = repertoire || [];

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

    // Welcome
    const welcomeEl = document.getElementById('welcome-name');
    if (welcomeEl) {
        welcomeEl.textContent = studentData.student.name;
    }

    // Current practice plan
    renderPracticePlan();

    // Repertoire status
    renderRepertoire();

    // Recent reflections
    renderRecentReflections();

    // Studio class feedback
    renderStudioFeedback();

    updateNavActive('dashboard');
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

    // Render markdown-like content as HTML
    const content = plan.content
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^\*\*(.+?)\*\*/gm, '<strong>$1</strong>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');

    container.innerHTML = `
        <p class="card-date">Generated ${dateStr}</p>
        <div class="practice-plan">${content}</div>
    `;
}

function renderRepertoire() {
    const container = document.getElementById('repertoire-content');
    if (!container) return;

    const rep = studentData.repertoire;
    if (!rep || rep.length === 0) {
        container.innerHTML = '<p class="text-muted">No active repertoire tracked yet.</p>';
        return;
    }

    const phaseLabels = {
        'translation_characterization': 'Translation + Characterization',
        'text_rhythm': 'Text + Rhythm',
        'melody_text_rhythm': 'Melody + Text + Rhythm',
        'characterization_integration': 'Characterization Integration',
        'memorization': 'Memorization',
        'performance_ready': 'Performance Ready',
    };

    let html = '<table><thead><tr><th>Piece</th><th>Phase</th><th>Due</th></tr></thead><tbody>';
    for (const r of rep) {
        const phase = phaseLabels[r.learning_phase] || r.learning_phase;
        const timeline = r.timeline
            ? new Date(r.timeline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';
        html += `<tr>
            <td><strong>${escapeHtml(r.title)}</strong>${r.composer ? ' (' + escapeHtml(r.composer) + ')' : ''}</td>
            <td><span class="tag">${escapeHtml(phase)}</span></td>
            <td>${timeline}</td>
        </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
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
