// Shared test setup for lib/store.js tests — a fresh, isolated data root per
// test so nothing here ever touches a real game's data.
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../lib/store');

function makeTempDataRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dnd-store-test-'));
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

/** Seeds one campaign (`c1`) with two characters (`char1`, `char2`), no map
 *  image, no combatants — the minimal shape putCharacter/putPiece expect. */
function seedCampaign(dir) {
    return store.runWithDataRoot(dir, () => {
        store.writeSplitFromState({
            campaigns: [{
                id: 'c1',
                name: 'Test Campaign',
                mapImage: '',
                sessionLogs: [],
                mapMarkers: [],
                partyPosition: { x: 0, y: 0 },
                characters: {
                    char1: { name: 'Hero One', hp: { current: 10, max: 10, temp: 0 } },
                    char2: { name: 'Hero Two', hp: { current: 8, max: 8, temp: 0 } }
                }
            }],
            activeCampaignId: 'c1',
            combatants: [],
            activeCombatantIndex: 0,
            combatRound: 1,
            rollHistory: []
        }, { label: 'Setup', role: 'dm' });
    });
}

module.exports = { makeTempDataRoot, cleanup, seedCampaign };
