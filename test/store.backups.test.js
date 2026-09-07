// Tests for the rolling backup/restore subsystem (P2 #10 / F9): snapshotting
// the split-layout data, throttling automatic snapshots, and restoring one
// back onto live data safely.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');
const { makeTempDataRoot, cleanup, seedCampaign } = require('./helpers');

describe('createBackupSnapshot / listBackups', () => {
    let dir;
    beforeEach(() => { dir = makeTempDataRoot(); seedCampaign(dir); });
    afterEach(() => cleanup(dir));

    test('a forced snapshot captures the current campaign and character data', () => {
        store.runWithDataRoot(dir, () => {
            const result = store.createBackupSnapshot({ force: true, reason: 'manual' });
            assert.ok(result && result.fileName, 'should always write when forced');

            const backups = store.listBackups();
            const mine = backups.find(b => b.fileName === result.fileName);
            assert.ok(mine, 'the new backup should be listed');
            assert.equal(mine.campaignCount, 1);
            assert.equal(mine.characterCount, 2);
            assert.equal(mine.reason, 'manual');
        });
    });

    test('automatic (non-forced) snapshots are throttled — a second one right after the first is skipped', () => {
        store.runWithDataRoot(dir, () => {
            // Establish a definite baseline first. (seedCampaign's own writeDoc
            // calls can't create one: manifest.json isn't written until the very
            // end of writeSplitFromState, and createBackupSnapshot bails out
            // early without it — so the very first full-state write never
            // auto-backs-up, which is fine, there's nothing new to snapshot yet.)
            const baseline = store.createBackupSnapshot({ force: true, reason: 'manual' });
            assert.ok(baseline, 'baseline snapshot should be created');

            const result = store.createBackupSnapshot({ force: false, reason: 'auto' });
            assert.equal(result, null, 'throttle window has not elapsed since the baseline');
        });
    });

    test('listBackups returns newest first', () => {
        store.runWithDataRoot(dir, () => {
            const first = store.createBackupSnapshot({ force: true, reason: 'manual' });
            const second = store.createBackupSnapshot({ force: true, reason: 'manual' });
            const backups = store.listBackups();
            assert.ok(backups.length >= 2);
            assert.equal(backups[0].fileName, second.fileName);
            assert.ok(backups.some(b => b.fileName === first.fileName));
        });
    });
});

describe('restoreBackup', () => {
    let dir;
    beforeEach(() => { dir = makeTempDataRoot(); seedCampaign(dir); });
    afterEach(() => cleanup(dir));

    test('restores prior data and bumps the revision strictly above what is currently live', () => {
        store.runWithDataRoot(dir, () => {
            const snapshot = store.createBackupSnapshot({ force: true, reason: 'manual' });

            // Damage char1 after the snapshot was taken.
            const dm = store.claimDmSeat({ label: 'DM' });
            const before = store.readDoc(store.characterPath('c1', 'char1'));
            store.putCharacter('c1', 'char1', {
                baseRevision: before.revision,
                data: { ...before.data, hp: { current: 1, max: 10, temp: 0 } },
                sessionToken: dm.sessionToken
            });
            const damaged = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(damaged.data.hp.current, 1);

            const result = store.restoreBackup(snapshot.fileName);
            assert.equal(result.status, 200);

            const restored = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(restored.data.hp.current, 10, 'HP should revert to the snapshotted value');
            assert.ok(
                restored.revision > damaged.revision,
                'restored revision must be strictly above the pre-restore revision so connected clients hit the conflict/reload path'
            );
        });
    });

    test('takes a safety snapshot of current state before restoring', () => {
        store.runWithDataRoot(dir, () => {
            const snapshot = store.createBackupSnapshot({ force: true, reason: 'manual' });
            const before = store.listBackups().length;

            store.restoreBackup(snapshot.fileName);

            const after = store.listBackups();
            assert.equal(after.length, before + 1, 'restore should add exactly one pre-restore safety snapshot');
            assert.equal(after[0].reason, 'pre-restore');
        });
    });

    test('rejects an unknown or path-traversal filename instead of reading arbitrary files', () => {
        store.runWithDataRoot(dir, () => {
            const missing = store.restoreBackup('backup-does-not-exist.json.gz');
            assert.equal(missing.status, 404);

            const traversal = store.restoreBackup('../../../etc/passwd');
            assert.equal(traversal.status, 404);
        });
    });
});
