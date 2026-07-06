/**
 * db.js — PostgreSQL connection pool + schema initializer
 * Works with Neon, Supabase, Render PostgreSQL, or any Postgres provider.
 * Set DATABASE_URL in your environment variables.
 */

import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Please add it to your environment variables.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // SSL required for Neon, Supabase, Render — ignored for local
    ssl: process.env.DATABASE_URL.includes('localhost')
        ? false
        : { rejectUnauthorized: false }
});

/**
 * Create tables if they don't exist + ensure the stats counter row exists.
 * Call once at startup before accepting requests.
 */
export async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS instances (
            phone_number  VARCHAR(20)  PRIMARY KEY,
            port          INTEGER      NOT NULL,
            session_hash  TEXT,
            status        VARCHAR(20)  NOT NULL DEFAULT 'starting',
            created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            last_status_update TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS deployer_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        INSERT INTO deployer_meta (key, value)
        VALUES ('total_deployed', '0')
        ON CONFLICT (key) DO NOTHING;
    `);
    console.log('✅ Database ready');
}

export default pool;
