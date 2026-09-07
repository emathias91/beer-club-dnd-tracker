// Tests for lib/store.js's piece-save revision/conflict engine — the
// machinery behind seat trust and multi-device sync. This exact class of
// logic (missing-fallback branches, stale-revision handling) has produced
// real bugs in this project (see DEVELOPMENT.md P2 #14a), so it's the
// highest-value place to start automated coverage.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../lib/store');
const { makeTempDataRoot, cleanup, seedCampaign } = require('./helpers');

describe('putPiece (putMeta/putMap/putCombat)', () => {
    let dir;
    beforeEach(() => { dir = makeTempDataRoot(); seedCampaign(dir); });
    afterEach(() => cleanup(dir));

    test('writes new data, bumps revision, and stamps lastSavedBy', () => {
        store.runWithDataRoot(dir, () => {
            const before = store.readDoc(store.metaPath('c1'));
            const result = store.putMeta('c1', before.revision, { ...before.data, name: 'Renamed Campaign' });
            assert.equal(result.status, 200);
            assert.equal(result.revision, before.revision + 1);

            const after = store.readDoc(store.metaPath('c1'));
            assert.equal(after.data.name, 'Renamed Campaign');
            assert.equal(after.revision, before.revision + 1);
            assert.ok(after.lastSavedBy, 'lastSavedBy should be stamped');
            assert.equal(after.lastSavedBy.label, 'Unknown'); // no session token supplied
        });
    });

    test('rejects a stale baseRevision with 409 and leaves the document unchanged', () => {
        store.runWithDataRoot(dir, () => {
            const before = store.readDoc(store.mapPath('c1'));
            const staleRevision = before.revision - 1 < 0 ? 0 : before.revision; // force a mismatch below
            const result = store.putMap('c1', 9999, { mapMarkers: [{ id: 1, name: 'Trap' }], partyPosition: before.data.partyPosition });
            assert.equal(result.status, 409);
            assert.equal(result.currentRevision, before.revision);

            const after = store.readDoc(store.mapPath('c1'));
            assert.deepEqual(after.data, before.data, 'unchanged on conflict');
            assert.equal(after.revision, before.revision, 'revision unchanged on conflict');
        });
    });

    test('putCombat stamps lastSavedBy with the resolved session identity', () => {
        store.runWithDataRoot(dir, () => {
            const dm = store.claimDmSeat({ label: 'The DM' });
            const before = store.readDoc(store.combatPath('c1'));
            const result = store.putCombat('c1', before.revision, {
                combatants: [{ name: 'Goblin', hp: 7 }],
                activeCombatantIndex: 0,
                combatRound: 1,
                rollHistory: []
            }, dm.sessionToken);
            assert.equal(result.status, 200);

            const after = store.readDoc(store.combatPath('c1'));
            assert.equal(after.lastSavedBy.label, 'The DM');
            assert.equal(after.lastSavedBy.role, 'dm');
        });
    });
});

