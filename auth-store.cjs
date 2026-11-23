const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

function createStore(filename = path.join(__dirname, 'data', 'accounts.sqlite')) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  function initialize() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS landscope_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS landscope_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES landscope_users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS landscope_pending_accounts (
        challenge_hash TEXT PRIMARY KEY, email TEXT NOT NULL, password_hash TEXT NOT NULL,
        code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS landscope_pending_expiry ON landscope_pending_accounts(expires_at);
      CREATE INDEX IF NOT EXISTS landscope_sessions_expiry ON landscope_sessions(expires_at);
    `);
  }
  return {
    initialize,

    addPending(challengeHash, email, passwordHash, codeHash) {
      db.prepare('DELETE FROM landscope_pending_accounts WHERE expires_at<=unixepoch()').run();
      const count = db.prepare('SELECT count(*) AS n FROM landscope_pending_accounts WHERE email=?').get(email).n;
      if (count >= 3) return false;
      db.prepare('INSERT INTO landscope_pending_accounts(challenge_hash,email,password_hash,code_hash,expires_at) VALUES (?,?,?,?,unixepoch()+900)').run(challengeHash,email,passwordHash,codeHash);
      return true;
    },
    removePending(challengeHash) {
      db.prepare('DELETE FROM landscope_pending_accounts WHERE challenge_hash=?').run(challengeHash);
    },
    confirmPending(challengeHash, codeHash, tokenHash, previous) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const pending = db.prepare('SELECT * FROM landscope_pending_accounts WHERE challenge_hash=? AND expires_at>unixepoch() AND attempts<5').get(challengeHash);
        if (!pending) { db.exec('COMMIT'); return null; }
        if (pending.code_hash !== codeHash) {
          db.prepare('UPDATE landscope_pending_accounts SET attempts=attempts+1 WHERE challenge_hash=?').run(challengeHash);
          db.exec('COMMIT'); return null;
        }
        const result = db.prepare('INSERT INTO landscope_users(username,password_hash) VALUES (?,?)').run(pending.email,pending.password_hash);
        const id = Number(result.lastInsertRowid);
        if (previous) db.prepare('DELETE FROM landscope_sessions WHERE token_hash=?').run(previous);
        db.prepare('INSERT INTO landscope_sessions(token_hash,user_id,expires_at) VALUES (?,?,unixepoch()+43200)').run(tokenHash,id);
        db.prepare('DELETE FROM landscope_pending_accounts WHERE email=?').run(pending.email);
        db.exec('COMMIT');
        return { id, username: pending.email };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    registerAccount(username, passwordHash, tokenHash, previous) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db.prepare('INSERT INTO landscope_users(username,password_hash) VALUES (?,?)').run(username,passwordHash);
        const id = Number(result.lastInsertRowid);
        if (previous) db.prepare('DELETE FROM landscope_sessions WHERE token_hash=?').run(previous);
        db.prepare('DELETE FROM landscope_sessions WHERE expires_at<=unixepoch()').run();
        db.prepare('INSERT INTO landscope_sessions(token_hash,user_id,expires_at) VALUES (?,?,unixepoch()+43200)').run(tokenHash,id);
        db.exec('COMMIT');
        return {id,username};
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    findAccount(username) {
      return db.prepare('SELECT id,username,password_hash FROM landscope_users WHERE username=? AND active=1').get(username);
    },
    createAccount(username, passwordHash) {
      return db.prepare('INSERT INTO landscope_users(username,password_hash) VALUES (?,?)').run(username,passwordHash);
    },
    findSession(hash) {
      return db.prepare(`SELECT u.id,u.username FROM landscope_sessions s
        JOIN landscope_users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at>unixepoch() AND u.active=1`).get(hash) || null;
    },
    deleteSession(hash) {
      db.prepare('DELETE FROM landscope_sessions WHERE token_hash=?').run(hash);
    },
    createSession(hash, userId, previous) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (previous) db.prepare('DELETE FROM landscope_sessions WHERE token_hash=?').run(previous);
        db.prepare('DELETE FROM landscope_sessions WHERE expires_at<=unixepoch()').run();
        db.prepare('INSERT INTO landscope_sessions(token_hash,user_id,expires_at) VALUES (?,?,unixepoch()+43200)').run(hash,userId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close() { db.close(); }
  };
}
module.exports = { createStore };