// ═══════════════════════════════════════════════════════════════
//  AURA INTELLIGENCE ENGINE — brain.js
//  Handles: Smart Calories, Adaptive Difficulty, Local Planning,
//           AI-Enhanced Cloud Planning
// ═══════════════════════════════════════════════════════════════

const Brain = {

    // ── 1. Smart Calorie Engine ──────────────────────────────────
    // Uses exercise type AND user body weight for realistic burn.
    // Based on MET values: Calories = MET × weight(kg) × duration(hrs)
    // We approximate duration per rep based on typical cadence.
    getCalories: (ex, userProfile) => {
        const n = (ex.name || '').toLowerCase();
        const phase = (ex.phase || '');
        const w = parseFloat((userProfile && userProfile.weight) || 70);
        let metFactor; // kcal burned per rep at target weight

        if (n.includes('circle') || n.includes('wrist') || n.includes('neck') || n.includes('roll') || phase.includes('Stretch'))
            metFactor = 0.0005; // Micro-mobility: near-zero burn
        else if (n.includes('burpee'))
            metFactor = 0.008;  // Burpees: extreme compound
        else if (n.includes('squat') || n.includes('lunge') || n.includes('deadlift'))
            metFactor = 0.006;  // Heavy lower body compound
        else if (n.includes('push') || n.includes('dip') || n.includes('row') || n.includes('press'))
            metFactor = 0.004;  // Upper body strength
        else if (n.includes('jump') || n.includes('jack') || n.includes('hop') || n.includes('skater') || n.includes('plank jack') || n.includes('seal'))
            metFactor = 0.005;  // Cardio plyometrics
        else if (phase.includes('Warmup'))
            metFactor = 0.0015; // Warmup: light
        else
            metFactor = 0.003;  // Default: moderate

        return parseFloat((w * metFactor).toFixed(4));
    },

    // ── 2. Adaptive Difficulty Engine ───────────────────────────
    // Adjusts target reps progressively based on day and form quality.
    adaptReps: (baseReps, avgForm, day) => {
        let reps = baseReps || 12;

        // Progressive overload: +1 rep every 5 days automatically
        reps += Math.floor((day || 1) / 5);

        // Form-based adaptation
        if (avgForm >= 90)      reps = Math.round(reps * 1.15); // Great form → push harder
        else if (avgForm >= 75) reps = reps;                     // Good form → maintain
        else if (avgForm >= 50) reps = Math.max(8, Math.round(reps * 0.9)); // Average → slight reduction
        else if (avgForm > 0)   reps = Math.max(6, Math.round(reps * 0.75)); // Poor form → ease off

        return Math.min(reps, 30); // Hard cap at 30 reps
    },

    // ── 3. Smart Local Planner (offline-first, zero API needed) ─
    // Intelligent exercise selection from DB using: goal, level, history.
    smartLocalPlan: (user) => {
        try {
            const p = user.profile;
            const s = user.stats || {};
            const day = p.day || 1;
            const avgForm = s.avgForm || 75;
            const level = p.level || 'intermediate';
            const goal = p.goal || 'general-fitness';
            const intensityPref = p.nextIntensity || 'same'; // From daily feedback
            const lastRating = p.lastRating || 3;

            // Feedback-aware rep multiplier
            let repMult = 1.0;
            if (intensityPref === 'harder' || lastRating >= 4) repMult = 1.15;
            else if (intensityPref === 'easier' || lastRating <= 2) repMult = 0.8;

            // Beginner exercises (safe fundamentals only)
            const beginnerIds = new Set(['jacks','high-knees','arm-circles','leg-swings','wrist-ankles','squats','wall-sit','glute-bridges','calf-raises','seated-twists','savasana','chest-stretch','quad-stretch','kneeling-hip','hamstring-stretch']);
            // Advanced exercises (plyometrics and compound only)
            const advancedIds = new Set(['plank-jacks','skater-hops','shadow-boxing','windmills','seal-jacks','lat-shuffles','side-crunches','hip-circles','gate-openers','burpee-squat','worlds-stretch']);

            const filterByLevel = (exArr) => {
                if (level === 'beginner')    return exArr.filter(e => beginnerIds.has(e.id) || (!advancedIds.has(e.id)));
                if (level === 'elite')       return exArr.filter(e => advancedIds.has(e.id) || !beginnerIds.has(e.id));
                return exArr; // Intermediate: all exercises
            };

            const warmups   = filterByLevel([...DB.warmup.exercises]);
            const workouts  = filterByLevel([...DB.workout.exercises]);
            const stretches = [...DB.stretch.exercises];

            // Goal-aware workout sort
            const sortWorkouts = (exArr) => {
                if (goal === 'fat-loss')
                    // Prioritize highest calorie burn (HIIT style)
                    return [...exArr].sort((a, b) => Brain.getCalories(b, p) - Brain.getCalories(a, p));
                if (goal === 'muscle-build')
                    // Prioritize strength movements (more reps)
                    return [...exArr].sort((a, b) => (b.reps || 0) - (a.reps || 0));
                // Flexibility / General: natural variety rotation
                return exArr;
            };

            const sorted = sortWorkouts(workouts);

            // Deterministic but rotating: changes every day
            const pick = (arr, count, offset) => {
                if (!arr.length) return [];
                return Array.from({ length: count }, (_, i) => arr[(day * count + i + offset) % arr.length]);
            };

            const toPhase = (exArr, phaseName, repsOverride) => exArr.map(ex => ({
                ...ex,
                phase: phaseName,
                targetReps: Math.round(Brain.adaptReps(repsOverride !== undefined ? repsOverride : (ex.reps || 12), avgForm, day) * repMult),
                calPerRep: Brain.getCalories(ex, p)
            }));

            return [
                ...toPhase(pick(warmups, 3, 0),  'Warmup', 15),
                ...toPhase(pick(sorted, 5, 7),   'Main Workout'),
                ...toPhase(pick(stretches, 3, 0), 'Cool Down Stretch', 1)
            ];
        } catch (e) {
            console.warn('Smart local planner failed:', e);
            return null;
        }
    },

    // ── 4. Build a summary of progress insights for the AI prompt ─
    buildUserContext: (user) => {
        const p = user.profile;
        const s = user.stats || {};
        const avgForm = s.avgForm || 0;
        const formTrend = avgForm >= 85 ? 'excellent (push harder)' : avgForm >= 65 ? 'good (maintain pace)' : avgForm > 0 ? 'needs improvement (reduce intensity)' : 'new user (start easy)';
        return {
            level: p.level, goal: p.goal, bmi: p.bmi, age: p.age,
            weight: p.weight, height: p.height, day: p.day,
            avgForm, formTrend,
            totalCals: Math.round(s.totalCalories || 0),
            totalReps: s.totalReps || 0,
            streak: s.streak || 0
        };
    },

    // ── 5. AI-Enhanced Cloud Planner (HuggingFace LLM) ──────────
    // Sends rich user context to the AI for a truly personalized plan.
    generateProgram: async (user) => {
        // Always try local first for speed; fire cloud in background if available
        const localPlan = Brain.smartLocalPlan(user);

        if (!window.AURA_CONFIG || !window.AURA_CONFIG.HF_TOKEN) {
            console.info('AURA Brain: No API key found, using Smart Local Planner.');
            return localPlan;
        }

        try {
            const ctx = Brain.buildUserContext(user);
            const prompt = `[INST] You are AURA, an elite AI Fitness Coach with expert biomechanical knowledge.

Athlete Profile:
- Level: ${ctx.level} | Goal: ${ctx.goal}
- BMI: ${ctx.bmi} | Age: ${ctx.age} | Weight: ${ctx.weight}kg | Height: ${ctx.height}cm
- Program Day: ${ctx.day} / 30 | Streak: ${ctx.streak} days
- Form Quality: ${ctx.avgForm}% — ${ctx.formTrend}
- Total Calories Burned: ${ctx.totalCals} kcal | Total Reps: ${ctx.totalReps}

Smart Coaching Rules:
1. Form < 60%: Reduce reps 20%, focus on slow controlled movements, add extra mobility.
2. Form 60-80%: Standard intensity, normal progression.
3. Form > 80%: Increase challenge — add plyometric variations, raise reps 15%.
4. Day > 15: Replace basic warmups with dynamic compound movements.
5. fat-loss: High-rep cardio circuits (HIIT-style), maximum calorie burn.
6. muscle-build: Low-rep strength sets with compound lifts.
7. flexibility: Mobility-focused flows with deep stretches.
8. Progressive overload: Every 5 days, reps should increase by 1-2.

Generate exactly 11 exercises: 3 Warmups, 5 Main Workout, 3 Cool Down Stretch.
JSON format only: { "id": "slug", "name": "Name", "icon": "Emoji", "targetReps": 12, "phase": "Phase Name" }
Return ONLY a raw JSON array. No explanation. No markdown. [/INST]`;

            const response = await fetch(`https://api-inference.huggingface.co/models/meta-llama/Llama-3.1-8B-Instruct`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${window.AURA_CONFIG.HF_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ inputs: prompt, parameters: { max_new_tokens: 1500, temperature: 0.6 } })
            });

            const result = await response.json();
            const text = result[0]?.generated_text || '';

            // Robustly extract JSON array anywhere in response
            const jsonMatch = text.match(/\[[\s\S]*?\]/);
            if (!jsonMatch) throw new Error('No JSON array in LLM response');
            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed) || parsed.length < 8) throw new Error('Insufficient exercises from LLM');

            const p = user.profile;
            const s = user.stats || {};
            return parsed.map(ex => ({
                ...ex,
                targetReps: Brain.adaptReps(ex.targetReps || 12, s.avgForm || 75, p.day),
                calPerRep: Brain.getCalories(ex, p)
            }));

        } catch (e) {
            console.warn('AURA Brain: Cloud AI unavailable, falling back to Smart Local Planner.', e.message);
            return localPlan;
        }
    }
};

// Export to window for global access
window.Brain = Brain;
