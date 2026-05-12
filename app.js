// ─── ELITE AURA PRO COACH (Global Sync v4) ──────────────────
const CONFIG = window.AURA_CONFIG || {};

// Global Error Catcher for User Feedback
window.onerror = function(msg, url, line) {
    // Ignore benign "Script error." which is a CORS artifact of local file loading
    if (msg.includes("Script error")) {
        console.warn("Benign CORS Script Error detected (Local File Access).");
        return true;
    }
    alert("CRITICAL ERROR: " + msg + "\nAt: " + url + ":" + line);
    return false;
};

let video, canvas, ctx, refCv, refCtx;
let camOk = false, mpOk = false, refAnim = null;
let refPhase = 0, refDir = 1;
let voiceOn = true, voiceList = [], voiceKey = '';

// ── Navigation & Screens ──
const SCRIDS = ['s-auth','s-admin','s-splash','s-onboard','s-dash','s-active'];
function go(id) { 
    SCRIDS.forEach(s => {
        const el = document.getElementById(s);
        if (el) el.classList.toggle('off', s !== id);
    }); 
}

// ── Multi-User State ──
let currentUser = null;
let todayProgram = [], activeEx = null, selectedAdminUser = null;

function setupApp() {
    try {
        video = document.getElementById('vid');
        canvas = document.getElementById('pose-cv');
        if (canvas) ctx = canvas.getContext('2d');
        
        currentUser = Store.getCurrentUser();
        
        // Diagnostic for Local Persistence
        if (!currentUser) {
            try { localStorage.setItem('aura_test', '1'); } 
            catch(e) { alert("SECURITY WARNING: Your browser is blocking LocalStorage for local files. Progress will NOT be saved between refreshes. Please run via a local server (e.g. VS Code Live Server) for full persistence."); }
        }

        attachListeners();
        initApp();
        
        // Warm up voice engine
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices();
        }
    } catch (e) {
        alert("Setup failed: " + e.message);
    }
}
window.addEventListener('DOMContentLoaded', setupApp);

function attachListeners() {
    const loginBtn = document.getElementById('btn-login');
    if (loginBtn) {
        loginBtn.onclick = () => {
            const user = document.getElementById('login-user').value.toLowerCase().trim();
            const pass = document.getElementById('login-pass').value;
            if (!user || !pass) return alert("Enter credentials");
            if (user === 'admin' && pass === 'admin123') {
                currentUser = { username: 'admin' };
                Store.setCurrentUser(currentUser);
                showAdmin(); return;
            }
            performLogin(user, pass);
        };
    }

    const signupBtn = document.getElementById('btn-signup');
    if (signupBtn) {
        signupBtn.onclick = async () => {
            const user = document.getElementById('signup-user').value.toLowerCase().trim();
            const pass = document.getElementById('signup-pass').value;
            const agree = document.getElementById('auth-agree').checked;
            
            if (!user || !pass) return alert("Enter credentials");
            if (!agree) return alert("You must agree to the Privacy & Camera Disclaimer to join.");
            if (user === 'admin') return alert("Cannot use admin username");
            
            signupBtn.textContent = "...";
            const existing = await Store.findUser(user);
            if (existing) {
                signupBtn.textContent = "Create Account";
                return alert("Username taken");
            }

            const newUser = { username: user, pass: pass, profile: null, stats: { totalReps: 0, sessions: 0 } };
            await Store.saveUser(user, newUser);
            
            currentUser = newUser;
            Store.setCurrentUser(currentUser);
            signupBtn.textContent = "Success!";
            initApp();
        };
    }

    const startBtn = document.getElementById('btn-start');
    if (startBtn) {
        startBtn.onclick = () => {
            go('s-onboard');
            gsap.from('.onboard-card', { opacity:0, scale:0.95, duration:.6 });
        };
    }

    const saveProfileBtn = document.getElementById('btn-save-profile');
    if (saveProfileBtn) {
        saveProfileBtn.onclick = saveOnboarding;
    }
}

let reps = 0, currentSet = 1, totalSets = 3;
let formPct = 0, mpCamera = null, mpPose = null;
let repPhase = 'waiting_rest', inWork = false, peakForm = 0;
let restInterval = null, sessionScores = [];
let circularDir = 'cw'; // For circular exercises: 'cw' or 'ccw'
const CIRCULAR_IDS = new Set(['arm-circles','hip-circles','wrist-ankles','torso-twists','neck-rolls','shoulder-rolls','ankle-circles','leg-swings']);

const getCal = (ex) => {
    const n = ex.name.toLowerCase();
    if (n.includes('circle') || n.includes('wrist') || n.includes('neck') || n.includes('twist') || n.includes('roll')) return 0.05;
    if (n.includes('squat') || n.includes('lunge') || n.includes('burpee')) return 0.45;
    if (n.includes('jump') || n.includes('jack') || n.includes('hop') || n.includes('skater')) return 0.35;
    if (ex.phase && (ex.phase.includes('Warmup') || ex.phase.includes('Stretch'))) return 0.15;
    return 0.3;
};

// ── Auth & Clean Logic ────────────────────
async function initApp() {
    if (!currentUser) go('s-auth');
    else if (currentUser.username === 'admin') showAdmin();
    else {
        if (!currentUser.profile) {
            go('s-splash');
        } else {
            renderDash();
            // renderDash handles redirection to onboarding if equipment is missing
        }
    }
}

async function performLogin(user, pass) {
    const btn = document.getElementById('btn-login');
    try {
        btn.textContent = "Verifying...";
        
        // Direct lookup in Global P2P DB
        const userData = await Store.findUser(user);
        
        if (userData && userData.pass === pass) {
            currentUser = userData;
            Store.setCurrentUser(currentUser);
            btn.textContent = "Welcome!";
            await initApp();
        } else {
            alert("Invalid credentials. Please check your username and password.");
            btn.textContent = "Login";
        }
    } catch (e) {
        console.error("Login Error:", e);
        alert("A critical error occurred during verification: " + e.message);
        btn.textContent = "Login";
    }
}

window.toggleAuth = (mode) => {
    document.getElementById('login-box').style.display = mode === 'login' ? 'block' : 'none';
    document.getElementById('signup-box').style.display = mode === 'signup' ? 'block' : 'none';
};
function logout() {
    Store.clearSession();
    currentUser = null;
    document.getElementById('login-user').value = '';
    document.getElementById('login-pass').value = '';
    go('s-auth');
}

