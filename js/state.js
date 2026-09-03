// Shared app state and its local-only (never server-authoritative) UI persistence.
// `state` is exported as a const object reference — every mutation elsewhere in the
// app is `state.someField = ...` (property mutation), never `state = {...}`
// (reassignment), so this binding stays valid for every importing module.

export const state = {
    campaigns: [],
    activeCampaignId: '',
    activeCharacterId: null,
    zoomLevel: 1.0,
    isAddingMarker: false,
    combatants: [],
    activeCombatantIndex: 0,
    combatRound: 1,
    rollHistory: [],
    revisions: {},
    locks: {},
    claims: {},
    offers: {},
    dmForces: {}
};

// Local-only UI (never authoritative on server)
export const LOCAL_UI_KEY = 'dnd_local_ui';
export function loadLocalUi() {
    try {
        const u = JSON.parse(localStorage.getItem(LOCAL_UI_KEY) || '{}');
        if (u.activeCharacterId) state.activeCharacterId = u.activeCharacterId;
        if (typeof u.zoomLevel === 'number') state.zoomLevel = u.zoomLevel;
    } catch (e) { /* ignore */ }
}
export function saveLocalUi() {
    try {
        localStorage.setItem(LOCAL_UI_KEY, JSON.stringify({
            activeCharacterId: state.activeCharacterId,
            zoomLevel: state.zoomLevel
        }));
    } catch (e) { /* ignore */ }
}

// ----------------------------------------------------
// Campaign Getters
// ----------------------------------------------------
export function getActiveCampaign() {
    if (state.campaigns.length === 0) return null;
    return state.campaigns.find(c => c.id === state.activeCampaignId) || state.campaigns[0];
}

export function getActiveCharacter() {
    const active = getActiveCampaign();
    if (!active || !state.activeCharacterId) return null;
    return active.characters[state.activeCharacterId] || null;
}
