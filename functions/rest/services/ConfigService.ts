import { D1Database } from "@cloudflare/workers-types";

export interface UploadConfigItem {
    type: string;
    ext: string;
}

// In-memory cache for upload config with short TTL (5s) to avoid multi-isolate stale data
let uploadConfigCache: UploadConfigItem[] | null = null;
let uploadConfigCacheTime = 0;
let tokenExpireCache: number | null = null;
let tokenExpireCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

export class ConfigService {
    private db: D1Database;

    constructor(db: D1Database) {
        this.db = db;
    }

    async getUploadConfig(forceFresh = false): Promise<UploadConfigItem[]> {
        const now = Date.now();
        // Return cache only if not forced and within TTL
        if (!forceFresh && uploadConfigCache && (now - uploadConfigCacheTime < CACHE_TTL)) {
            return uploadConfigCache;
        }

        // Fetch fresh from DB
        const result = await this.db.prepare(
            `SELECT value FROM system_settings WHERE key = 'upload_config'`
        ).first<string>('value');

        if (result) {
            try {
                uploadConfigCache = JSON.parse(result);
            } catch (e) {
                console.error('Failed to parse upload_config:', e);
                uploadConfigCache = [];
            }
        } else {
            uploadConfigCache = [];
        }
        uploadConfigCacheTime = now;

        return uploadConfigCache || [];
    }

    async updateUploadConfig(config: UploadConfigItem[]): Promise<boolean> {
        const jsonStr = JSON.stringify(config);

        const result = await this.db.prepare(
            `INSERT INTO system_settings (key, value, description) 
             VALUES ('upload_config', ?, 'Supported upload file types')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).bind(jsonStr).run();

        if (result.success) {
            // Invalidate and refresh cache immediately
            uploadConfigCache = config;
            uploadConfigCacheTime = Date.now();
            return true;
        }
        return false;
    }

    async getTokenExpireDays(forceFresh = false): Promise<number> {
        const now = Date.now();
        if (!forceFresh && tokenExpireCache !== null && (now - tokenExpireCacheTime < CACHE_TTL)) {
            return tokenExpireCache;
        }

        const result = await this.db.prepare(
            `SELECT value FROM system_settings WHERE key = 'token_expire_days'`
        ).first<string>('value');

        if (result) {
            const days = parseInt(result, 10);
            if (!isNaN(days) && days > 0) {
                tokenExpireCache = days;
                tokenExpireCacheTime = now;
                return days;
            }
        }

        // Default to 7 days
        tokenExpireCache = 7;
        tokenExpireCacheTime = now;
        return 7;
    }

    async updateTokenExpireDays(days: number): Promise<boolean> {
        if (days <= 0) return false;

        const result = await this.db.prepare(
            `INSERT INTO system_settings (key, value, description) 
             VALUES ('token_expire_days', ?, 'Token expiration in days')
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        ).bind(String(days)).run();

        if (result.success) {
            tokenExpireCache = days;
            tokenExpireCacheTime = Date.now();
            return true;
        }
        return false;
    }
}