async function forgotPass() {
    let user = prompt("Enter your username to reset password:");
    if (!user) return;
    user = user.toLowerCase().trim();
    
    const userData = await Store.findUser(user);
    if (!userData) {
        alert("User not found. Please check the username.");
        return;
    }
    
    const newPass = prompt(`Reset password for ${user}.\nEnter NEW password:`);
    if (!newPass || newPass.length < 4) {
        alert("Password must be at least 4 characters.");
        return;
    }
    
    userData.pass = newPass;
    await Store.saveUser(user, userData);
    alert("Password updated successfully! You can now log in.");
}

// ── Admin Dashboard ───────────────────────
async function showAdmin() {
    go('s-admin');
    const allUsersObj = await Store.getUsers();
    const users = Object.values(allUsersObj);
    document.getElementById('adm-users').textContent = users.length;
    
    let totalReps = 0, totalSessions = 0;
    let bmis = [], goals = {};
    const list = document.getElementById('adm-user-list');
    list.innerHTML = '';

    users.forEach(u => {
        const p = u.profile;
        const s = u.stats;

        totalReps += s?.totalReps || 0;
        totalSessions += s?.sessions || 0;
        if (p?.bmi) bmis.push(parseFloat(p.bmi));
        if (p?.goal) goals[p.goal] = (goals[p.goal] || 0) + 1;

        const row = document.createElement('div');
        row.className = 'adm-row';
        row.style.cursor = 'pointer';
        row.onclick = () => inspectUser(u.username);
        row.innerHTML = `
            <div>
                <div class="u-name">${u.username}</div>
                <div class="u-sub">${p ? p.age + 'y • ' + p.gender : 'No profile'}</div>
            </div>
            <div>
                <div class="u-metric">Metrics</div>
                <div class="u-val">${p ? p.bmi + ' BMI' : '–'}</div>
            </div>
            <div>
                <div class="u-metric">Program</div>
                <div class="u-val">${p ? 'Day ' + p.day : '–'}</div>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div class="u-metric">Activity</div>
                    <div class="u-val">${s?.totalReps || 0} Reps</div>
                </div>
                <span class="badge" style="font-size:0.5rem; padding:4px 8px;">Inspect</span>
            </div>
        `;
        list.appendChild(row);
    });

    document.getElementById('adm-reps').textContent = totalReps;
    document.getElementById('adm-sessions').textContent = totalSessions;
    
    let topGoal = '–'; let max = 0;
    for (let g in goals) { if (goals[g] > max) { max = goals[g]; topGoal = g.replace('-', ' '); } }
    document.getElementById('adm-goal').textContent = topGoal;

    const avgBmi = bmis.length ? (bmis.reduce((a, b) => a + b, 0) / bmis.length).toFixed(1) : '–';
    const bmiEl = document.getElementById('adm-avg-bmi');
    if (bmiEl) bmiEl.textContent = `Avg BMI: ${avgBmi}`;
    
    renderLab();
}

function toggleAdmTab(tab) {
    const isUsers = tab === 'users';
    document.getElementById('adm-main-wrap').classList.toggle('off', !isUsers);
    document.getElementById('adm-lab-wrap').classList.toggle('off', isUsers);
    document.getElementById('btn-adm-users').classList.toggle('active', isUsers);
    document.getElementById('btn-adm-lab').classList.toggle('active', !isUsers);
    if (!isUsers) renderLab(); // Refresh lab when clicking the tab
}

function renderLab() {
    const grid = document.getElementById('lab-grid');
    if (!grid) return;
    
    // Safety check for DB
    if (!DB || !DB.warmup) {
        console.warn("Lab: DB not ready yet.");
        return;
    }

    grid.innerHTML = '';
    
    const all = [
        ...(DB.warmup.exercises || []).map(e => ({...e, phase:'Warmup'})),
        ...(DB.workout.exercises || []).map(e => ({...e, phase:'Workout'})),
        ...(DB.stretch.exercises || []).map(e => ({...e, phase:'Stretch'}))
    ];

    all.forEach(ex => {
        const d = document.createElement('div');
        d.className = 'ex-card g';
        d.style.cssText = 'cursor:pointer; padding:12px; display:grid; grid-template-columns:50px 1fr 60px; align-items:center; gap:12px; transition: transform 0.2s, background 0.2s;';
        
        const eq = ex.equipment || 'bodyweight';
        const eqColor = eq === 'bodyweight' ? 'var(--blue)' : (eq === 'dumbbells' ? 'var(--warm)' : 'var(--green)');
        
        d.innerHTML = `
            <div style="width:50px; height:50px; background:rgba(0,0,0,0.2); border-radius:8px; overflow:hidden;">
                <canvas id="lab-cv-${ex.id}" width="100" height="100" style="width:100%; height:100%;"></canvas>
            </div>
            <div style="flex:1;">
                <h4 style="font-size:0.75rem;">${ex.icon} ${ex.name}</h4>
                <div style="display:flex; gap:4px; margin-top:4px;">
                    <small style="font-size:0.5rem; color:var(--dim);">${ex.phase}</small>
                    <small style="font-size:0.5rem; color:${eqColor}; font-weight:700; text-transform:uppercase;">• ${eq}</small>
                </div>
            </div>
            <button class="btn-g" style="padding:6px 12px; font-size:0.45rem;">TEST AI</button>
        `;

        d.onclick = () => {
            const testEx = { ...ex, targetReps: ex.reps || 10 };
            todayProgram = [testEx];
            startCamera().then(() => launch(testEx, 1));
        };

        grid.appendChild(d);

        // Initialize small preview
        setTimeout(() => {
            const cv = document.getElementById(`lab-cv-${ex.id}`);
            if (!cv) return;
            const ctx = cv.getContext('2d');
            const pose = REF_POSES[ex.id];
            if (!pose) return;

            let tick = 0;
            let active = false;

            const draw = () => {
                ctx.clearRect(0, 0, 100, 100);
                const t = active ? (Math.sin(Date.now() / 200) * 0.5 + 0.5) : 1; // Animate on hover, else show work pose
                
                // Simplified renderRef for small canvas
                ctx.strokeStyle = active ? eqColor : 'rgba(255,255,255,0.4)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                
                const getP = (p1, p2) => ({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t });
                const pts = {};
                for (let k in pose.rest) pts[k] = getP(pose.rest[k], pose.work[k]);

                const drawLine = (p1, p2) => {
                    if (!pts[p1] || !pts[p2]) return;
                    ctx.moveTo(pts[p1].x * 0.5 + 5, pts[p1].y * 0.5 + 10);
                    ctx.lineTo(pts[p2].x * 0.5 + 5, pts[p2].y * 0.5 + 10);
                };

                drawLine('neck', 'ls'); drawLine('neck', 'rs'); drawLine('ls', 'rs');
                drawLine('ls', 'le'); drawLine('le', 'lw'); drawLine('rs', 're'); drawLine('re', 'rw');
                drawLine('neck', 'hip'); drawLine('hip', 'lk'); drawLine('lk', 'la'); drawLine('hip', 'rk'); drawLine('rk', 'ra');
                ctx.stroke();

                if (active) requestAnimationFrame(draw);
            };

            d.onmouseenter = () => { active = true; draw(); d.style.transform = 'scale(1.02)'; d.style.background = 'rgba(255,255,255,0.05)'; };
            d.onmouseleave = () => { active = false; draw(); d.style.transform = 'scale(1)'; d.style.background = ''; };
            draw(); // Initial static draw
        }, 10);
    });
}