describe('putCharacter', () => {
    let dir;
    beforeEach(() => { dir = makeTempDataRoot(); seedCampaign(dir); });
    afterEach(() => cleanup(dir));

    test('DM force-writes over the character regardless of holder, and records lastDmForce', () => {
        store.runWithDataRoot(dir, () => {
            const player = store.claimSeat({ campaignId: 'c1', characterId: 'char1', label: 'Alice' });
            const dm = store.claimDmSeat({ label: 'DM' });

            const before = store.readDoc(store.characterPath('c1', 'char1'));
            const result = store.putCharacter('c1', 'char1', {
                baseRevision: before.revision,
                data: { ...before.data, hp: { current: 3, max: 10, temp: 0 } },
                sessionToken: dm.sessionToken
            });
            assert.equal(result.status, 200);
            assert.equal(result.mode, 'dm_force');

            const after = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(after.data.hp.current, 3);
            assert.ok(after.lastDmForce, 'DM force should be recorded for the seat holder to see');
            assert.equal(after.lastSavedBy.role, 'dm');
            assert.equal(player.role, 'player'); // sanity: seat claim succeeded
        });
    });

    test('the seat holder writes their own character directly', () => {
        store.runWithDataRoot(dir, () => {
            const player = store.claimSeat({ campaignId: 'c1', characterId: 'char1', label: 'Alice' });
            const before = store.readDoc(store.characterPath('c1', 'char1'));
            const result = store.putCharacter('c1', 'char1', {
                baseRevision: before.revision,
                data: { ...before.data, hp: { current: 6, max: 10, temp: 0 } },
                sessionToken: player.sessionToken
            });
            assert.equal(result.status, 200);
            assert.equal(result.mode, 'direct');

            const after = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(after.data.hp.current, 6);
            assert.equal(after.lastSavedBy.label, 'Alice');
            assert.equal(after.lastSavedBy.role, 'player');
        });
    });

    test('a DM edit lock blocks a non-DM direct write with 423', () => {
        store.runWithDataRoot(dir, () => {
            const player = store.claimSeat({ campaignId: 'c1', characterId: 'char1', label: 'Alice' });
            store.setDmEditLock('c1', 'char1', true, 'DM is editing this sheet');

            const before = store.readDoc(store.characterPath('c1', 'char1'));
            const result = store.putCharacter('c1', 'char1', {
                baseRevision: before.revision,
                data: { ...before.data, hp: { current: 1, max: 10, temp: 0 } },
                sessionToken: player.sessionToken
            });
            assert.equal(result.status, 423);

            const after = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(after.data.hp.current, before.data.hp.current, 'locked sheet must not change');
        });
    });

    test('a player editing a character that is not their own seat creates an offer, not a direct write', () => {
        store.runWithDataRoot(dir, () => {
            const helper = store.claimSeat({ campaignId: 'c1', characterId: 'char2', label: 'Bob' });
            const before = store.readDoc(store.characterPath('c1', 'char1'));
            const result = store.putCharacter('c1', 'char1', {
                baseRevision: before.revision,
                data: { ...before.data, hp: { current: 2, max: 10, temp: 0 } },
                sessionToken: helper.sessionToken
            });
            assert.equal(result.status, 202);
            assert.equal(result.mode, 'offer');

            const after = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(after.data.hp.current, before.data.hp.current, 'helper edit must not apply until accepted');
            assert.equal(after.pendingOffers.length, 1);
            assert.equal(after.pendingOffers[0].fromLabel, 'Bob');
        });
    });

    test('accepting an offer applies it and attributes lastSavedBy to the offer author, not the accepter', () => {
        store.runWithDataRoot(dir, () => {
            const helper = store.claimSeat({ campaignId: 'c1', characterId: 'char2', label: 'Bob' });
            const holder = store.claimSeat({ campaignId: 'c1', characterId: 'char1', label: 'Alice', steal: true });
            const before = store.readDoc(store.characterPath('c1', 'char1'));

            const offerResult = store.putCharacter('c1', 'char1', {
                baseRevision: before.revision,
                data: { ...before.data, hp: { current: 4, max: 10, temp: 0 } },
                sessionToken: helper.sessionToken
            });
            assert.equal(offerResult.status, 202);
            const offerId = store.readDoc(store.characterPath('c1', 'char1')).pendingOffers[0].id;

            const accepted = store.acceptOffer('c1', 'char1', offerId, holder.sessionToken);
            assert.equal(accepted.status, 200);

            const after = store.readDoc(store.characterPath('c1', 'char1'));
            assert.equal(after.data.hp.current, 4, 'accepted offer data should now be live');
            assert.equal(after.pendingOffers.length, 0);
            assert.equal(after.lastSavedBy.label, 'Bob', 'attributed to the offer author, not Alice who accepted it');
        });
    });

    test('a stale baseRevision returns 409 with the current revision', () => {
        store.runWithDataRoot(dir, () => {
            const dm = store.claimDmSeat({ label: 'DM' });
            const before = store.readDoc(store.characterPath('c1', 'char1'));
            const result = store.putCharacter('c1', 'char1', {
                baseRevision: before.revision - 1,
                data: { ...before.data, hp: { current: 0, max: 10, temp: 0 } },
                sessionToken: dm.sessionToken
            });
            assert.equal(result.status, 409);
            assert.equal(result.currentRevision, before.revision);
        });
    });
});
