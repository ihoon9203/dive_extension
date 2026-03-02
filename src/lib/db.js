/**
 * IndexedDB Wrapper for AI Adaptive Lesson
 * Handles local storage for free users and serves as cache for paid users.
 */

const DB_NAME = 'DiveAppDB';
const DB_VERSION = 1;

export const db = {
    _db: null,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve(this._db);
            };

            request.onupgradeneeded = (event) => {
                const updatedDb = event.target.result;

                // User Profile & Settings
                if (!updatedDb.objectStoreNames.contains('userProfile')) {
                    updatedDb.createObjectStore('userProfile', { keyPath: 'id' });
                }

                // Vocabulary (Words learned)
                if (!updatedDb.objectStoreNames.contains('vocabulary')) {
                    const vocabStore = updatedDb.createObjectStore('vocabulary', { keyPath: 'word' });
                    vocabStore.createIndex('nextReview', 'nextReview', { unique: false });
                    vocabStore.createIndex('category', 'category', { unique: false });
                }

                // History (Browsing & Learning sessions)
                if (!updatedDb.objectStoreNames.contains('history')) {
                    const historyStore = updatedDb.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
                    historyStore.createIndex('timestamp', 'timestamp', { unique: false });
                    historyStore.createIndex('category', 'category', { unique: false });
                }
            };
        });
    },

    async _getStore(storeName, mode = 'readonly') {
        if (!this._db) await this.init();
        const transaction = this._db.transaction(storeName, mode);
        return transaction.objectStore(storeName);
    },

    // --- User Profile ---
    async saveUserProfile(profileData) {
        const store = await this._getStore('userProfile', 'readwrite');
        return new Promise((resolve, reject) => {
            const request = store.put({ id: 'current_user', ...profileData });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    },

    async getUserProfile() {
        const store = await this._getStore('userProfile', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.get('current_user');
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    },

    // --- Cloud Sync (MongoDB Atlas) --
    // These methods would be fully implemented in a paid version via an API endpoint.
    async syncToCloud() {
        // Placeholder for syncing local IndexedDB to MongoDB Atlas
        console.log('[Cloud Sync] Syncing local data to MongoDB Atlas...');
        // const currentToken = await chrome.storage.local.get('authToken');
        // fetch('https://api.dive.net/sync', { method: 'POST', headers: { 'Authorization': `Bearer ${currentToken}` }, body: JSON.stringify(await this.exportAllData()) });
        return true;
    },

    async fetchFromCloud() {
        console.log('[Cloud Sync] Fetching remote data from MongoDB Atlas...');
        // Implement reverse sync logic here
        return true;
    },

    // --- Export / Import for Free Users ---
    async exportData() {
        if (!this._db) await this.init();

        const data = {
            userProfile: await this.getUserProfile(),
            vocabulary: await this.getAllVocabulary(),
            history: await this.getAllHistory()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        // Trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = `dive_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    // Helper fetchers
    async getAllVocabulary() {
        const store = await this._getStore('vocabulary', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    },

    async getAllHistory() {
        const store = await this._getStore('history', 'readonly');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
};