async function inspectUser(username) {
    const user = await Store.findUser(username);
    if (!user) return;
    selectedAdminUser = user;
    
    document.getElementById('det-name').textContent = `Auditing: ${username}`;
    document.getElementById('det-streak').textContent = user.stats?.streak || 0;
    document.getElementById('det-calories').textContent = Math.round(user.stats?.totalCalories || 0);
    document.getElementById('det-form').textContent = (user.stats?.avgForm || 0) + '%';
    
    document.querySelector('.admin-main').classList.add('off');
    document.getElementById('adm-detail').classList.remove('off');
}

function closeAdminDetail() {
    selectedAdminUser = null;
    document.getElementById('adm-detail').classList.add('off');
    document.querySelector('.admin-main').classList.remove('off');
    showAdmin();
}

async function adjustUserDay(delta) {
    if (!selectedAdminUser || !selectedAdminUser.profile) return;
    selectedAdminUser.profile.day = Math.max(1, Math.min(30, (selectedAdminUser.profile.day || 1) + delta));
    await Store.saveUser(selectedAdminUser.username, selectedAdminUser);
    inspectUser(selectedAdminUser.username);
}

async function resetUserProfile() {
    if (!selectedAdminUser || !confirm("Are you sure you want to reset this user's profile and progress?")) return;
    selectedAdminUser.profile = null;
    selectedAdminUser.stats = { totalReps: 0, sessions: 0 };
    await Store.saveUser(selectedAdminUser.username, selectedAdminUser);
    closeAdminDetail();
}

// ── Dashboard & Onboarding ────────────────
document.querySelectorAll('.goal-opt:not(.equip-opt):not(.level-opt)').forEach(opt => {
    opt.addEventListener('click', () => {
        document.querySelectorAll('.goal-opt:not(.equip-opt):not(.level-opt)').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
    });
});

document.querySelectorAll('.level-opt').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.level-opt').forEach(x => x.classList.remove('active'));
        opt.classList.add('active');
    };
});

document.querySelectorAll('.equip-opt').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.equip-opt').forEach(x => x.classList.remove('active'));
        opt.classList.add('active');
    };
});

function openOnboarding() {
    if (currentUser && currentUser.profile) {
        const p = currentUser.profile;
        document.getElementById('u-weight').value = p.weight;
        document.getElementById('u-height').value = p.height;
        document.getElementById('u-age').value = p.age;
        document.getElementById('u-gender').value = p.gender;
        
        document.querySelectorAll('.goal-opt').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.goal === p.goal);
        });
        document.querySelectorAll('.level-opt').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.level === p.level);
        });
        document.querySelectorAll('.equip-opt').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.equip === (p.equipment || 'bodyweight'));
        });
    }
    go('s-onboard');
}

function saveOnboard() {
    const level = document.querySelector('.level-opt.active').dataset.level;
    const goal = document.querySelector('.goal-opt.active').dataset.goal;
    const equipment = document.querySelector('.equip-opt.active').dataset.equip;
    const w = parseFloat(document.getElementById('u-weight').value);
    const h = parseFloat(document.getElementById('u-height').value);
    const bmi = (w / ((h / 100) ** 2)).toFixed(1);
    
    const isNew = !currentUser.profile;

    currentUser.profile = { 
        weight: w, height: h, age: document.getElementById('u-age').value, 
        gender: document.getElementById('u-gender').value,
        goal, level, equipment, bmi, day: (currentUser.profile ? currentUser.profile.day : 1)
    };

    if (isNew) {
        currentUser.stats = { totalReps: 0, sessions: 0, water: 0, steps: 0, streak: 0, totalCalories: 0, avgForm: 0, totalSets: 0 };
    }

    Store.saveUser(currentUser.username, currentUser);
    renderDash();
    go('s-dash');
}
function generateProgramForDay(day, goal) {
    let list = [];
    const wLen = DB.warmup.exercises.length;
    const mLen = DB.workout.exercises.length;
    const sLen = DB.stretch.exercises.length;
    
    // 3 Warmups
    for(let i=0; i<3; i++) list.push({...DB.warmup.exercises[(day*3 + i) % wLen], targetReps: 15, phase: 'Warmup'});
    // 5 Main Workouts
    let wOffset = goal === 'fat-loss' ? 0 : (goal === 'muscle-build' ? 1 : 2);
    for(let i=0; i<5; i++) list.push({...DB.workout.exercises[(day*5 + i + wOffset) % mLen], targetReps: goal === 'fat-loss' ? 15 : 10, phase: 'Main Workout'});
    // 3 Stretches
    for(let i=0; i<3; i++) list.push({...DB.stretch.exercises[(day*3 + i) % sLen], targetReps: 1, phase: 'Cool Down Stretch'});
    return list;
}

// Brain is now loaded from brain.js

