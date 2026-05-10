// ─── AURA LOCAL DATA ENGINE ──────────────────
// Local Storage implementation with in-memory fallback for strict browsers.

const memStore = {};

function safeGet(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        return memStore[key] || null;
    }
}

function safeSet(key, val) {
    try {
        localStorage.setItem(key, val);
    } catch (e) {
        memStore[key] = val;
    }
}

function safeRemove(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        delete memStore[key];
    }
}

const Store = {
    async getUsers() {
        return JSON.parse(safeGet('aura_users') || '{}');
    },

    async findUser(username) {
        let users = await this.getUsers();
        if (Array.isArray(users)) users = {};
        return users[username] || null;
    },

    async saveUser(username, userData) {
        let users = await this.getUsers();
        if (Array.isArray(users)) users = {}; 
        users[username] = userData;
        safeSet('aura_users', JSON.stringify(users));
        return true;
    },

    setCurrentUser(user) { 
        safeSet('aura_current_user', JSON.stringify(user)); 
    },
    
    getCurrentUser() { 
        return JSON.parse(safeGet('aura_current_user') || 'null'); 
    },
    
    clearSession() { 
        safeRemove('aura_current_user'); 
    }
};

window.Store = Store;
