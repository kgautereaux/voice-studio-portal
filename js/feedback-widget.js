/* ============================================================
   Feedback Widget — floating flag button for all portal pages
   ============================================================
   Include this script on any page. It creates a floating button
   in the bottom-right corner. Requires Supabase JS to be loaded
   and an authenticated session (or falls back to anonymous).
   ============================================================ */

(function() {
    const SUPABASE_URL = 'https://ukvkljztinkzmkbtsfuo.supabase.co';
    const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrdmtsanp0aW5rem1rYnRzZnVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3MTAxMTUsImV4cCI6MjA4OTI4NjExNX0.dh0zSDQyTjvBrArPA7szI_NekBF1_V6CU8e7pLdpV1k';

    // Create the widget HTML
    const widgetHTML = `
        <button class="feedback-fab" id="feedback-fab" title="Report an issue" aria-label="Report an issue">
            &#9873;
        </button>
        <div class="feedback-panel" id="feedback-panel">
            <h3>Something seem off?</h3>
            <p>If anything in your portal looks wrong, doesn't match what happened in your lesson, or feels confusing, let Prof. G know here.</p>
            <textarea id="feedback-message" placeholder="What seems off?"></textarea>
            <button class="btn btn-primary btn-small" id="feedback-submit">Send Feedback</button>
        </div>
    `;

    // Inject into page
    const container = document.createElement('div');
    container.innerHTML = widgetHTML;
    document.body.appendChild(container);

    const fab = document.getElementById('feedback-fab');
    const panel = document.getElementById('feedback-panel');
    const messageInput = document.getElementById('feedback-message');
    const submitBtn = document.getElementById('feedback-submit');

    let isOpen = false;

    fab.addEventListener('click', () => {
        isOpen = !isOpen;
        fab.classList.toggle('open', isOpen);
        panel.classList.toggle('visible', isOpen);
        if (isOpen) {
            messageInput.focus();
        }
    });

    // Close on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) {
            isOpen = false;
            fab.classList.remove('open');
            panel.classList.remove('visible');
        }
    });

    submitBtn.addEventListener('click', async () => {
        const message = messageInput.value.trim();
        if (!message) {
            messageInput.style.borderColor = 'var(--error-color)';
            setTimeout(() => { messageInput.style.borderColor = ''; }, 1500);
            return;
        }

        submitBtn.textContent = 'Sending...';
        submitBtn.disabled = true;

        try {
            // Get or create Supabase client
            let feedbackSb;
            if (window.supabase) {
                const { createClient } = window.supabase;
                feedbackSb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            }

            // Get current user if authenticated
            let studentId = null;
            if (feedbackSb) {
                const { data: { session } } = await feedbackSb.auth.getSession();
                if (session) {
                    studentId = session.user.id;
                }
            }

            // Capture page context
            const page = window.location.pathname.split('/').pop() || 'unknown';

            if (feedbackSb && studentId) {
                await feedbackSb.from('feedback_flags').insert({
                    student_id: studentId,
                    page: page,
                    message: message,
                });
            } else {
                // Fallback: log to console if not authenticated
                console.log('Feedback (not authenticated):', { page, message });
            }

            // Show success
            panel.innerHTML = `
                <div class="feedback-success">
                    Sent. Prof. G will see this.<br>
                    <span style="font-size: 12px; color: var(--text-muted); font-weight: 400;">Thank you for flagging it.</span>
                </div>
            `;

            setTimeout(() => {
                isOpen = false;
                fab.classList.remove('open');
                panel.classList.remove('visible');
                // Reset panel
                panel.innerHTML = `
                    <h3>Something seem off?</h3>
                    <p>If anything in your portal looks wrong, doesn't match what happened in your lesson, or feels confusing, let Prof. G know here.</p>
                    <textarea id="feedback-message" placeholder="What seems off?"></textarea>
                    <button class="btn btn-primary btn-small" id="feedback-submit">Send Feedback</button>
                `;
                // Rebind
                bindSubmit();
            }, 2500);

        } catch (err) {
            console.error('Feedback error:', err);
            submitBtn.textContent = 'Error. Try again.';
            submitBtn.disabled = false;
        }
    });

    function bindSubmit() {
        const btn = document.getElementById('feedback-submit');
        const msg = document.getElementById('feedback-message');
        if (btn) {
            btn.addEventListener('click', arguments.callee ? submitBtn.click.bind(submitBtn) : null);
            // Re-run the whole widget init is simpler
        }
    }
})();