function renderDash() {
    if (!currentUser || !currentUser.profile) {
        go('s-splash');
        return;
    }
    const p = currentUser.profile;
    
    // Force existing users to set equipment for the new version
    if (!p.equipment) {
        openOnboarding();
        return;
    }
    
    go('s-dash');
    
    if (p.day > 30) {
        alert("Congratulations! You have completed the 30-Day Elite Program! Let's update your stats for the next cycle.");
        currentUser.profile = null;
        Store.saveUser(currentUser.username, currentUser);
        go('s-onboard');
        return;
    }

    const bmiVal = p.bmi || '–';
    const cat = p.bmi ? (p.bmi < 18.5 ? 'Underweight' : p.bmi < 25 ? 'Healthy' : 'Overweight') : '–';
    
    document.getElementById('dash-stats').textContent = `BMI: ${bmiVal} (${cat})`;
    document.getElementById('dash-welcome').textContent = `Hello, ${currentUser.username}`;
    document.getElementById('dash-day').textContent = String(p.day || 1).padStart(2, '0');
    document.getElementById('user-initial').textContent = currentUser.username[0];
    document.getElementById('prog-progress').textContent = `DAY ${p.day} / 30`;
    
    // Update New Metrics
    const s = currentUser.stats;
    document.getElementById('dash-streak').textContent = s.streak || 0;
    document.getElementById('dash-calories').textContent = Math.round(s.totalCalories || 0);
    document.getElementById('dash-form').textContent = (s.avgForm || 0) + '%';
    
    // Update Vitals
    document.getElementById('dash-water').innerHTML = `${s.water || 0} <span style="font-size:0.6rem; color:var(--dim);">ml</span>`;
    document.getElementById('dash-steps').innerHTML = `${s.steps || 0} <span style="font-size:0.6rem; color:var(--dim);">steps</span>`;

    const grid = document.getElementById('days-grid');
    grid.innerHTML = '';
    for(let d=1; d<=30; d++) {
        const node = document.createElement('div');
        node.className = 'day-node';
        node.innerHTML = `<small>DAY</small><span>${d}</span>`;
        
        if (d < p.day) {
            node.classList.add('done');
            node.innerHTML = `<span>✓</span>`;
        } else if (d === p.day) {
            const isRestDay = d % 3 === 0;
            if (isRestDay) {
                node.classList.add('active');
                node.innerHTML = `<small>REST</small><span>💆</span>`;
            } else {
                node.classList.add('active');
            }
            node.onclick = () => showDayDetails(d);
        }
        grid.appendChild(node);
    }
    
    document.getElementById('today-details').style.display = 'none';
    const startBtn = document.getElementById('btn-start-workout');
    if (startBtn) {
        startBtn.textContent = "Begin Training Session";
        startBtn.disabled = false;
    }
    
    // Auto-open current day if they have no active clicks
    showDayDetails(p.day);
}

async function addVital(type, amount) {
    if (!currentUser) return;
    currentUser.stats[type] = (currentUser.stats[type] || 0) + amount;
    await Store.saveUser(currentUser.username, currentUser);
    
    const el = document.getElementById(`dash-${type}`);
    if (el) {
        el.innerHTML = `${currentUser.stats[type]} <span style="font-size:0.6rem; color:var(--dim);">${type === 'water' ? 'ml' : 'steps'}</span>`;
        gsap.fromTo(el, { scale: 1.2, color: '#0070FF' }, { scale: 1, color: '#fff', duration: 0.4 });
    }
}

async function showDayDetails(day) {
    document.getElementById('today-details').style.display = 'block';
    const isRestDay = day % 3 === 0;
    document.getElementById('today-title').textContent = isRestDay ? `Day ${day} — Active Recovery` : `Day ${day} Training`;
    
    const p = currentUser.profile;
    const session = currentUser.session;
    const lastFeedback = (currentUser.feedback || []).slice(-1)[0];
    const intensityPref = currentUser.profile.nextIntensity || 'same';

    // 1. Active Rest Day: light stretches only
    if (isRestDay) {
        todayProgram = DB.stretch.exercises.slice(0, 5).map(ex => ({
            ...ex, phase: 'Active Recovery Stretch', targetReps: 1,
            calPerRep: Brain.getCalories(ex, p)
        }));
        const descEl = document.getElementById('program-desc');
        if (descEl) descEl.textContent = '💆 Active Recovery Day — light stretching only.';
        renderProgramList(todayProgram, 0);
        document.getElementById('btn-start-workout').textContent = 'Begin Recovery Session';
        return;
    }

    // 2. Check if we have a saved session for this day
    if (session && session.day === day && session.program && session.program.length) {
        todayProgram = session.program;
        const descEl = document.getElementById('program-desc');
        if (descEl) descEl.textContent = "Resuming your active session...";
        renderProgramList(todayProgram, session.exIndex || 0);
    } else {
        // 2. Load default program immediately
        todayProgram = generateProgramForDay(day, p.goal);
        const descEl = document.getElementById('program-desc');
        if (descEl) descEl.textContent = "Standard elite program session.";
        renderProgramList(todayProgram, 0);

        // 3. Attempt to upgrade to AI Brain asynchronously
        Brain.generateProgram(currentUser).then(aiProg => {
            if (aiProg && aiProg.length) {
                todayProgram = aiProg;
                const descEl = document.getElementById('program-desc');
                if (descEl) descEl.textContent = "✨ Personalized session designed by AURA AI Brain.";
                renderProgramList(todayProgram, 0);
            }
        }).catch(e => console.warn("AI Brain skipped:", e));
    }
}

function renderProgramList(prog, currentIndex) {
    document.getElementById('prog-count').textContent = `${prog.length} EXERCISES`;
    const list = document.getElementById('dash-list'); 
    list.innerHTML = '';
    let currentPhase = '';
    
    prog.forEach((ex, idx) => {
        if (ex.phase !== currentPhase) {
            currentPhase = ex.phase;
            const header = document.createElement('div');
            header.style.fontSize = '0.65rem';
            header.style.color = 'var(--dim)';
            header.style.textTransform = 'uppercase';
            header.style.letterSpacing = '0.15em';
            header.style.marginTop = idx === 0 ? '0' : '16px';
            header.style.marginBottom = '8px';
            header.style.fontWeight = '700';
            header.textContent = `— ${currentPhase}`;
            list.appendChild(header);
        }

        const d = document.createElement('div'); 
        d.className = 'ex-card';
        if (idx < currentIndex) d.classList.add('done');
        if (idx === currentIndex) d.style.borderLeft = '2px solid var(--blue)';
        
        d.style.background = idx < currentIndex ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.03)';
        const setsText = ex.phase.includes('Stretch') ? '1 hold' : '3 sets';
        const statusIco = idx < currentIndex ? ' ✅' : '';
        d.innerHTML = `<div class="ex-ico">${ex.icon}</div><div class="ex-info"><h4>${ex.name}${statusIco}</h4><p>${ex.targetReps} reps • ${setsText}</p></div>`;
        list.appendChild(d);
    });
}

document.getElementById('btn-start-workout').addEventListener('click', async () => {
    const btn = document.getElementById('btn-start-workout');
    btn.textContent = "Initializing Engine...";
    btn.disabled = true;
    
    try {
        await startCamera();
        if (todayProgram && todayProgram.length) {
            const resumeIdx = (currentUser.session && currentUser.session.day === currentUser.profile.day) ? (currentUser.session.exIndex || 0) : 0;
            launch(todayProgram[resumeIdx], 1);
        } else {
            alert("Workout program not ready. Please try again in a moment.");
            btn.textContent = "Begin Training Session";
            btn.disabled = false;
        }
    } catch (e) {
        console.error("Session Start Error:", e);
        alert("Failed to access camera. Please ensure camera permissions are granted.");
        btn.textContent = "Begin Training Session";
        btn.disabled = false;
    }
});

// ── Voice ─────────────────────────────────
function getVoice() {
    if (voiceList.length) return voiceList[0];
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const v = voices.find(v => v.name.includes('Google') && v.lang.includes('en-US')) || voices[0];
    if (v) voiceList = [v]; return v;
}

if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => { getVoice(); };
}

function speak(text, key) {
    if (!voiceOn || !window.speechSynthesis) return;
    if (key && key === voiceKey) return;
    voiceKey = key; 
    
    window.speechSynthesis.cancel();
    
    // Attempt multiple voice retrieval methods
    let v = getVoice();
    const utter = new SpeechSynthesisUtterance(text);
    if (v) utter.voice = v;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    
    // Execute
    window.speechSynthesis.speak(utter);
}
function toggleVoice() {
    voiceOn = !voiceOn; window.speechSynthesis.cancel(); voiceKey = '';
    const btn = document.getElementById('voice-btn');
    btn.textContent = voiceOn ? '🔊' : '🔇';
}

// ── Exercise Engine ───────────────────────
function drawDot(p, r, color) {
    if (!p) return;
    ctx.beginPath(); ctx.arc(p.x * canvas.width / 180, p.y * canvas.height / 140, r, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
}
function lerpJ(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// ── Exercise Reference Engine ─────────────────────────────────────────

function renderRef(pose, t) {
    if (!refCtx || !refCv) return;

    // Background gradient - sleek dark
    refCtx.clearRect(0, 0, refCv.width, refCv.height);
    const bg = refCtx.createLinearGradient(0, 0, 0, refCv.height);
    bg.addColorStop(0, '#020205');
    bg.addColorStop(1, '#080812');
    refCtx.fillStyle = bg;
    refCtx.fillRect(0, 0, refCv.width, refCv.height);

    const P = {};
    try {
        for (const k of Object.keys(pose.rest)) {
            P[k] = lerpJ(pose.rest[k], pose.work[k], t);
        }
    } catch(e) { return; }
    if (!P.neck || !P.hip || !P.head) return;

    const W = refCv.width, H = refCv.height;
    const sx = x => x * W / 180;
    const sy = y => y * H / 140;

    const act = t > 0.5 ? (t - 0.5) * 2 : 0;
    
    // Draw connections (bones)
    const drawBone = (p1, p2, color, width, glow) => {
        if (!p1 || !p2) return;
        refCtx.beginPath();
        refCtx.moveTo(sx(p1.x), sy(p1.y));
        refCtx.lineTo(sx(p2.x), sy(p2.y));
        refCtx.strokeStyle = color;
        refCtx.lineWidth = width;
        refCtx.lineCap = 'round';
        if (glow) {
            refCtx.shadowBlur = glow;
            refCtx.shadowColor = color;
        }
        refCtx.stroke();
        refCtx.shadowBlur = 0;
    };

    const drawJoint = (p, r, color, glow) => {
        if (!p) return;
        refCtx.beginPath();
        refCtx.arc(sx(p.x), sy(p.y), r, 0, Math.PI * 2);
        refCtx.fillStyle = color;
        if (glow) {
            refCtx.shadowBlur = glow;
            refCtx.shadowColor = color;
        }
        refCtx.fill();
        refCtx.shadowBlur = 0;
    };

    // Draw subtle path trails for hands/feet
    const drawTrail = (k) => {
        if(!pose.rest[k] || !pose.work[k]) return;
        refCtx.beginPath();
        refCtx.moveTo(sx(pose.rest[k].x), sy(pose.rest[k].y));
        refCtx.lineTo(sx(pose.work[k].x), sy(pose.work[k].y));
        refCtx.strokeStyle = 'rgba(0, 200, 255, 0.15)';
        refCtx.lineWidth = 1;
        refCtx.setLineDash([2, 2]);
        refCtx.stroke();
        refCtx.setLineDash([]);
    };
    ['lw', 'rw', 'la', 'ra'].forEach(drawTrail);

    const coreColor = `rgba(255, 255, 255, ${0.4 + act * 0.6})`;
    const limbColor = `rgba(0, 190, 255, ${0.6 + act * 0.4})`;
    const glowAmount = act * 15;

    // Bones
    drawBone(P.head, P.neck, coreColor, 3, glowAmount);
    drawBone(P.neck, P.hip, coreColor, 3, glowAmount);
    
    drawBone(P.neck, P.ls, coreColor, 2);
    drawBone(P.neck, P.rs, coreColor, 2);
    drawBone(P.ls, P.le, limbColor, 2.5, glowAmount);
    drawBone(P.le, P.lw, limbColor, 2, glowAmount);
    drawBone(P.rs, P.re, limbColor, 2.5, glowAmount);
    drawBone(P.re, P.rw, limbColor, 2, glowAmount);

    drawBone(P.hip, P.lk, limbColor, 3, glowAmount);
    drawBone(P.lk, P.la, limbColor, 2.5, glowAmount);
    drawBone(P.hip, P.rk, limbColor, 3, glowAmount);
    drawBone(P.rk, P.ra, limbColor, 2.5, glowAmount);

    // Joints
    const jointColor = '#ffffff';
    const joints = [P.head, P.neck, P.ls, P.rs, P.le, P.re, P.lw, P.rw, P.hip, P.lk, P.rk, P.la, P.ra];
    joints.forEach(j => drawJoint(j, 2.5, jointColor, 8));

    // Dynamic Form Text
    if (act > 0.8) {
        refCtx.fillStyle = 'rgba(0, 255, 255, 0.9)';
        refCtx.font = '600 10px Inter, sans-serif';
        refCtx.textAlign = 'center';
        refCtx.fillText('PEAK', refCv.width/2, refCv.height - 10);
    }
}


function startRefAnim(exId) {
    if (refAnim) cancelAnimationFrame(refAnim);
    refAnim = null;

    const refImg = document.getElementById('ref-img');
    const refCanvas = document.getElementById('ref-canvas');
    const refPlaceholder = document.getElementById('ref-placeholder');
    const refIcon = document.getElementById('ref-icon');
    const refLabel = document.getElementById('ref-label');

    // --- Force animation mode ---
    if (refImg) refImg.style.display = 'none';
    if (refPlaceholder) refPlaceholder.style.display = 'none';

    refCv = document.getElementById('ref-canvas');
    if (refCv) {
        refCv.width = 180; refCv.height = 140;
        refCv.style.display = 'block';
        refCtx = refCv.getContext('2d');
    }

    const pose = (window.REF_POSES || {})[exId];
    if (!pose) {
        // No pose data — show icon placeholder
        if (refCv) refCv.style.display = 'none';
        if (refPlaceholder) refPlaceholder.style.display = 'flex';
        if (refIcon) refIcon.textContent = activeEx?.icon || '🏋️';
        if (refLabel) refLabel.textContent = activeEx?.restCue || 'Reference Form';
        return;
    }

    refPhase = 0; refDir = 1;
    function tick() {
        refPhase += refDir * 0.015;
        if (refPhase >= 1) { refPhase = 1; refDir = -1; }
        else if (refPhase <= 0) { refPhase = 0; refDir = 1; }
        const t = refPhase < 0.5 ? 2*refPhase*refPhase : -1+(4-2*refPhase)*refPhase;
        renderRef(pose, t);
        refAnim = requestAnimationFrame(tick);
    }
    tick();
}

function stopRefAnim() {
    if (refAnim) { cancelAnimationFrame(refAnim); refAnim = null; }
    const refImg = document.getElementById('ref-img');
    const refCanvas = document.getElementById('ref-canvas');
    const refPlaceholder = document.getElementById('ref-placeholder');
    if (refImg) refImg.style.display = 'none';
    if (refCanvas) { refCanvas.style.display = 'none'; if (refCtx) refCtx.clearRect(0,0,refCanvas.width,refCanvas.height); }
    if (refPlaceholder) refPlaceholder.style.display = 'flex';
}

function launch(ex, setNum) {
    activeEx = ex; reps = 0; currentSet = setNum; inWork = false; peakForm = 0; repPhase = 'waiting_rest';
    
    // For circular exercises: always start with clockwise
    if (CIRCULAR_IDS.has(ex.id)) {
        circularDir = 'cw';
        ex._circularPhase = 'cw'; // Track which half is being done
    }
    
    // Save current session state (only for standard users with profiles)
    if (currentUser && currentUser.profile) {
        currentUser.session = {
            day: currentUser.profile.day,
            program: todayProgram,
            exIndex: todayProgram.indexOf(ex)
        };
        Store.saveUser(currentUser.username, currentUser);
        Store.setCurrentUser(currentUser);
    }

    document.getElementById('rep-t').textContent = `/ ${ex.targetReps}`;
    
    const setWrap = document.getElementById('set-wrap');
    if (setWrap) {
        setWrap.style.display = (currentUser && currentUser.profile) ? 'block' : 'none';
    }
    
    document.getElementById('set-n').textContent = currentSet;
    document.getElementById('act-name').textContent = ex.name;
    document.getElementById('act-cue').textContent = ex.restCue;
    document.getElementById('ff').style.width = '0%';
    sessionScores = []; // Reset for new set
    go('s-active');
    setStatus('orange', `Prepare: ${ex.name}`);
    
    // Circular exercise: update cue label to indicate direction
    if (CIRCULAR_IDS.has(ex.id)) {
        document.getElementById('act-cue').textContent = `${ex.restCue} — Start CLOCKWISE`;
    }
    
    // Descriptive Voice Intro (include direction for circular exercises)
    let intro = `New exercise. ${ex.name}. ${ex.cue}. Count will start when you are in position.`;
    if (CIRCULAR_IDS.has(ex.id)) {
        intro = `New exercise. ${ex.name}. Start with clockwise circles. Then we will switch to anti-clockwise. Both directions count as one set.`;
    }
    speak(intro, `intro-${ex.id}-${currentSet}`);
    startRefAnim(ex.id);
}

async function completeSet() {
    stopRefAnim();
    
    // Calculate metrics
    const setAvgForm = sessionScores.length ? Math.round(sessionScores.reduce((a,b)=>a+b,0)/sessionScores.length) : 0;
    currentUser.stats.totalReps += activeEx.targetReps;
    currentUser.stats.sessions = (currentUser.stats.sessions || 0) + 1;
    const calBurn = (activeEx.calPerRep || Brain.getCalories(activeEx, currentUser.profile)) * activeEx.targetReps;
    currentUser.stats.totalCalories = (currentUser.stats.totalCalories || 0) + calBurn;
    
    // Update Average Form
    const oldAvg = currentUser.stats.avgForm || 0;
    const totalSetsCompleted = currentUser.stats.totalSets || 0;
    currentUser.stats.avgForm = Math.round(((oldAvg * totalSetsCompleted) + setAvgForm) / (totalSetsCompleted + 1));
    currentUser.stats.totalSets = totalSetsCompleted + 1;

    // Streak Logic
    const today = new Date().toDateString();
    if (currentUser.stats.lastDate !== today) {
        if (currentUser.stats.lastDate === new Date(Date.now() - 86400000).toDateString()) {
            currentUser.stats.streak = (currentUser.stats.streak || 0) + 1;
        } else {
            currentUser.stats.streak = 1;
        }
        currentUser.stats.lastDate = today;
    }

    await Store.saveUser(currentUser.username, currentUser);
    Store.setCurrentUser(currentUser);

    if (currentSet < totalSets) {
        startRest(20, activeEx.name, () => launch(activeEx, currentSet + 1));
    } else {
        const curIdx = todayProgram.findIndex(e => e.id === activeEx.id);
        if (curIdx < todayProgram.length - 1) {
            const nextIdx = curIdx + 1;
            if (currentUser.session) currentUser.session.exIndex = nextIdx;
            await Store.saveUser(currentUser.username, currentUser);
            Store.setCurrentUser(currentUser);
            startRest(40, todayProgram[nextIdx].name, () => launch(todayProgram[nextIdx], 1));
        } else {
            currentUser.profile.day++;
            currentUser.session = null;
            await Store.saveUser(currentUser.username, currentUser);
            Store.setCurrentUser(currentUser);
            speak("Workout complete! Great work today.", "final");
            showFeedbackModal(() => { go('s-dash'); renderDash(); });
        }
    }
}

window.completeManual = async () => {
    stopRefAnim();
    
    // Give credit for the remaining sets of THIS exercise
    const remainingSets = activeEx.phase.includes('Stretch') ? 1 : (3 - currentSet + 1);
    
    currentUser.stats.totalReps += (activeEx.targetReps * remainingSets);
    currentUser.stats.sessions = (currentUser.stats.sessions || 0) + 1;
    const calBurnManual = (activeEx.calPerRep || Brain.getCalories(activeEx, currentUser.profile)) * activeEx.targetReps * remainingSets;
    currentUser.stats.totalCalories = (currentUser.stats.totalCalories || 0) + calBurnManual;
    
    // Update Average Form with a default "Good" 85% for manual work
    const oldAvg = currentUser.stats.avgForm || 0;
    const totalSetsCompleted = currentUser.stats.totalSets || 0;
    currentUser.stats.avgForm = Math.round(((oldAvg * totalSetsCompleted) + (85 * remainingSets)) / (totalSetsCompleted + remainingSets));
    currentUser.stats.totalSets = totalSetsCompleted + remainingSets;

    // Streak Logic
    const today = new Date().toDateString();
    if (currentUser.stats.lastDate !== today) {
        if (currentUser.stats.lastDate === new Date(Date.now() - 86400000).toDateString()) {
            currentUser.stats.streak = (currentUser.stats.streak || 0) + 1;
        } else {
            currentUser.stats.streak = 1;
        }
        currentUser.stats.lastDate = today;
    }

    await Store.saveUser(currentUser.username, currentUser);
    Store.setCurrentUser(currentUser);

    const curIdx = todayProgram.findIndex(e => e.id === activeEx.id);
    if (curIdx < todayProgram.length - 1) {
        const nextIdx = curIdx + 1;
        if (currentUser.session) currentUser.session.exIndex = nextIdx;
        await Store.saveUser(currentUser.username, currentUser);
        Store.setCurrentUser(currentUser);
        startRest(10, todayProgram[nextIdx].name, () => launch(todayProgram[nextIdx], 1));
    } else {
        currentUser.profile.day++;
        currentUser.session = null;
        await Store.saveUser(currentUser.username, currentUser);
        Store.setCurrentUser(currentUser);
        speak("Workout complete! Great work today.", "final");
        showFeedbackModal(() => { go('s-dash'); renderDash(); });
    }
};

function startRest(duration, nextName, callback) {
    let time = duration;
    document.getElementById('rest-overlay').classList.remove('off');
    document.getElementById('next-ex-name').textContent = nextName;
    document.getElementById('rest-timer').textContent = time;
    speak(`Rest. Next: ${nextName}`, "rest");
    restInterval = setInterval(() => {
        time--; document.getElementById('rest-timer').textContent = time;
        if (time <= 0) { clearInterval(restInterval); document.getElementById('rest-overlay').classList.add('off'); callback(); }
    }, 1000);
    window.skipRest = () => { clearInterval(restInterval); document.getElementById('rest-overlay').classList.add('off'); callback(); };
}

// ── Camera & Tracking ───────────────────────────
function startCamera() {
    return new Promise((resolve, reject) => {
        if (camOk) return resolve();
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(s => {
                video.srcObject = s;
                camOk = true;
                initMP().then(resolve).catch(reject);
            })
            .catch(reject);
    });
}

function initMP() {
    return new Promise((resolve) => {
        if (mpOk || typeof Pose === 'undefined') return resolve();
        mpPose = new Pose({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}` });
        mpPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: .5, minTrackingConfidence: .5 });
        mpPose.onResults(onResults);
        mpCamera = new Camera(video, {
            onFrame: async () => { await mpPose.send({ image: video }); },
            width: 1280, height: 720
        });
        mpCamera.start().then(() => {
            mpOk = true;
            resolve();
        });
    });
}

const FORM_THRESHOLD = 55;
const COL = { green:'#10B981', red:'#EF4444', blue:'#0070FF', orange:'#F59E0B' };
function setStatus(c, msg) {
    document.getElementById('sdot').style.background = COL[c] || c;
    document.getElementById('stxt').textContent = msg;
}

function onResults(r) {
    try {
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        if (!r.poseLandmarks || !activeEx || !document.getElementById('rest-overlay').classList.contains('off')) return;
    const lm = r.poseLandmarks;
    const cx = (lm[11].x + lm[12].x) / 2;
    document.getElementById('align').textContent = Math.max(0, 100 - Math.abs(cx - .5) * 200).toFixed(1) + '%';
    const card = document.querySelector('.panel-card');
    if (card) gsap.to(card, { rotationY: (cx - .5) * 15, rotationX: -( (lm[11].y + lm[12].y) / 2 - .5) * 12, duration: .8 });
    // Sync Form Metrics to UI
    const ff = document.getElementById('ff');
    const fpt = document.getElementById('form-pct-txt');
    if (ff) ff.style.width = formPct + '%';
    if (fpt) fpt.textContent = Math.round(formPct) + '%';
    
    // Dynamic Bar Color based on Quality
    if (ff) {
        if (formPct > 85) ff.style.background = COL.blue;
        else if (formPct > 60) ff.style.background = COL.green;
        else if (formPct > 35) ff.style.background = COL.orange;
        else ff.style.background = COL.red;
    }

    // Corrected Skeletal Drawing
    lm.forEach(p => {
        ctx.fillStyle = '#0070FF';
        ctx.beginPath();
        ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // Bone Connectivity
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const drawBone = (i, j) => {
        if (!lm[i] || !lm[j]) return;
        ctx.moveTo(lm[i].x * canvas.width, lm[i].y * canvas.height);
        ctx.lineTo(lm[j].x * canvas.width, lm[j].y * canvas.height);
    };
    [ [11,12], [11,13], [13,15], [12,14], [14,16], [11,23], [12,24], [23,24], [23,25], [25,27], [24,26], [26,28] ].forEach(b => drawBone(b[0], b[1]));
    ctx.stroke();

    const restScore = activeEx.checkRest(lm) ? 100 : 0;
    const workScore = activeEx.check(lm) ? 100 : 0;
    
    // Low-pass filter for stability
    formPct = (formPct * 0.4) + (workScore * 0.6);

    if (repPhase === 'waiting_rest') {
        const resetPct = restScore;
        if (resetPct > 85) { repPhase = 'counting'; speak("Begin.", "s"); }
        setStatus('orange', `Align Body: ${Math.round(resetPct)}%`);
    } else {
        if (formPct > 20) sessionScores.push(formPct); // Track quality
        if (formPct > peakForm) peakForm = formPct;
        
        const now = Date.now();
        // Rep Logic: Require stability at peak
        if (formPct > 75) {
            if (!this._workStart) this._workStart = now;
            if (now - this._workStart > 200) inWork = true; // Must hold for 200ms
        } else {
            this._workStart = 0;
        }

        // Count rep when returning to deep rest (below 35%)
        if (formPct < 35 && inWork) {
            inWork = false;
            // INCREASED THRESHOLD: Require 70% form peak to count as a valid rep
            if (peakForm >= 70 && (now - (this._lastRepT || 0) > 600)) {
                this._lastRepT = now;
                reps++; document.getElementById('rep-n').textContent = reps;
                gsap.fromTo('#rep-n', { scale:1.4, color:'#0070FF' }, { scale:1, color:'#fff', duration:0.4 });
                gsap.fromTo('.panel-card', { x:-10 }, { x:0, duration:0.5, ease:'elastic.out(1, 0.3)' });
                
                // For circular exercises: halfway triggers direction switch
                if (CIRCULAR_IDS.has(activeEx.id)) {
                    const halfReps = Math.ceil(activeEx.targetReps / 2);
                    
                    // Draw Direction Indicator on Canvas
                    const ringX = canvas.width - 80, ringY = 80;
                    const spinAngle = (Date.now() / 200) % (Math.PI * 2);
                    const isCW = (activeEx._circularPhase === 'cw');
                    
                    ctx.beginPath();
                    ctx.arc(ringX, ringY, 30, 0, Math.PI * 2);
                    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                    ctx.lineWidth = 4;
                    ctx.stroke();

                    ctx.beginPath();
                    ctx.arc(ringX, ringY, 30, isCW ? spinAngle : -spinAngle, (isCW ? spinAngle : -spinAngle) + Math.PI*0.8);
                    ctx.strokeStyle = '#00c8ff';
                    ctx.lineWidth = 4;
                    ctx.lineCap = 'round';
                    ctx.stroke();

                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 8px Inter';
                    ctx.textAlign = 'center';
                    ctx.fillText(isCW ? 'CW' : 'CCW', ringX, ringY + 3);

                    if (reps === halfReps && activeEx._circularPhase === 'cw') {
                        activeEx._circularPhase = 'ccw';
                        circularDir = 'ccw';
                        speak('Now switch. Anti-clockwise direction.', 'dir-switch');
                        document.getElementById('act-cue').textContent = `${activeEx.restCue} — Now ANTI-CLOCKWISE`;
                        setStatus('blue', 'Switch direction → Anti-clockwise');
                    }
                    speak(reps >= activeEx.targetReps ? 'Set Done' : reps.toString(), `r-${reps}`);
                    if (reps >= activeEx.targetReps) completeSet();
                } else {
                    speak(reps >= activeEx.targetReps ? 'Set Done' : reps.toString(), `r-${reps}`);
                    if (reps >= activeEx.targetReps) completeSet();
                }
            }
            peakForm = 0;
        }
        setStatus(inWork ? 'green' : 'blue', inWork ? 'Holding...' : `${activeEx.targetReps - reps} left`);
    }
    document.getElementById('ff').style.width = formPct + '%';
    document.getElementById('form-pct-txt').textContent = Math.round(formPct) + '%';
    } catch (e) {
        console.error("Tracking Loop Error:", e);
    }
}

// ── Workout Feedback Modal ────────────────────────────────────
function showFeedbackModal(onComplete) {
    const existing = document.getElementById('feedback-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'feedback-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(5,5,5,0.96);backdrop-filter:blur(24px);z-index:200;display:flex;align-items:center;justify-content:center;`;
    modal.innerHTML = `
        <div style="max-width:440px;width:90%;padding:40px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:24px;">
            <div style="font-size:0.55rem;letter-spacing:0.4em;color:var(--blue);text-transform:uppercase;margin-bottom:12px;">Daily Check-In</div>
            <h2 style="font-size:1.8rem;font-weight:800;margin-bottom:8px;">How was today?</h2>
            <p style="font-size:0.8rem;color:rgba(255,255,255,0.45);margin-bottom:28px;">Your feedback trains the AURA Brain to personalize tomorrow's session.</p>

            <p style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.15em;color:rgba(255,255,255,0.5);margin-bottom:12px;">Rate today's session</p>
            <div id="fb-stars" style="display:flex;gap:8px;margin-bottom:28px;font-size:1.8rem;">
                ${[1,2,3,4,5].map(n => `<span data-v="${n}" onclick="fbStar(${n})" style="cursor:pointer;opacity:0.3;transition:all .2s;">⭐</span>`).join('')}
            </div>

            <p style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.15em;color:rgba(255,255,255,0.5);margin-bottom:12px;">Tomorrow's intensity</p>
            <div style="display:flex;gap:8px;margin-bottom:28px;">
                <button data-v="easier" onclick="fbIntensity('easier')" class="fb-btn btn-g" style="flex:1;padding:10px;font-size:0.65rem;">🔽 Easier</button>
                <button data-v="same" onclick="fbIntensity('same')" class="fb-btn btn-g" style="flex:1;padding:10px;font-size:0.65rem;">✅ Same</button>
                <button data-v="harder" onclick="fbIntensity('harder')" class="fb-btn btn-g" style="flex:1;padding:10px;font-size:0.65rem;">🔥 Harder</button>
            </div>

            <p style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.15em;color:rgba(255,255,255,0.5);margin-bottom:10px;">Any notes? (optional)</p>
            <textarea id="fb-notes" placeholder="e.g. knee was sore, want more cardio..." style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px;color:#fff;font-family:Outfit,sans-serif;font-size:0.8rem;resize:none;height:72px;outline:none;"></textarea>

            <button onclick="submitFeedback()" style="width:100%;margin-top:20px;background:var(--blue);color:#fff;border:none;padding:16px;border-radius:50px;font-family:Outfit,sans-serif;font-size:0.75rem;letter-spacing:0.3em;text-transform:uppercase;cursor:pointer;">Save & Continue →</button>
        </div>`;
    document.body.appendChild(modal);
    window._fbCallback = onComplete;
    window._fbRating = 0;
    window._fbIntensity = 'same';
}

window.fbStar = (n) => {
    window._fbRating = n;
    document.querySelectorAll('#fb-stars span').forEach((s, i) => {
        s.style.opacity = i < n ? '1' : '0.2';
        s.style.transform = i < n ? 'scale(1.15)' : 'scale(1)';
    });
};

window.fbIntensity = (v) => {
    window._fbIntensity = v;
    document.querySelectorAll('.fb-btn').forEach(b => {
        const isActive = b.dataset.v === v;
        b.style.borderColor = isActive ? 'var(--blue)' : 'rgba(255,255,255,0.1)';
        b.style.color = isActive ? 'var(--blue)' : '#fff';
    });
};

window.submitFeedback = async () => {
    const modal = document.getElementById('feedback-modal');
    const notes = document.getElementById('fb-notes').value.trim();
    const fb = {
        date: new Date().toDateString(),
        day: currentUser.profile.day,
        rating: window._fbRating || 3,
        intensity: window._fbIntensity || 'same',
        notes
    };
    currentUser.feedback = currentUser.feedback || [];
    currentUser.feedback.push(fb);
    
    // Store intensity preference for Brain to use tomorrow
    currentUser.profile.nextIntensity = fb.intensity;
    currentUser.profile.lastRating = fb.rating;
    
    await Store.saveUser(currentUser.username, currentUser);
    Store.setCurrentUser(currentUser);
    
    if (modal) modal.remove();
    if (window._fbCallback) window._fbCallback();
};

window.toggleVoice = toggleVoice;
window.logout = logout;
