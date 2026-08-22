// D&D Campaign Dashboard Core Controller (Multi-Campaign Version)

// Global App State
let state = {
    campaigns: [],
    activeCampaignId: '',
    activeCharacterId: 'Elowen',
    zoomLevel: 1.0,
    isAddingMarker: false,
    combatants: [],
    activeCombatantIndex: 0,
    combatRound: 1,
    rollHistory: []
};

// Web Audio API Sound Synthesizer for rolling dice
let audioCtx = null;
function playDiceSound() {
    if (!document.getElementById('dice-sound-toggle').checked) return;
    
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Play multiple tiny friction clicks to simulate rolling dice
        const now = audioCtx.currentTime;
        
        // Roll friction sound (rumble)
        const rumbleOsc = audioCtx.createOscillator();
        const rumbleGain = audioCtx.createGain();
        rumbleOsc.type = 'triangle';
        rumbleOsc.frequency.setValueAtTime(80, now);
        rumbleOsc.frequency.exponentialRampToValueAtTime(30, now + 0.5);
        
        rumbleGain.gain.setValueAtTime(0.3, now);
        rumbleGain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
        
        rumbleOsc.connect(rumbleGain);
        rumbleGain.connect(audioCtx.destination);
        rumbleOsc.start(now);
        rumbleOsc.stop(now + 0.5);
        
        // Dynamic impact clicks (4-5 clicks spaced out)
        const clickTimes = [0.1, 0.22, 0.35, 0.44, 0.52];
        clickTimes.forEach((time, index) => {
            const clickOsc = audioCtx.createOscillator();
            const clickGain = audioCtx.createGain();
            clickOsc.type = 'sine';
            const freq = index === clickTimes.length - 1 ? 400 : 250 + Math.random() * 100;
            
            clickOsc.frequency.setValueAtTime(freq, now + time);
            clickOsc.frequency.exponentialRampToValueAtTime(10, now + time + 0.08);
            
            clickGain.gain.setValueAtTime(0.15 - (index * 0.02), now + time);
            clickGain.gain.exponentialRampToValueAtTime(0.001, now + time + 0.08);
            
            clickOsc.connect(clickGain);
            clickGain.connect(audioCtx.destination);
            clickOsc.start(now + time);
            clickOsc.stop(now + time + 0.08);
        });
    } catch (e) {
        console.warn('Audio Context failed to start:', e);
    }
}

// ----------------------------------------------------
// Campaign Getters
// ----------------------------------------------------
function getActiveCampaign() {
    if (state.campaigns.length === 0) return null;
    return state.campaigns.find(c => c.id === state.activeCampaignId) || state.campaigns[0];
}

// ----------------------------------------------------
// Collaborative Sync & Core Initialization
// ----------------------------------------------------
const IS_SERVER_MODE = window.location.protocol.startsWith('http');

document.addEventListener('DOMContentLoaded', async () => {
    await loadState();
    initNavigation();
    initMapPanel();
    initCharacterPanel();
    initCombatPanel();
    initSessionLogsPanel();
    initModals();
    initImportExport();
    initCampaignSettings();
    initRestButtons();
    initDmPanel();
    
    // Trigger initial render
    renderCampaignSelector();
    renderAll();
    
    // Start collaborative sync polling
    startPollingSync();
});

// Load state from server or localStorage fallback
async function loadState() {
    if (IS_SERVER_MODE) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const response = await fetch('/api/state', { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (response.ok) {
                const fetchedState = await response.json();
                console.log('Loaded campaign state from server.');
                
                // Merge loaded state into local state
                state.campaigns = fetchedState.campaigns || [];
                state.combatants = fetchedState.combatants || [];
                state.activeCombatantIndex = fetchedState.activeCombatantIndex || 0;
                state.combatRound = fetchedState.combatRound || 1;
                state.rollHistory = fetchedState.rollHistory || [];
                
                if (fetchedState.activeCampaignId && !state.activeCampaignId) {
                    state.activeCampaignId = fetchedState.activeCampaignId;
                }
                
                // Update local storage backup
                try {
                    localStorage.setItem('dnd_campaign_state', JSON.stringify(state));
                } catch (e) {}
                
                if (state.campaigns.length === 0) {
                    resetToDefaults();
                }
                if (!state.activeCampaignId) {
                    state.activeCampaignId = state.campaigns[0].id;
                }
                return;
            } else if (response.status === 404) {
                console.log('No state found on server. Initializing server database with default templates.');
                resetToDefaults();
                await saveStateToServer();
                return;
            }
        } catch (e) {
            console.warn('Failed to load state from server, falling back to localStorage:', e);
        }
    }
    
    // Fallback: LocalStorage loading
    loadStateFromLocalStorage();
}

function loadStateFromLocalStorage() {
    try {
        const stored = localStorage.getItem('dnd_campaign_state');
        if (stored) {
            const parsed = JSON.parse(stored);
            
            // Migrate old single-campaign state if needed
            if (parsed.characters && !parsed.campaigns) {
                const oldCampaign = {
                    id: "phandelver",
                    name: "Lost Mine of Phandelver",
                    mapImage: "phandelver-map-exterior-player.webp",
                    characters: parsed.characters,
                    sessionLogs: parsed.sessionLogs || [],
                    mapMarkers: parsed.mapMarkers || [],
                    partyPosition: parsed.partyPosition || { x: 350, y: 480, lastUpdated: "Arrived in Phandalin" }
                };
                parsed.campaigns = [oldCampaign];
                parsed.activeCampaignId = "phandelver";
                delete parsed.characters;
                delete parsed.sessionLogs;
                delete parsed.mapMarkers;
                delete parsed.partyPosition;
            }
            
            // Apply parsed values
            state.campaigns = parsed.campaigns || [];
            state.activeCampaignId = parsed.activeCampaignId || '';
            state.activeCharacterId = parsed.activeCharacterId || 'Elowen';
            state.zoomLevel = parsed.zoomLevel || 1.0;
            state.combatants = parsed.combatants || [];
            state.activeCombatantIndex = parsed.activeCombatantIndex || 0;
            state.combatRound = parsed.combatRound || 1;
            state.rollHistory = parsed.rollHistory || [];
        } else {
            resetToDefaults();
        }
        
        // Safety check
        if (!state.campaigns || state.campaigns.length === 0) {
            resetToDefaults();
        }
        if (!state.activeCampaignId) {
            state.activeCampaignId = state.campaigns[0].id;
        }
        if (!state.rollHistory) state.rollHistory = [];
    } catch (e) {
        console.error('Error loading state from localStorage, using defaults:', e);
        resetToDefaults();
    }
}

function saveState() {
    try {
        localStorage.setItem('dnd_campaign_state', JSON.stringify(state));
    } catch (e) {
        console.error('Error saving state to localStorage:', e);
    }
    
    if (IS_SERVER_MODE) {
        saveStateToServer();
    }
}

async function saveStateToServer() {
    try {
        const response = await fetch('/api/state', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(state)
        });
        if (!response.ok) {
            console.error('Server failed to save campaign state:', response.statusText);
        }
    } catch (e) {
        console.error('Network error saving campaign state to server:', e);
    }
}

function isModalOpen() {
    const overlays = document.querySelectorAll('.modal-overlay');
    for (let overlay of overlays) {
        if (window.getComputedStyle(overlay).display === 'flex' || overlay.style.display === 'flex') {
            return true;
        }
    }
    return false;
}

function isUserEditing() {
    const active = document.activeElement;
    if (active) {
        const tagName = active.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || active.isContentEditable) {
            return true;
        }
    }
    return isModalOpen();
}

function isSharedStateEqual(a, b) {
    if (!a || !b) return false;
    try {
        const sharedA = {
            campaigns: a.campaigns,
            combatants: a.combatants,
            activeCombatantIndex: a.activeCombatantIndex,
            combatRound: a.combatRound,
            rollHistory: a.rollHistory
        };
        const sharedB = {
            campaigns: b.campaigns,
            combatants: b.combatants,
            activeCombatantIndex: b.activeCombatantIndex,
            combatRound: b.combatRound,
            rollHistory: b.rollHistory
        };
        return JSON.stringify(sharedA) === JSON.stringify(sharedB);
    } catch (e) {
        return false;
    }
}

function startPollingSync() {
    if (!IS_SERVER_MODE) return;
    
    setInterval(async () => {
        try {
            const response = await fetch('/api/state');
            if (response.ok) {
                const fetchedState = await response.json();
                
                // Compare only shared properties to avoid syncing local UI states
                if (!isSharedStateEqual(state, fetchedState)) {
                    if (!isUserEditing()) {
                        // Update local shared state properties
                        state.campaigns = fetchedState.campaigns || [];
                        state.combatants = fetchedState.combatants || [];
                        state.activeCombatantIndex = fetchedState.activeCombatantIndex || 0;
                        state.combatRound = fetchedState.combatRound || 1;
                        state.rollHistory = fetchedState.rollHistory || [];
                        
                        // Local backup update
                        try {
                            localStorage.setItem('dnd_campaign_state', JSON.stringify(state));
                        } catch (e) {}
                        
                        // Update UI
                        renderCampaignSelector();
                        renderAll();
                        console.log('Campaign state synchronized from server.');
                    } else {
                        console.log('Campaign sync deferred because user is actively typing or editing a modal.');
                    }
                }
            }
        } catch (e) {
            console.warn('Error during background state sync polling:', e);
        }
    }, 3000);
}

function resetToDefaults() {
    const defaultCampaign = {
        id: "phandelver",
        name: "Lost Mine of Phandelver",
        mapImage: "phandelver-map-exterior-player.webp",
        characters: JSON.parse(JSON.stringify(INITIAL_CHARACTER_DATA)),
        sessionLogs: JSON.parse(JSON.stringify(INITIAL_SESSION_LOGS)),
        mapMarkers: JSON.parse(JSON.stringify(INITIAL_MAP_MARKERS)),
        partyPosition: JSON.parse(JSON.stringify(INITIAL_PARTY_POSITION))
    };
    
    state.campaigns = [defaultCampaign];
    state.activeCampaignId = "phandelver";
    state.activeCharacterId = 'Elowen';
    state.zoomLevel = 1.0;
    state.combatants = initDefaultCombatants(defaultCampaign.characters);
    state.activeCombatantIndex = 0;
    state.combatRound = 1;
    state.rollHistory = [];
    saveState();
}

function initDefaultCombatants(chars) {
    return Object.keys(chars).map(key => {
        const c = chars[key];
        return {
            name: c.name,
            initiative: 0,
            hp: c.hp.current || c.hp.max || 20,
            maxHp: c.hp.max || 20,
            isMonster: false
        };
    });
}

// ----------------------------------------------------
// Navigation Controller
// ----------------------------------------------------
function initNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
            
            item.classList.add('active');
            const targetPanelId = item.getAttribute('data-target');
            const targetPanel = document.getElementById(targetPanelId);
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
            
            if (targetPanelId === 'panel-map') {
                renderMapMarkers();
            } else if (targetPanelId === 'panel-characters') {
                renderCharacterTabs();
                renderSelectedCharacter();
            } else if (targetPanelId === 'panel-combat') {
                renderInitiativeList();
                renderRollHistory();
            } else if (targetPanelId === 'panel-logs') {
                renderSessionLogsList();
            }
        });
    });
}

// ----------------------------------------------------
// 1. Map Panel Controller & Drag-Drop Logic
// ----------------------------------------------------
function initMapPanel() {
    const container = document.getElementById('map-image-container');
    const token = document.getElementById('party-token');
    
    // Zooming Controls
    document.getElementById('map-zoom-in').addEventListener('click', () => {
        state.zoomLevel = Math.min(state.zoomLevel + 0.25, 3.0);
        applyZoom();
    });
    document.getElementById('map-zoom-out').addEventListener('click', () => {
        state.zoomLevel = Math.max(state.zoomLevel - 0.25, 0.5);
        applyZoom();
    });
    document.getElementById('map-zoom-reset').addEventListener('click', () => {
        state.zoomLevel = 1.0;
        applyZoom();
    });
    
    function applyZoom() {
        container.style.transform = `scale(${state.zoomLevel})`;
        saveState();
    }
    
    // Add Marker Mode Button
    const addMarkerBtn = document.getElementById('btn-add-marker-modal');
    addMarkerBtn.addEventListener('click', () => {
        state.isAddingMarker = true;
        addMarkerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Click on the Map...';
        addMarkerBtn.classList.add('btn-dnd-success');
    });

    const mapImg = document.getElementById('map-image');
    mapImg.addEventListener('click', (e) => {
        const rect = mapImg.getBoundingClientRect();
        const scaleX = mapImg.naturalWidth / rect.width;
        const scaleY = mapImg.naturalHeight / rect.height;
        
        const clickX = Math.round((e.clientX - rect.left) * scaleX);
        const clickY = Math.round((e.clientY - rect.top) * scaleY);
        
        if (state.isAddingMarker) {
            state.isAddingMarker = false;
            addMarkerBtn.innerHTML = '<i class="fa-solid fa-map-pin"></i> Add Location Pin';
            addMarkerBtn.classList.remove('btn-dnd-success');
            
            openAddMarkerModal(clickX, clickY);
        } else {
            showMarkerDetails(null);
        }
    });

    // Draggable token
    let isDragging = false;
    let startX = 0, startY = 0;
    let tokenX = 0, tokenY = 0;
    
    token.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        
        const active = getActiveCampaign();
        tokenX = active.partyPosition.x;
        tokenY = active.partyPosition.y;
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        
        showPartyDetails();
    });
    
    function onMouseMove(e) {
        if (!isDragging) return;
        const active = getActiveCampaign();
        
        const dx = (e.clientX - startX) / state.zoomLevel;
        const dy = (e.clientY - startY) / state.zoomLevel;
        
        let newX = tokenX + dx;
        let newY = tokenY + dy;
        
        newX = Math.max(0, Math.min(mapImg.naturalWidth, newX));
        newY = Math.max(0, Math.min(mapImg.naturalHeight, newY));
        
        token.style.left = `${newX}px`;
        token.style.top = `${newY}px`;
        
        active.partyPosition.x = Math.round(newX);
        active.partyPosition.y = Math.round(newY);
    }
    
    function onMouseUp(e) {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        
        saveState();
        showPartyDetails();
    }
    
    // Update party log button
    document.getElementById('btn-update-party-loc').addEventListener('click', () => {
        const active = getActiveCampaign();
        document.getElementById('party-location-input').value = active.partyPosition.lastUpdated;
        document.getElementById('modal-party-location').style.display = 'flex';
    });
    
    document.getElementById('btn-save-party-location').addEventListener('click', () => {
        const active = getActiveCampaign();
        const val = document.getElementById('party-location-input').value.trim();
        active.partyPosition.lastUpdated = val || "Active travel";
        saveState();
        showPartyDetails();
        document.getElementById('modal-party-location').style.display = 'none';
    });
}

function renderMapMarkers() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const layer = document.getElementById('map-markers-layer');
    layer.innerHTML = '';
    
    // Set map image src
    const mapImg = document.getElementById('map-image');
    mapImg.src = active.mapImage || 'phandelver-map-exterior-player.webp';
    
    // Render location markers
    active.mapMarkers.forEach(marker => {
        const pin = document.createElement('div');
        pin.className = `map-marker ${marker.type || 'town'}`;
        pin.style.left = `${marker.x}px`;
        pin.style.top = `${marker.y}px`;
        pin.setAttribute('data-id', marker.id);
        pin.title = marker.name;
        
        pin.addEventListener('click', (e) => {
            e.stopPropagation();
            showMarkerDetails(marker);
        });
        
        layer.appendChild(pin);
    });
    
    // Render party token position
    const token = document.getElementById('party-token');
    token.style.left = `${active.partyPosition.x}px`;
    token.style.top = `${active.partyPosition.y}px`;
    
    // Set map transform scale
    document.getElementById('map-image-container').style.transform = `scale(${state.zoomLevel})`;
}

function showMarkerDetails(marker) {
    const active = getActiveCampaign();
    const placeholder = document.getElementById('marker-details-placeholder');
    const content = document.getElementById('marker-content');
    
    if (!marker) {
        placeholder.style.display = 'flex';
        content.style.display = 'none';
        return;
    }
    
    placeholder.style.display = 'none';
    content.style.display = 'block';
    
    document.getElementById('marker-name').innerText = marker.name;
    document.getElementById('marker-description').innerText = marker.description || 'No notes.';
    
    const badge = document.getElementById('marker-type-badge');
    badge.innerText = marker.type || 'town';
    badge.className = `marker-badge ${marker.type || 'town'}`;
    
    // Edit & delete handlers
    document.getElementById('btn-edit-marker').onclick = () => {
        openEditMarkerModal(marker);
    };
    
    document.getElementById('btn-delete-marker').onclick = () => {
        if (confirm(`Are you sure you want to delete the marker for ${marker.name}?`)) {
            active.mapMarkers = active.mapMarkers.filter(m => m.id !== marker.id);
            saveState();
            renderMapMarkers();
            showMarkerDetails(null);
        }
    };
}

function showPartyDetails() {
    const active = getActiveCampaign();
    const placeholder = document.getElementById('marker-details-placeholder');
    const content = document.getElementById('marker-content');
    
    placeholder.style.display = 'none';
    content.style.display = 'block';
    
    document.getElementById('marker-name').innerHTML = '<i class="fa-solid fa-shield-halved"></i> The Adventurers';
    document.getElementById('marker-description').innerText = `Current Location & Status: \n${active.partyPosition.lastUpdated}\n\nCoords: X:${active.partyPosition.x}, Y:${active.partyPosition.y}`;
    
    const badge = document.getElementById('marker-type-badge');
    badge.innerText = 'Party Token';
    badge.className = 'marker-badge landmark';
    
    document.getElementById('btn-edit-marker').onclick = () => {
        document.getElementById('party-location-input').value = active.partyPosition.lastUpdated;
        document.getElementById('modal-party-location').style.display = 'flex';
    };
    
    document.getElementById('btn-delete-marker').style.display = 'none';
    
    const oldShowMarkerDetails = showMarkerDetails;
    showMarkerDetails = (m) => {
        document.getElementById('btn-delete-marker').style.display = m ? 'inline-flex' : 'none';
        oldShowMarkerDetails(m);
    };
    
    document.getElementById('party-loc-desc').innerText = active.partyPosition.lastUpdated;
}

// ----------------------------------------------------
// 2. Character Sheet Controller & Level-up Logic
// ----------------------------------------------------
function initCharacterPanel() {
    document.getElementById('btn-damage-hp').addEventListener('click', () => {
        openHPModal('damage');
    });
    
    document.getElementById('btn-heal-hp').addEventListener('click', () => {
        openHPModal('heal');
    });
    
    document.getElementById('btn-edit-char-modal').addEventListener('click', () => {
        openEditCharSpecsModal();
    });
}

function renderCharacterTabs() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const bar = document.getElementById('char-select-bar');
    bar.innerHTML = '';
    
    const charKeys = Object.keys(active.characters);
    
    // Ensure activeCharacterId exists in current campaign characters
    if (charKeys.length > 0 && !charKeys.includes(state.activeCharacterId)) {
        state.activeCharacterId = charKeys[0];
    }
    
    charKeys.forEach(key => {
        const c = active.characters[key];
        const tab = document.createElement('div');
        tab.className = `char-tab ${state.activeCharacterId === key ? 'active' : ''}`;
        tab.addEventListener('click', () => {
            state.activeCharacterId = key;
            saveState();
            renderCharacterTabs();
            renderSelectedCharacter();
        });
        
        const firstLetter = c.name.charAt(0);
        
        tab.innerHTML = `
            <div class="char-tab-avatar">${firstLetter}</div>
            <div class="char-tab-meta">
                <h4>${c.name.split(' ')[0]}</h4>
                <p>Level ${c.level} ${c.class.split(' ')[0]}</p>
            </div>
        `;
        bar.appendChild(tab);
    });
}

function renderSelectedCharacter() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const c = active.characters[state.activeCharacterId];
    if (!c) {
        // No character found panel placeholder
        return;
    }
    
    // Core summary data
    document.getElementById('char-species').innerText = c.species || 'Unknown';
    document.getElementById('char-class').innerText = `${c.class} ${c.subclass ? '(' + c.subclass + ')' : ''}`;
    document.getElementById('char-level').innerText = c.level;
    document.getElementById('char-xp').innerText = c.xp || '0';
    document.getElementById('char-background').innerText = c.background || 'None';
    
    // Combat specs
    document.getElementById('char-hp-current').innerText = c.hp.current;
    document.getElementById('char-hp-max').innerText = c.hp.max;
    document.getElementById('char-ac').innerText = c.ac;
    document.getElementById('char-speed').innerText = c.speed || '30 ft';
    
    const initVal = c.initiative || '+0';
    document.getElementById('char-initiative').innerText = initVal;
    document.getElementById('char-initiative').onclick = () => {
        rollForCharacter(c.name, 'Initiative Check', initVal);
    };
    
    // Backstory
    document.getElementById('char-backstory').innerText = c.backstory || 'No biography written.';
    document.getElementById('char-equipment').innerText = c.equipment || 'No items listed.';
    
    // Abilities list
    const abCont = document.getElementById('char-abilities-container');
    abCont.innerHTML = '';
    
    const abilityOrder = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
    abilityOrder.forEach(ab => {
        if (!c.abilities[ab]) {
            c.abilities[ab] = { score: 10, mod: '+0' };
        }
        const score = c.abilities[ab].score;
        const mod = c.abilities[ab].mod;
        
        const card = document.createElement('div');
        card.className = 'ability-card';
        card.innerHTML = `
            <span class="ability-name">${ab}</span>
            <span class="ability-mod" title="Click to roll ${ab} check!">${mod}</span>
            <span class="ability-score">${score}</span>
        `;
        
        card.querySelector('.ability-mod').addEventListener('click', () => {
            rollForCharacter(c.name, `${ab} Ability Check`, mod);
        });
        
        abCont.appendChild(card);
    });
    
    // Saving throws list
    const savesCont = document.getElementById('char-saves-container');
    savesCont.innerHTML = '';
    
    Object.keys(c.saves).forEach(save => {
        const val = c.saves[save];
        const isProf = val !== c.abilities[save].mod;
        
        const item = document.createElement('div');
        item.className = 'save-item';
        item.innerHTML = `
            <span class="save-label">
                <span class="prof-dot ${isProf ? 'proficient' : ''}"></span>
                ${save} Save
            </span>
            <span class="save-val" title="Roll ${save} Saving Throw!">${val}</span>
        `;
        
        item.querySelector('.save-val').addEventListener('click', () => {
            rollForCharacter(c.name, `${save} Saving Throw`, val);
        });
        
        savesCont.appendChild(item);
    });
    
    // Skills list
    const skillsCont = document.getElementById('char-skills-container');
    skillsCont.innerHTML = '';
    
    const skillList = [
        { key: 'acrobatics', label: 'Acrobatics', ab: 'DEX' },
        { key: 'animalHandling', label: 'Animal Handling', ab: 'WIS' },
        { key: 'arcana', label: 'Arcana', ab: 'INT' },
        { key: 'athletics', label: 'Athletics', ab: 'STR' },
        { key: 'deception', label: 'Deception', ab: 'CHA' },
        { key: 'history', label: 'History', ab: 'INT' },
        { key: 'insight', label: 'Insight', ab: 'WIS' },
        { key: 'intimidation', label: 'Intimidation', ab: 'CHA' },
        { key: 'investigation', label: 'Investigation', ab: 'INT' },
        { key: 'medicine', label: 'Medicine', ab: 'WIS' },
        { key: 'nature', label: 'Nature', ab: 'INT' },
        { key: 'perception', label: 'Perception', ab: 'WIS' },
        { key: 'performance', label: 'Performance', ab: 'CHA' },
        { key: 'persuasion', label: 'Persuasion', ab: 'CHA' },
        { key: 'religion', label: 'Religion', ab: 'INT' },
        { key: 'sleightOfHand', label: 'Sleight of Hand', ab: 'DEX' },
        { key: 'stealth', label: 'Stealth', ab: 'DEX' },
        { key: 'survival', label: 'Survival', ab: 'WIS' }
    ];
    
    skillList.forEach(s => {
        const val = c.skills[s.key] || '+0';
        const isProf = val !== c.abilities[s.ab].mod;
        
        const item = document.createElement('div');
        item.className = 'skill-item';
        item.innerHTML = `
            <span class="skill-label">
                <span class="prof-dot ${isProf ? 'proficient' : ''}"></span>
                ${s.label} <span style="font-size: 0.7rem; color: var(--text-muted);">(${s.ab})</span>
            </span>
            <span class="skill-val" title="Roll ${s.label} check!">${val}</span>
        `;
        
        item.querySelector('.skill-val').addEventListener('click', () => {
            rollForCharacter(c.name, `${s.label} Skill Check`, val);
        });
        
        skillsCont.appendChild(item);
    });
    
    // Weapons and attacks list
    const weaponsCont = document.getElementById('char-weapons-container');
    weaponsCont.innerHTML = '';
    
    if (!c.weapons || c.weapons.length === 0) {
        weaponsCont.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic;">No weapons equipped.</p>';
    } else {
        c.weapons.forEach(w => {
            const row = document.createElement('div');
            row.className = 'weapon-row';
            row.innerHTML = `
                <span class="weapon-name" style="cursor: pointer; color: var(--border-gold);" title="Roll Attack!">${w.name}</span>
                <span class="weapon-bonus" style="font-family: var(--font-heading); font-weight: 700; color: var(--border-gold); cursor: pointer;" title="Roll Attack!">${w.bonus}</span>
                <span class="weapon-dmg" style="cursor: pointer; text-decoration: underline;" title="Roll Damage!">${w.damage}</span>
                <span class="weapon-notes">${w.notes || ''}</span>
            `;
            
            const rollAttack = () => {
                const attackRoll = rollDie(20);
                const bonusInt = parseInt(w.bonus) || 0;
                const total = attackRoll + bonusInt;
                let detail = `Natural ${attackRoll} + ${bonusInt} bonus`;
                let crit = '';
                if (attackRoll === 20) { crit = ' (CRITICAL HIT!)'; }
                if (attackRoll === 1) { crit = ' (CRITICAL FUMBLE!)'; }
                
                logRoll(c.name, `Attack: ${w.name}`, total, `Rolled d20: ${detail}${crit}`, attackRoll);
                switchToCombatPanel();
            };
            
            row.querySelector('.weapon-name').addEventListener('click', rollAttack);
            row.querySelector('.weapon-bonus').addEventListener('click', rollAttack);
            
            row.querySelector('.weapon-dmg').addEventListener('click', () => {
                const dmgStr = w.damage.toLowerCase();
                const match = dmgStr.match(/(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?/);
                
                if (match) {
                    const count = parseInt(match[1]);
                    const sides = parseInt(match[2]);
                    const sign = match[3];
                    const mod = match[4] ? parseInt(match[4]) : 0;
                    
                    let rolls = [];
                    let sum = 0;
                    for (let i = 0; i < count; i++) {
                        const r = rollDie(sides);
                        rolls.push(r);
                        sum += r;
                    }
                    
                    let modifier = 0;
                    if (sign && mod) {
                        modifier = sign === '+' ? mod : -mod;
                    }
                    
                    const total = sum + modifier;
                    const damageType = dmgStr.split(' ').slice(2).join(' ') || 'damage';
                    const detail = `[${rolls.join(',')}]${modifier !== 0 ? ' ' + sign + ' ' + Math.abs(modifier) : ''}`;
                    
                    logRoll(c.name, `Damage: ${w.name}`, total, `Rolled ${count}d${sides}: ${detail} (${damageType})`);
                    switchToCombatPanel();
                } else {
                    const total = rollDie(6);
                    logRoll(c.name, `Damage: ${w.name}`, total, `Rolled 1d6 damage.`);
                    switchToCombatPanel();
                }
            });
            
            weaponsCont.appendChild(row);
        });
    }
    
    // Spells list
    const spellsCont = document.getElementById('char-spells-container');
    spellsCont.innerHTML = '';
    
    if (!c.spells || c.spells.length === 0) {
        spellsCont.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic;">No spells prepared.</p>';
    } else {
        c.spells.forEach(s => {
            const row = document.createElement('div');
            row.className = 'spell-row';
            
            const levelLabel = s.level === 0 ? 'Cantrip' : `Level ${s.level}`;
            const timeRange = `${s.castingTime || 'Action'} / ${s.range || 'Self'}`;
            
            row.innerHTML = `
                <span class="spell-name" style="cursor: pointer; color: var(--border-gold);" title="Roll Spell!">${s.name}</span>
                <span class="spell-level" style="font-size: 0.8rem;">${levelLabel}</span>
                <span class="spell-meta">${timeRange}</span>
                <span class="spell-notes">${s.notes || ''}</span>
            `;
            
            row.querySelector('.spell-name').addEventListener('click', () => {
                const notes = s.notes || '';
                const matchDmg = notes.match(/(\d+)d(\d+)/i);
                
                if (matchDmg) {
                    const count = parseInt(matchDmg[1]);
                    const sides = parseInt(matchDmg[2]);
                    let rolls = [];
                    let sum = 0;
                    for (let i = 0; i < count; i++) {
                        const r = rollDie(sides);
                        rolls.push(r);
                        sum += r;
                    }
                    
                    let spellAttackText = '';
                    let totalRoll = sum;
                    
                    if (notes.toLowerCase().includes('attack')) {
                        const attackRoll = rollDie(20);
                        const spellBonus = parseInt(c.spellcasting.attackBonus) || 0;
                        const attackTotal = attackRoll + spellBonus;
                        spellAttackText = `Attack Roll: ${attackTotal} (d20: ${attackRoll} + ${spellBonus}), `;
                    }
                    
                    logRoll(c.name, `Cast: ${s.name}`, totalRoll, `Rolled ${count}d${sides}: [${rolls.join(',')}] (${spellAttackText}Notes: ${notes})`);
                    switchToCombatPanel();
                } else {
                    logRoll(c.name, `Cast: ${s.name}`, '-', `Prepared Spell level ${s.level} cast (Notes: ${notes})`);
                    switchToCombatPanel();
                }
            });
            
            spellsCont.appendChild(row);
        });
    }
    
    // Spell slots
    const slotsCard = document.getElementById('char-spell-slots-card');
    const slotsCont = document.getElementById('char-spell-slots-container');
    slotsCont.innerHTML = '';
    
    let hasSlots = false;
    if (c.spellcasting && c.spellcasting.slots) {
        Object.keys(c.spellcasting.slots).forEach(lvl => {
            const slot = c.spellcasting.slots[lvl];
            if (slot.total > 0) {
                hasSlots = true;
                
                const slotNum = lvl.replace('lvl', '');
                const row = document.createElement('div');
                row.className = 'spell-slot-row';
                
                const label = document.createElement('span');
                label.innerText = `Level ${slotNum} Slots (${slot.total})`;
                row.appendChild(label);
                
                const bubbles = document.createElement('div');
                bubbles.className = 'spell-slot-bubbles';
                
                for (let i = 0; i < slot.total; i++) {
                    const bubble = document.createElement('span');
                    bubble.className = `slot-bubble ${i < (slot.total - (slot.expended || 0)) ? 'active' : 'expended'}`;
                    
                    bubble.addEventListener('click', () => {
                        const currentExpended = slot.expended || 0;
                        if (i < (slot.total - currentExpended)) {
                            slot.expended = slot.total - i;
                        } else {
                            slot.expended = slot.total - i - 1;
                        }
                        saveState();
                        renderSelectedCharacter();
                    });
                    
                    bubbles.appendChild(bubble);
                }
                
                row.appendChild(bubbles);
                slotsCont.appendChild(row);
            }
        });
    }
    
    slotsCard.style.display = hasSlots ? 'block' : 'none';

    renderCharacterResources(c);
    renderCoins(c);
}

/* ---------------- Limited-use resources & rests ---------------- */

function renderCharacterResources(c) {
    const cont = document.getElementById('char-resources-container');
    if (!cont) return;
    cont.innerHTML = '';

    if (!Array.isArray(c.resources) || c.resources.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'resource-empty';
        empty.innerText = 'No tracked resources yet.';
        cont.appendChild(empty);
        return;
    }

    c.resources.forEach((r, idx) => {
        const row = document.createElement('div');
        row.className = 'resource-row';

        const name = document.createElement('span');
        name.className = 'resource-name';
        name.innerText = r.name;
        name.title = 'Click to rename';
        name.addEventListener('click', () => {
            const next = prompt('Resource name:', r.name);
            if (next !== null && next.trim()) {
                r.name = next.trim();
                saveState();
                renderSelectedCharacter();
            }
        });
        row.appendChild(name);

        const tag = document.createElement('span');
        tag.className = 'resource-reset-tag reset-' + (r.reset || 'long');
        tag.innerText = r.reset === 'short' ? 'Short' : r.reset === 'manual' ? 'Manual' : 'Long';
        tag.title = 'Click to change when this refills';
        tag.addEventListener('click', () => {
            const order = ['long', 'short', 'manual'];
            r.reset = order[(order.indexOf(r.reset || 'long') + 1) % order.length];
            saveState();
            renderSelectedCharacter();
        });
        row.appendChild(tag);

        const ctrl = document.createElement('div');
        ctrl.className = 'resource-ctrl';

        const minus = document.createElement('button');
        minus.className = 'resource-btn';
        minus.innerText = '\u2212';
        minus.addEventListener('click', () => {
            r.current = Math.max(0, (r.current || 0) - 1);
            saveState();
            renderSelectedCharacter();
        });
        ctrl.appendChild(minus);

        const val = document.createElement('span');
        val.className = 'resource-value' + ((r.current || 0) === 0 ? ' depleted' : '');
        val.innerText = `${r.current || 0} / ${r.max || 0}`;
        ctrl.appendChild(val);

        const plus = document.createElement('button');
        plus.className = 'resource-btn';
        plus.innerText = '+';
        plus.addEventListener('click', () => {
            r.current = Math.min(r.max || 0, (r.current || 0) + 1);
            saveState();
            renderSelectedCharacter();
        });
        ctrl.appendChild(plus);

        const del = document.createElement('button');
        del.className = 'resource-btn resource-del';
        del.innerText = '\u00d7';
        del.title = 'Remove this resource';
        del.addEventListener('click', () => {
            if (confirm(`Remove "${r.name}"?`)) {
                c.resources.splice(idx, 1);
                saveState();
                renderSelectedCharacter();
            }
        });
        ctrl.appendChild(del);

        row.appendChild(ctrl);
        cont.appendChild(row);
    });
}

function applyRest(c, kind) {
    const notes = [];

    if (kind === 'long') {
        c.hp.current = c.hp.max;
        c.hp.temp = 0;
        notes.push('HP restored to full');
    }

    // Spell slots. Warlock pact slots come back on a short rest too.
    const isWarlock = (c.class || '').includes('Warlock');
    if (c.spellcasting && c.spellcasting.slots) {
        let restored = 0;
        Object.values(c.spellcasting.slots).forEach(slot => {
            if (kind === 'long' || isWarlock) {
                if (slot.expended) restored += slot.expended;
                slot.expended = 0;
            }
        });
        if (restored > 0) {
            notes.push(`${restored} spell slot${restored === 1 ? '' : 's'} restored`);
        }
    }

    let resCount = 0;
    (c.resources || []).forEach(r => {
        if (r.reset === 'manual') return;
        if (kind === 'long' || r.reset === 'short') {
            if (r.current !== r.max) resCount++;
            r.current = r.max;
        }
    });
    if (resCount > 0) {
        notes.push(`${resCount} resource${resCount === 1 ? '' : 's'} refilled`);
    }

    // Keep the combat tracker in step after a long rest.
    if (kind === 'long') {
        (state.combatants || []).forEach(cb => {
            if (cb.name === c.name) {
                cb.hp = c.hp.current;
                cb.maxHp = c.hp.max;
            }
        });
    }

    return notes;
}

/* ---------------- Coin purse ---------------- */

const COIN_TYPES = [
    { key: 'pp', label: 'PP', title: 'Platinum', rate: 10 },
    { key: 'gp', label: 'GP', title: 'Gold', rate: 1 },
    { key: 'ep', label: 'EP', title: 'Electrum', rate: 0.5 },
    { key: 'sp', label: 'SP', title: 'Silver', rate: 0.1 },
    { key: 'cp', label: 'CP', title: 'Copper', rate: 0.01 }
];

function renderCoins(c) {
    const cont = document.getElementById('char-coins-container');
    if (!cont) return;
    if (!c.coins) c.coins = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
    cont.innerHTML = '';

    COIN_TYPES.forEach(ct => {
        const box = document.createElement('div');
        box.className = 'coin-box coin-' + ct.key;

        const lab = document.createElement('div');
        lab.className = 'coin-label';
        lab.innerText = ct.label;
        lab.title = ct.title;
        box.appendChild(lab);

        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.className = 'coin-input';
        input.value = c.coins[ct.key] || 0;
        input.addEventListener('change', () => {
            const v = parseInt(input.value, 10);
            c.coins[ct.key] = Number.isFinite(v) && v >= 0 ? v : 0;
            saveState();
            renderSelectedCharacter();
        });
        box.appendChild(input);

        cont.appendChild(box);
    });

    const total = COIN_TYPES.reduce((sum, ct) => sum + (c.coins[ct.key] || 0) * ct.rate, 0);
    const totalEl = document.getElementById('char-coin-total');
    if (totalEl) {
        totalEl.innerText = `${Math.round(total * 100) / 100} gp total`;
    }
}

/* ---------------- DM notes (server-side, PIN gated) ---------------- */

const dmState = { pin: null, dirty: false, saveTimer: null };

function dmShow(which) {
    ['dm-setup', 'dm-locked', 'dm-editor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = (id === which) ? 'block' : 'none';
    });
    const unlocked = which === 'dm-editor';
    ['btn-dm-save', 'btn-dm-lock', 'btn-dm-change-pin'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = unlocked ? 'inline-flex' : 'none';
    });
}

async function dmApi(action, payload) {
    const res = await fetch(`/api/dm-notes/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
    });
    let data = {};
    try { data = await res.json(); } catch (e) { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
}

async function refreshDmGate() {
    try {
        const res = await fetch('/api/dm-notes/status', { cache: 'no-store' });
        const { configured } = await res.json();
        dmShow(configured ? 'dm-locked' : 'dm-setup');
    } catch (e) {
        // Offline / opened as a plain file: no server to hold private notes.
        dmShow('dm-locked');
        const err = document.getElementById('dm-error');
        if (err) err.innerText = 'Cannot reach the server, so DM notes are unavailable.';
    }
}

function dmSetStatus(msg, isError) {
    const el = document.getElementById('dm-status');
    if (!el) return;
    el.innerText = msg;
    el.className = 'dm-status' + (isError ? ' dm-status-error' : '');
}

function initDmPanel() {
    const setupBtn = document.getElementById('btn-dm-setup');
    const unlockBtn = document.getElementById('btn-dm-unlock');
    const saveBtn = document.getElementById('btn-dm-save');
    const lockBtn = document.getElementById('btn-dm-lock');
    const changeBtn = document.getElementById('btn-dm-change-pin');
    const textEl = document.getElementById('dm-notes-text');

    if (setupBtn) {
        setupBtn.addEventListener('click', async () => {
            const a = document.getElementById('dm-setup-pin').value;
            const b = document.getElementById('dm-setup-pin2').value;
            const err = document.getElementById('dm-setup-error');
            err.innerText = '';
            if (a.length < 4) { err.innerText = 'PIN must be at least 4 characters.'; return; }
            if (a !== b) { err.innerText = 'The two PINs do not match.'; return; }
            const r = await dmApi('setup', { pin: a });
            if (r.ok) {
                dmState.pin = a;
                textEl.value = '';
                dmShow('dm-editor');
                dmSetStatus('PIN set. These notes are stored on the Beelink.');
            } else {
                err.innerText = r.data.error || 'Could not set the PIN.';
            }
        });
    }

    if (unlockBtn) {
        const tryUnlock = async () => {
            const pin = document.getElementById('dm-pin').value;
            const err = document.getElementById('dm-error');
            err.innerText = '';
            const r = await dmApi('unlock', { pin });
            if (r.ok) {
                dmState.pin = pin;
                textEl.value = r.data.notes || '';
                document.getElementById('dm-pin').value = '';
                dmShow('dm-editor');
                dmSetStatus('Unlocked.');
            } else {
                err.innerText = r.data.error || 'Could not unlock.';
            }
        };
        unlockBtn.addEventListener('click', tryUnlock);
        const pinEl = document.getElementById('dm-pin');
        if (pinEl) {
            pinEl.addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
        }
    }

    const doSave = async () => {
        if (!dmState.pin) return;
        const r = await dmApi('save', { pin: dmState.pin, notes: textEl.value });
        if (r.ok) {
            dmState.dirty = false;
            dmSetStatus('Saved ' + new Date().toLocaleTimeString());
        } else {
            dmSetStatus(r.data.error || 'Save failed.', true);
        }
    };

    if (saveBtn) saveBtn.addEventListener('click', doSave);

    if (textEl) {
        textEl.addEventListener('input', () => {
            dmState.dirty = true;
            dmSetStatus('Unsaved changes...');
            clearTimeout(dmState.saveTimer);
            dmState.saveTimer = setTimeout(doSave, 1500);   // autosave
        });
    }

    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            if (dmState.dirty && !confirm('You have unsaved changes. Lock anyway?')) return;
            dmState.pin = null;
            textEl.value = '';
            dmSetStatus('');
            dmShow('dm-locked');
        });
    }

    if (changeBtn) {
        changeBtn.addEventListener('click', async () => {
            const next = prompt('New DM PIN (at least 4 characters):');
            if (!next) return;
            if (next.length < 4) { alert('PIN must be at least 4 characters.'); return; }
            const r = await dmApi('change-pin', { pin: dmState.pin, newPin: next });
            if (r.ok) {
                dmState.pin = next;
                dmSetStatus('PIN changed.');
            } else {
                dmSetStatus(r.data.error || 'Could not change the PIN.', true);
            }
        });
    }

    // Re-lock whenever the DM navigates away from the panel.
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.dataset.target === 'panel-dm') {
                if (!dmState.pin) refreshDmGate();
            } else if (dmState.pin) {
                if (dmState.dirty) doSave();
                dmState.pin = null;
                if (textEl) textEl.value = '';
                dmShow('dm-locked');
            }
        });
    });

    refreshDmGate();
}

function initRestButtons() {
    const shortBtn = document.getElementById('btn-short-rest');
    const longBtn = document.getElementById('btn-long-rest');
    const addBtn = document.getElementById('btn-add-resource');

    const currentChar = () => {
        const active = getActiveCampaign();
        return active ? active.characters[state.activeCharacterId] : null;
    };

    if (shortBtn) {
        shortBtn.addEventListener('click', () => {
            const c = currentChar();
            if (!c) return;
            const notes = applyRest(c, 'short');
            saveState();
            renderAll();
            alert(`${c.name} takes a short rest.\n\n` +
                  (notes.length ? notes.join('\n') : 'Nothing needed restoring.') +
                  '\n\nAbilities set to "Manual" were left alone.');
        });
    }

    if (longBtn) {
        longBtn.addEventListener('click', () => {
            const c = currentChar();
            if (!c) return;
            if (!confirm(`Long rest for ${c.name}?\n\nThis restores HP to full, clears temp HP, refills every spell slot and resets all resources except those marked Manual.`)) return;
            const notes = applyRest(c, 'long');
            saveState();
            renderAll();
            alert(`${c.name} finishes a long rest.\n\n` + notes.join('\n'));
        });
    }

    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const c = currentChar();
            if (!c) return;
            const name = prompt('Name of the ability or resource:');
            if (!name || !name.trim()) return;
            const max = parseInt(prompt('How many uses?', '1'), 10);
            if (!Number.isFinite(max) || max < 0) return;
            if (!Array.isArray(c.resources)) c.resources = [];
            c.resources.push({
                name: name.trim(),
                current: max,
                max: max,
                reset: 'long'
            });
            saveState();
            renderSelectedCharacter();
        });
    }
}

function rollForCharacter(charName, checkName, modStr) {
    const d20 = rollDie(20);
    const mod = parseInt(modStr) || 0;
    const total = d20 + mod;
    
    let critique = '';
    if (d20 === 20) critique = ' (CRITICAL SUCCESS!)';
    if (d20 === 1) critique = ' (CRITICAL FAILURE!)';
    
    logRoll(charName, checkName, total, `Rolled d20: Natural ${d20} + ${mod} modifier${critique}`, d20);
    switchToCombatPanel();
}

function switchToCombatPanel() {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));
    
    const navCombat = document.querySelector('.nav-item[data-target="panel-combat"]');
    if (navCombat) navCombat.classList.add('active');
    
    const panelCombat = document.getElementById('panel-combat');
    if (panelCombat) panelCombat.classList.add('active');
    
    renderInitiativeList();
    renderRollHistory();
}

const SKILL_ABILITIES = {
    acrobatics: 'DEX', animalHandling: 'WIS', arcana: 'INT', athletics: 'STR',
    deception: 'CHA', history: 'INT', insight: 'WIS', intimidation: 'CHA',
    investigation: 'INT', medicine: 'WIS', nature: 'INT', perception: 'WIS',
    performance: 'CHA', persuasion: 'CHA', religion: 'INT', sleightOfHand: 'DEX',
    stealth: 'DEX', survival: 'WIS'
};

const DEFAULT_CLASS_SAVES = {
    Artificer: ['CON', 'INT'], Barbarian: ['STR', 'CON'], Bard: ['DEX', 'CHA'],
    Cleric: ['WIS', 'CHA'], Druid: ['INT', 'WIS'], Fighter: ['STR', 'CON'],
    Monk: ['STR', 'DEX'], Paladin: ['WIS', 'CHA'], Ranger: ['STR', 'DEX'],
    Rogue: ['DEX', 'INT'], Sorcerer: ['CON', 'CHA'], Warlock: ['WIS', 'CHA'],
    Wizard: ['INT', 'WIS']
};

function signed(n) {
    return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * One-time migration: older saves stored only the final skill/save totals with
 * no record of WHICH proficiencies produced them. Infer them once from the
 * current numbers, write the flags down, and never guess again.
 */
function ensureProficiencyFlags(c) {
    if (!c || !c.abilities) return;
    const prof = parseInt(c.proficiencyBonus) || 2;
    const modOf = (ab) => Math.floor(((c.abilities[ab] || {}).score - 10) / 2) || 0;

    // Prefer the authoritative flags shipped in data.js for known characters.
    // Inference is only a fallback for characters we have no reference for,
    // because a stored total can't distinguish proficiency from a misc bonus.
    let seed = null;
    try {
        if (typeof INITIAL_CHARACTER_DATA !== 'undefined') {
            seed = Object.values(INITIAL_CHARACTER_DATA)
                .find(s => s && s.name === c.name && s.skillProfs);
        }
    } catch (e) { /* seed data unavailable; fall through to inference */ }

    if (!c.saveProfs) {
        if (seed && seed.saveProfs) {
            c.saveProfs = [...seed.saveProfs];
        } else {
            const inferred = [];
            Object.keys(c.saves || {}).forEach(ab => {
                if ((parseInt(c.saves[ab]) || 0) - modOf(ab) >= prof) inferred.push(ab);
            });
            c.saveProfs = inferred.length
                ? inferred
                : (DEFAULT_CLASS_SAVES[(c.class || '').split(' ')[0]] || []);
        }
    }

    if (!c.skillMisc) {
        c.skillMisc = seed && seed.skillMisc ? { ...seed.skillMisc } : {};
        // Druid Primal Order (Magician) adds the WIS modifier to Arcana and Nature.
        if (!seed && (c.class || '').includes('Druid')) {
            c.skillMisc.arcana = 'WIS';
            c.skillMisc.nature = 'WIS';
        }
    }

    if (!c.skillProfs) {
        if (seed && seed.skillProfs) {
            c.skillProfs = { ...seed.skillProfs };
        } else {
            c.skillProfs = {};
            Object.keys(SKILL_ABILITIES).forEach(skill => {
                const base = modOf(SKILL_ABILITIES[skill]);
                const extra = c.skillMisc[skill] ? modOf(c.skillMisc[skill]) : 0;
                const diff = (parseInt((c.skills || {})[skill]) || 0) - base - extra;
                if (diff >= prof * 2) c.skillProfs[skill] = 'expert';
                else if (diff >= prof) c.skillProfs[skill] = 'prof';
            });
        }
    }

    (c.weapons || []).forEach(w => {
        if (!w.ability) {
            const ref = seed && (seed.weapons || []).find(x => x.name === w.name);
            w.ability = ref && ref.ability ? ref.ability : 'STR';
        }
    });

    if (!Array.isArray(c.resources)) {
        c.resources = seed && seed.resources
            ? JSON.parse(JSON.stringify(seed.resources))
            : [];
    }
}

/**
 * Recompute every derived number from the stored scores and proficiency flags.
 * Nothing here is inferred from previous output, so repeated recalculation and
 * levelling up stay stable.
 */
function recalculateCharacterModifiers(c) {
    ensureProficiencyFlags(c);

    const prof = parseInt(c.proficiencyBonus) || 2;
    const modOf = (ab) => Math.floor(((c.abilities[ab] || {}).score - 10) / 2) || 0;

    Object.keys(c.abilities).forEach(ab => {
        c.abilities[ab].mod = signed(modOf(ab));
    });

    Object.keys(c.saves || {}).forEach(ab => {
        c.saves[ab] = signed(modOf(ab) + (c.saveProfs.includes(ab) ? prof : 0));
    });

    Object.keys(SKILL_ABILITIES).forEach(skill => {
        const base = modOf(SKILL_ABILITIES[skill]);
        const flag = c.skillProfs[skill];
        const profPart = flag === 'expert' ? prof * 2 : flag === 'prof' ? prof : 0;
        const extra = c.skillMisc[skill] ? modOf(c.skillMisc[skill]) : 0;
        c.skills[skill] = signed(base + profPart + extra);
    });

    (c.weapons || []).forEach(w => {
        const magic = /\+(\d)/.test(w.name) ? parseInt(RegExp.$1) : 0;
        w.bonus = signed(modOf(w.ability || 'STR') + prof + magic);
    });
}

// ----------------------------------------------------
// 3. Dice Roller & Combat Tracker Controller
// ----------------------------------------------------
function initCombatPanel() {
    const diceBtns = document.querySelectorAll('.dice-btn');
    diceBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sides = parseInt(btn.getAttribute('data-die'));
            rollDice(sides);
        });
    });
    
    document.getElementById('btn-next-turn').addEventListener('click', () => {
        nextCombatTurn();
    });
    
    document.getElementById('btn-reset-combat').addEventListener('click', () => {
        resetCombatTracker();
    });
    
    document.getElementById('btn-add-combatant-modal').addEventListener('click', () => {
        document.getElementById('init-name-input').value = '';
        document.getElementById('init-score-input').value = '';
        document.getElementById('init-hp-input').value = '';
        document.getElementById('init-is-monster').checked = false;
        document.getElementById('modal-add-combatant').style.display = 'flex';
    });
}

function rollDie(sides) {
    return Math.floor(Math.random() * sides) + 1;
}

function rollDice(sides) {
    const resultEl = document.getElementById('dice-roll-result');
    const detailEl = document.getElementById('dice-roll-detail');
    const modInput = document.getElementById('dice-mod-val');
    const modifier = parseInt(modInput.value) || 0;
    
    playDiceSound();
    
    resultEl.classList.remove('dice-roll-animation');
    void resultEl.offsetWidth;
    resultEl.classList.add('dice-roll-animation');
    
    let counter = 0;
    const interval = setInterval(() => {
        resultEl.innerText = rollDie(sides);
        counter++;
        if (counter > 10) {
            clearInterval(interval);
            
            const roll = rollDie(sides);
            const total = roll + modifier;
            resultEl.innerText = total;
            
            let detailText = `Rolled 1d${sides}: ${roll}`;
            if (modifier !== 0) {
                detailText += ` ${modifier >= 0 ? '+' : '-'} ${Math.abs(modifier)} modifier = ${total}`;
            }
            detailEl.innerText = detailText;
            
            logRoll('Dice Tray', `1d${sides}`, total, detailText, roll);
            renderRollHistory();
        }
    }, 40);
}

function logRoll(roller, rollName, total, detail, rawDieResult = 10) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let type = 'normal';
    if (rollName.includes('d20') || rollName.includes('Check') || rollName.includes('Throw') || rollName.includes('Attack')) {
        if (rawDieResult === 20) type = 'crit-success';
        if (rawDieResult === 1) type = 'crit-fail';
    }
    
    state.rollHistory.unshift({
        id: Date.now(),
        roller,
        rollName,
        total,
        detail,
        time: timestamp,
        type
    });
    
    if (state.rollHistory.length > 50) {
        state.rollHistory.pop();
    }
    
    saveState();
}

function renderRollHistory() {
    const list = document.getElementById('dice-history-list');
    list.innerHTML = '';
    
    if (state.rollHistory.length === 0) {
        list.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic; text-align: center;">No rolls recorded yet.</p>';
        return;
    }
    
    state.rollHistory.forEach(item => {
        const row = document.createElement('div');
        row.className = `history-item ${item.type}`;
        
        row.innerHTML = `
            <div>
                <strong>${item.roller}</strong> - <span style="color: var(--border-gold);">${item.rollName}</span>
                <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${item.detail}</div>
            </div>
            <div style="text-align: right; display: flex; flex-direction: column; justify-content: space-between;">
                <span style="font-family: var(--font-heading); font-size: 1.1rem; font-weight: 800; color: var(--border-gold);">${item.total}</span>
                <span style="font-size: 0.65rem; color: var(--text-muted);">${item.time}</span>
            </div>
        `;
        list.appendChild(row);
    });
}

function renderInitiativeList() {
    const list = document.getElementById('combat-init-list');
    list.innerHTML = '';
    
    document.getElementById('combat-round').innerText = state.combatRound;
    
    if (state.combatants.length === 0) {
        list.innerHTML = `
            <div style="text-align: center; padding: 40px 10px; color: var(--text-muted); border: 1px dashed rgba(197, 160, 89, 0.2); border-radius: 6px;">
                <i class="fa-solid fa-people-group" style="font-size: 2rem; color: var(--border-gold-dim); margin-bottom: 10px;"></i>
                <p>Initiative list is empty.</p>
                <p style="font-size: 0.8rem; margin-top: 5px;">Roll checks on sheets or click 'Add Combatant' to start.</p>
            </div>
        `;
        return;
    }
    
    state.combatants.forEach((c, idx) => {
        const isActive = idx === state.activeCombatantIndex;
        const row = document.createElement('div');
        row.className = `init-row ${isActive ? 'active' : ''}`;
        if (c.isMonster) {
            row.style.borderLeft = '3px solid var(--accent-red)';
        }
        
        row.innerHTML = `
            <div class="init-score-bubble">${c.initiative}</div>
            <div class="init-name">${c.name} ${c.isMonster ? '<span style="font-size:0.7rem; color:var(--accent-red); font-weight:bold;">[NPC]</span>' : ''}</div>
            <div class="init-hp-tracker">
                <span style="font-size:0.75rem; color:var(--text-muted); margin-right:3px;">HP:</span>
                <input type="number" class="init-hp-val" value="${c.hp}" title="Current HP">
                <span style="color:var(--text-muted);">/</span>
                <span style="font-size:0.85rem; color:var(--text-muted);">${c.maxHp || '--'}</span>
            </div>
            <div>
                <span class="active-conditions" id="conditions-${idx}"></span>
            </div>
            <div style="text-align: right;">
                <button class="map-ctrl-btn btn-delete-combatant" data-index="${idx}" style="color: var(--accent-red); border-color: transparent; background: transparent; padding: 0;" title="Remove from combat">
                    <i class="fa-solid fa-circle-minus"></i>
                </button>
            </div>
        `;
        
        row.querySelector('.init-hp-val').addEventListener('change', (e) => {
            c.hp = parseInt(e.target.value) || 0;
            saveState();
        });
        
        row.querySelector('.btn-delete-combatant').addEventListener('click', (e) => {
            e.stopPropagation();
            state.combatants.splice(idx, 1);
            if (state.activeCombatantIndex >= state.combatants.length) {
                state.activeCombatantIndex = 0;
            }
            saveState();
            renderInitiativeList();
        });
        
        list.appendChild(row);
    });
}

function nextCombatTurn() {
    if (state.combatants.length === 0) return;
    
    state.activeCombatantIndex++;
    if (state.activeCombatantIndex >= state.combatants.length) {
        state.activeCombatantIndex = 0;
        state.combatRound++;
    }
    
    saveState();
    renderInitiativeList();
}

function resetCombatTracker() {
    if (confirm("Reset initiative order and restart combat round to 1?")) {
        state.combatRound = 1;
        state.activeCombatantIndex = 0;
        state.combatants = state.combatants.filter(c => !c.isMonster);
        state.combatants.forEach(c => {
            c.initiative = 0;
        });
        saveState();
        renderInitiativeList();
    }
}

// ----------------------------------------------------
// 4. Session Logs Panel Controller
// ----------------------------------------------------
function initSessionLogsPanel() {
    document.getElementById('btn-new-log-modal').addEventListener('click', () => {
        openNewSessionLogModal();
    });
}

function renderSessionLogsList() {
    const active = getActiveCampaign();
    if (!active) return;
    
    const list = document.getElementById('session-logs-list');
    list.innerHTML = '';
    
    if (active.sessionLogs.length === 0) {
        list.innerHTML = '<p style="padding: 10px; color: var(--text-muted); font-style: italic;">No session logs recorded.</p>';
        return;
    }
    
    const sorted = [...active.sessionLogs].sort((a,b) => b.id - a.id);
    let activeLog = null;
    
    sorted.forEach((log, index) => {
        const item = document.createElement('div');
        const selectedId = document.getElementById('session-edit-id').value;
        const isSelected = selectedId == log.id;
        const isActive = index === 0 && !selectedId;
        
        item.className = `session-list-item ${isSelected || isActive ? 'active' : ''}`;
        
        if (isSelected || isActive) {
            activeLog = log;
        }
        
        item.innerHTML = `
            <h4>${log.title}</h4>
            <p class="date"><i class="fa-solid fa-calendar-days"></i> ${log.date}</p>
            <p style="font-size:0.8rem; color:var(--text-muted); margin-top:5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${log.summary || ''}</p>
        `;
        
        item.addEventListener('click', () => {
            document.querySelectorAll('.session-list-item').forEach(el => el.classList.remove('active'));
            item.classList.add('active');
            displaySessionDetail(log);
        });
        
        list.appendChild(item);
    });
    
    if (activeLog) {
        displaySessionDetail(activeLog);
    }
}

function displaySessionDetail(log) {
    const active = getActiveCampaign();
    
    document.getElementById('session-edit-id').value = log.id;
    document.getElementById('session-detail-title').innerText = log.title;
    document.getElementById('session-detail-date').innerHTML = `<i class="fa-solid fa-calendar-days"></i> Play Date: ${log.date}`;
    document.getElementById('session-detail-summary').innerText = log.summary || '';
    document.getElementById('session-detail-content').innerText = log.content || '';
    
    document.getElementById('session-detail-actions').style.display = 'flex';
    
    document.getElementById('btn-edit-session').onclick = () => {
        openEditSessionLogModal(log);
    };
    
    document.getElementById('btn-delete-session').onclick = () => {
        if (confirm(`Are you sure you want to delete session "${log.title}"?`)) {
            active.sessionLogs = active.sessionLogs.filter(s => s.id !== log.id);
            saveState();
            document.getElementById('session-edit-id').value = '';
            document.getElementById('session-detail-title').innerText = 'Select a Session';
            document.getElementById('session-detail-date').innerText = '';
            document.getElementById('session-detail-summary').innerText = '';
            document.getElementById('session-detail-content').innerText = 'Click on a session log from the left sidebar to view DM and player notes.';
            document.getElementById('session-detail-actions').style.display = 'none';
            renderSessionLogsList();
        }
    };
}

// ----------------------------------------------------
// 5. Modals Management & Event Listeners
// ----------------------------------------------------
function initModals() {
    const closeBtns = document.querySelectorAll('.close-modal');
    closeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.modal-overlay').forEach(el => el.style.display = 'none');
            state.isAddingMarker = false;
            const markerBtn = document.getElementById('btn-add-marker-modal');
            if (markerBtn) {
                markerBtn.innerHTML = '<i class="fa-solid fa-map-pin"></i> Add Location Pin';
                markerBtn.classList.remove('btn-dnd-success');
            }
        });
    });
    
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.style.display = 'none';
                state.isAddingMarker = false;
                const markerBtn = document.getElementById('btn-add-marker-modal');
                if (markerBtn) {
                    markerBtn.innerHTML = '<i class="fa-solid fa-map-pin"></i> Add Location Pin';
                    markerBtn.classList.remove('btn-dnd-success');
                }
            }
        });
    });

    // Save Character Specs
    document.getElementById('btn-save-char-specs').addEventListener('click', () => {
        const active = getActiveCampaign();
        const id = document.getElementById('edit-char-id').value;
        const c = active.characters[id];
        if (!c) return;
        
        c.level = parseInt(document.getElementById('edit-char-level').value) || 1;
        c.xp = document.getElementById('edit-char-xp').value;
        c.hp.max = parseInt(document.getElementById('edit-char-hp-max').value) || 10;
        if (c.hp.current > c.hp.max) c.hp.current = c.hp.max;
        
        c.ac = parseInt(document.getElementById('edit-char-ac').value) || 10;
        c.species = document.getElementById('edit-char-species').value.trim();
        c.background = document.getElementById('edit-char-background').value.trim();
        c.class = document.getElementById('edit-char-class').value.trim();
        c.subclass = document.getElementById('edit-char-subclass').value.trim();
        c.equipment = document.getElementById('edit-char-equipment').value;
        
        c.abilities.STR.score = parseInt(document.getElementById('edit-char-str').value) || 10;
        c.abilities.DEX.score = parseInt(document.getElementById('edit-char-dex').value) || 10;
        c.abilities.CON.score = parseInt(document.getElementById('edit-char-con').value) || 10;
        c.abilities.INT.score = parseInt(document.getElementById('edit-char-int').value) || 10;
        c.abilities.WIS.score = parseInt(document.getElementById('edit-char-wis').value) || 10;
        c.abilities.CHA.score = parseInt(document.getElementById('edit-char-cha').value) || 10;
        
        recalculateCharacterModifiers(c);
        c.initiative = c.abilities.DEX.mod;
        
        const trackerChar = state.combatants.find(cb => cb.name === c.name);
        if (trackerChar) {
            trackerChar.maxHp = c.hp.max;
            if (trackerChar.hp > c.hp.max) trackerChar.hp = c.hp.max;
        }
        
        saveState();
        renderSelectedCharacter();
        renderCharacterTabs();
        document.getElementById('modal-edit-char').style.display = 'none';
        
        logRoll(c.name, "Level Up / Spec Edit", c.level, `Updated specs and recalculated all modifiers.`);
    });

    // Save HP Adjustments
    document.getElementById('btn-apply-hp').addEventListener('click', () => {
        const active = getActiveCampaign();
        const action = document.getElementById('hp-action-type').value;
        const amount = parseInt(document.getElementById('hp-amount').value) || 0;
        const c = active.characters[state.activeCharacterId];
        if (!c || amount <= 0) return;
        
        if (action === 'damage') {
            if (c.hp.temp > 0) {
                if (c.hp.temp >= amount) {
                    c.hp.temp -= amount;
                    logRoll(c.name, "Took Damage", amount, `Absorbed fully by Temp HP. Remaining Temp HP: ${c.hp.temp}`);
                } else {
                    const remainingDamage = amount - c.hp.temp;
                    c.hp.temp = 0;
                    c.hp.current = Math.max(0, c.hp.current - remainingDamage);
                    logRoll(c.name, "Took Damage", amount, `Absorbed ${amount - remainingDamage} by Temp HP, took ${remainingDamage} to main HP. Current HP: ${c.hp.current}`);
                }
            } else {
                c.hp.current = Math.max(0, c.hp.current - amount);
                logRoll(c.name, "Took Damage", amount, `Took ${amount} damage. Current HP: ${c.hp.current}`);
            }
        } else if (action === 'heal') {
            const isTemp = document.getElementById('hp-is-temp').checked;
            if (isTemp) {
                c.hp.temp = Math.max(c.hp.temp || 0, amount);
                logRoll(c.name, "Gained Temp HP", amount, `Gained ${amount} Temporary HP. Current Temp HP: ${c.hp.temp}`);
            } else {
                c.hp.current = Math.min(c.hp.max, c.hp.current + amount);
                logRoll(c.name, "Healed HP", amount, `Regained ${amount} HP. Current HP: ${c.hp.current}`);
            }
        }
        
        const trackerChar = state.combatants.find(cb => cb.name === c.name);
        if (trackerChar) {
            trackerChar.hp = c.hp.current;
        }
        
        saveState();
        renderSelectedCharacter();
        document.getElementById('modal-adjust-hp').style.display = 'none';
    });

    // Save Map Pin
    document.getElementById('btn-save-marker').addEventListener('click', () => {
        const active = getActiveCampaign();
        const id = document.getElementById('marker-edit-id').value;
        const name = document.getElementById('marker-name-input').value.trim();
        const type = document.getElementById('marker-type-input').value;
        const description = document.getElementById('marker-desc-input').value.trim();
        
        if (!name) {
            alert('Please enter a location name.');
            return;
        }
        
        if (id) {
            const marker = active.mapMarkers.find(m => m.id == id);
            if (marker) {
                marker.name = name;
                marker.type = type;
                marker.description = description;
            }
        } else {
            const x = parseInt(document.getElementById('marker-coord-x').value);
            const y = parseInt(document.getElementById('marker-coord-y').value);
            
            const newMarker = {
                id: Date.now(),
                name,
                type,
                x,
                y,
                description
            };
            active.mapMarkers.push(newMarker);
        }
        
        saveState();
        renderMapMarkers();
        document.getElementById('modal-map-marker').style.display = 'none';
        
        const activeId = id ? parseInt(id) : active.mapMarkers[active.mapMarkers.length - 1].id;
        const marker = active.mapMarkers.find(m => m.id == activeId);
        showMarkerDetails(marker);
    });

    // Save Combatant (Initiative)
    document.getElementById('btn-save-combatant').addEventListener('click', () => {
        const name = document.getElementById('init-name-input').value.trim();
        const initRoll = parseInt(document.getElementById('init-score-input').value) || 0;
        const hp = parseInt(document.getElementById('init-hp-input').value) || 10;
        const isMonster = document.getElementById('init-is-monster').checked;
        
        if (!name) {
            alert('Please enter a combatant name.');
            return;
        }
        
        state.combatants.push({
            name,
            initiative: initRoll,
            hp,
            maxHp: hp,
            isMonster
        });
        
        sortInitiativeList();
        saveState();
        renderInitiativeList();
        document.getElementById('modal-add-combatant').style.display = 'none';
    });

    // Save Session Log
    document.getElementById('btn-save-session').addEventListener('click', () => {
        const active = getActiveCampaign();
        const id = document.getElementById('session-edit-id').value;
        const title = document.getElementById('session-title-input').value.trim();
        const date = document.getElementById('session-date-input').value;
        const summary = document.getElementById('session-summary-input').value.trim();
        const content = document.getElementById('session-content-input').value.trim();
        
        if (!title || !date) {
            alert('Please enter a title and date.');
            return;
        }
        
        if (id && active.sessionLogs.some(s => s.id == id)) {
            const log = active.sessionLogs.find(s => s.id == id);
            log.title = title;
            log.date = date;
            log.summary = summary;
            log.content = content;
        } else {
            const newLog = {
                id: Date.now(),
                title,
                date,
                summary,
                content
            };
            active.sessionLogs.push(newLog);
            document.getElementById('session-edit-id').value = newLog.id;
        }
        
        saveState();
        renderSessionLogsList();
        document.getElementById('modal-session-log').style.display = 'none';
    });
}

function openEditCharSpecsModal() {
    const active = getActiveCampaign();
    const c = active.characters[state.activeCharacterId];
    if (!c) return;
    
    document.getElementById('edit-char-id').value = state.activeCharacterId;
    document.getElementById('edit-char-level').value = c.level;
    document.getElementById('edit-char-xp').value = c.xp || '0';
    document.getElementById('edit-char-hp-max').value = c.hp.max;
    document.getElementById('edit-char-ac').value = c.ac;
    document.getElementById('edit-char-species').value = c.species || '';
    document.getElementById('edit-char-background').value = c.background || '';
    document.getElementById('edit-char-class').value = c.class || '';
    document.getElementById('edit-char-subclass').value = c.subclass || '';
    document.getElementById('edit-char-equipment').value = c.equipment || '';
    
    document.getElementById('edit-char-str').value = c.abilities.STR.score;
    document.getElementById('edit-char-dex').value = c.abilities.DEX.score;
    document.getElementById('edit-char-con').value = c.abilities.CON.score;
    document.getElementById('edit-char-int').value = c.abilities.INT.score;
    document.getElementById('edit-char-wis').value = c.abilities.WIS.score;
    document.getElementById('edit-char-cha').value = c.abilities.CHA.score;
    
    document.getElementById('modal-edit-char').style.display = 'flex';
}

function openHPModal(type) {
    const active = getActiveCampaign();
    const c = active.characters[state.activeCharacterId];
    if (!c) return;
    
    document.getElementById('hp-action-type').value = type;
    document.getElementById('hp-modal-title').innerText = type === 'damage' ? 'Apply Damage' : 'Apply Healing';
    
    const applyBtn = document.getElementById('btn-apply-hp');
    applyBtn.innerText = type === 'damage' ? 'Damage' : 'Heal';
    applyBtn.className = type === 'damage' ? 'btn-dnd btn-dnd-primary' : 'btn-dnd btn-dnd-success';
    
    const tempGroup = document.getElementById('temp-hp-group');
    tempGroup.style.display = type === 'heal' ? 'block' : 'none';
    document.getElementById('hp-is-temp').checked = false;
    
    document.getElementById('hp-amount').value = 5;
    
    document.getElementById('modal-adjust-hp').style.display = 'flex';
}

function openAddMarkerModal(x, y) {
    document.getElementById('marker-edit-id').value = '';
    document.getElementById('marker-coord-x').value = x;
    document.getElementById('marker-coord-y').value = y;
    
    document.getElementById('marker-modal-title').innerText = 'Add Location Pin';
    document.getElementById('marker-name-input').value = '';
    document.getElementById('marker-type-input').value = 'town';
    document.getElementById('marker-desc-input').value = '';
    
    document.getElementById('marker-coord-display').innerText = `Coordinates: X:${x}, Y:${y}`;
    
    document.getElementById('modal-map-marker').style.display = 'flex';
}

function openEditMarkerModal(marker) {
    document.getElementById('marker-edit-id').value = marker.id;
    document.getElementById('marker-coord-x').value = marker.x;
    document.getElementById('marker-coord-y').value = marker.y;
    
    document.getElementById('marker-modal-title').innerText = 'Edit Location Pin';
    document.getElementById('marker-name-input').value = marker.name;
    document.getElementById('marker-type-input').value = marker.type || 'town';
    document.getElementById('marker-desc-input').value = marker.description || '';
    
    document.getElementById('marker-coord-display').innerText = `Coordinates: X:${marker.x}, Y:${marker.y}`;
    
    document.getElementById('modal-map-marker').style.display = 'flex';
}

function openNewSessionLogModal() {
    const active = getActiveCampaign();
    document.getElementById('session-edit-id').value = '';
    document.getElementById('session-modal-title').innerText = 'Write New Session Log';
    
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('session-title-input').value = `Session ${active.sessionLogs.length + 1}: `;
    document.getElementById('session-date-input').value = today;
    document.getElementById('session-summary-input').value = '';
    document.getElementById('session-content-input').value = '';
    
    document.getElementById('modal-session-log').style.display = 'flex';
}

function openEditSessionLogModal(log) {
    document.getElementById('session-edit-id').value = log.id;
    document.getElementById('session-modal-title').innerText = 'Edit Session Log';
    
    document.getElementById('session-title-input').value = log.title;
    document.getElementById('session-date-input').value = log.date;
    document.getElementById('session-summary-input').value = log.summary || '';
    document.getElementById('session-content-input').value = log.content || '';
    
    document.getElementById('modal-session-log').style.display = 'flex';
}

function sortInitiativeList() {
    state.combatants.sort((a, b) => b.initiative - a.initiative);
}

// ----------------------------------------------------
// 6. Campaign Settings & Management Controls
// ----------------------------------------------------
function initCampaignSettings() {
    const mapFileInput = document.getElementById('campaign-map-file');
    
    // Read local image file as Base64 data URL
    mapFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                document.getElementById('campaign-map-input').value = evt.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
    
    // Open Settings Modal
    document.getElementById('btn-campaign-settings').addEventListener('click', () => {
        const active = getActiveCampaign();
        document.getElementById('campaign-edit-id').value = active.id;
        document.getElementById('campaign-name-input').value = active.name;
        document.getElementById('campaign-map-input').value = active.mapImage;
        mapFileInput.value = ''; // Reset file upload
        document.getElementById('modal-campaign-settings').style.display = 'flex';
    });
    
    // Save settings
    document.getElementById('btn-save-campaign-settings').addEventListener('click', () => {
        const id = document.getElementById('campaign-edit-id').value;
        const name = document.getElementById('campaign-name-input').value.trim();
        const mapImage = document.getElementById('campaign-map-input').value.trim();
        
        if (!name) {
            alert('Please enter a campaign name.');
            return;
        }
        
        const campaign = state.campaigns.find(c => c.id === id);
        if (campaign) {
            campaign.name = name;
            campaign.mapImage = mapImage || 'phandelver-map-exterior-player.webp';
            saveState();
            renderCampaignSelector();
            renderAll();
            document.getElementById('modal-campaign-settings').style.display = 'none';
        }
    });
    
    // Create new campaign (blank slate)
    document.getElementById('btn-create-campaign-new').addEventListener('click', () => {
        const name = prompt("Enter a name for your new Campaign:");
        if (!name) return;
        
        const newId = 'campaign-' + Date.now();
        const newCampaign = {
            id: newId,
            name: name,
            mapImage: 'phandelver-map-exterior-player.webp',
            characters: {
                'char1': { name: 'New Character', class: 'Fighter', level: 1, abilities: { STR: { score: 10, mod: '+0' }, DEX: { score: 10, mod: '+0' }, CON: { score: 10, mod: '+0' }, INT: { score: 10, mod: '+0' }, WIS: { score: 10, mod: '+0' }, CHA: { score: 10, mod: '+0' } }, saves: { STR: '+0', DEX: '+0', CON: '+0', INT: '+0', WIS: '+0', CHA: '+0' }, skills: {}, weapons: [], spells: [], equipment: '', backstory: '', hp: { current: 10, max: 10, temp: 0 }, ac: 10, speed: '30 ft', initiative: '+0', passivePerception: 10, proficiencyBonus: '+2' }
            },
            sessionLogs: [],
            mapMarkers: [],
            partyPosition: { x: 100, y: 100, lastUpdated: "Campaign Started" }
        };
        
        state.campaigns.push(newCampaign);
        state.activeCampaignId = newId;
        state.activeCharacterId = 'char1';
        state.combatants = initDefaultCombatants(newCampaign.characters);
        state.activeCombatantIndex = 0;
        state.combatRound = 1;
        
        saveState();
        renderCampaignSelector();
        renderAll();
        document.getElementById('modal-campaign-settings').style.display = 'none';
        
        logRoll('System', 'New Campaign', '-', `Created blank campaign: ${name}`);
    });
    
    // Clone campaign (keeps characters & markers, resets logs)
    document.getElementById('btn-clone-campaign-new').addEventListener('click', () => {
        const active = getActiveCampaign();
        const name = prompt(`Enter name for the cloned campaign:`, `${active.name} (Cloned)`);
        if (!name) return;
        
        const newId = 'campaign-' + Date.now();
        const clonedCampaign = {
            id: newId,
            name: name,
            mapImage: active.mapImage,
            characters: JSON.parse(JSON.stringify(active.characters)),
            sessionLogs: [],
            mapMarkers: JSON.parse(JSON.stringify(active.mapMarkers)),
            partyPosition: JSON.parse(JSON.stringify(active.partyPosition))
        };
        
        state.campaigns.push(clonedCampaign);
        state.activeCampaignId = newId;
        
        const charKeys = Object.keys(clonedCampaign.characters);
        state.activeCharacterId = charKeys.length > 0 ? charKeys[0] : '';
        state.combatants = initDefaultCombatants(clonedCampaign.characters);
        state.activeCombatantIndex = 0;
        state.combatRound = 1;
        
        saveState();
        renderCampaignSelector();
        renderAll();
        document.getElementById('modal-campaign-settings').style.display = 'none';
        
        logRoll('System', 'Clone Campaign', '-', `Cloned ${active.name} to ${name}`);
    });
    
    // Delete campaign
    document.getElementById('btn-delete-campaign-active').addEventListener('click', () => {
        const active = getActiveCampaign();
        if (state.campaigns.length <= 1) {
            alert('Cannot delete the last remaining campaign. Create a new campaign first!');
            return;
        }
        
        if (confirm(`Are you sure you want to delete campaign "${active.name}"? This will delete all characters, maps, and logs for this campaign permanently.`)) {
            state.campaigns = state.campaigns.filter(c => c.id !== active.id);
            state.activeCampaignId = state.campaigns[0].id;
            
            const nextCampaign = getActiveCampaign();
            const charKeys = Object.keys(nextCampaign.characters);
            state.activeCharacterId = charKeys.length > 0 ? charKeys[0] : '';
            state.combatants = initDefaultCombatants(nextCampaign.characters);
            state.activeCombatantIndex = 0;
            state.combatRound = 1;
            
            saveState();
            renderCampaignSelector();
            renderAll();
            document.getElementById('modal-campaign-settings').style.display = 'none';
        }
    });
}

function renderCampaignSelector() {
    const select = document.getElementById('campaign-select');
    if (!select) return;
    select.innerHTML = '';
    
    state.campaigns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = c.name;
        opt.selected = c.id === state.activeCampaignId;
        select.appendChild(opt);
    });
    
    select.onchange = (e) => {
        state.activeCampaignId = e.target.value;
        const newCampaign = getActiveCampaign();
        
        const charKeys = Object.keys(newCampaign.characters);
        state.activeCharacterId = charKeys.length > 0 ? charKeys[0] : '';
        state.combatants = initDefaultCombatants(newCampaign.characters);
        state.activeCombatantIndex = 0;
        state.combatRound = 1;
        
        saveState();
        renderAll();
        showMarkerDetails(null);
    };
}

// ----------------------------------------------------
// 7. JSON Import / Export & Reset Database
// ----------------------------------------------------
function initImportExport() {
    document.getElementById('btn-export-data').addEventListener('click', () => {
        const dataStr = JSON.stringify(state, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = `dnd_campaign_export_${new Date().toISOString().split('T')[0]}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        logRoll('System', 'Data Export', '-', 'Database exported to JSON.');
    });
    
    const fileInput = document.getElementById('file-import');
    document.getElementById('btn-import-trigger').addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                
                // Compatibility conversion
                if (parsed.characters && !parsed.campaigns) {
                    const oldCampaign = {
                        id: "phandelver",
                        name: "Imported Campaign",
                        mapImage: "phandelver-map-exterior-player.webp",
                        characters: parsed.characters,
                        sessionLogs: parsed.sessionLogs || [],
                        mapMarkers: parsed.mapMarkers || [],
                        partyPosition: parsed.partyPosition || { x: 350, y: 480, lastUpdated: "Imported state" }
                    };
                    parsed.campaigns = [oldCampaign];
                    parsed.activeCampaignId = "phandelver";
                    delete parsed.characters;
                    delete parsed.sessionLogs;
                    delete parsed.mapMarkers;
                    delete parsed.partyPosition;
                }
                
                if (parsed.campaigns && parsed.campaigns.length > 0) {
                    state = parsed;
                    saveState();
                    renderCampaignSelector();
                    renderAll();
                    alert('Campaign database imported successfully!');
                    logRoll('System', 'Data Import', '-', 'Database imported successfully.');
                } else {
                    alert('Invalid file structure.');
                }
            } catch (err) {
                alert('Error parsing JSON.');
                console.error(err);
            }
        };
        reader.readAsText(file);
    });
    
    document.getElementById('btn-reset-data').addEventListener('click', () => {
        if (confirm("WARNING: This will reset ALL campaigns, characters, session logs, and map markers to their initial template state.\n\nProceed?")) {
            resetToDefaults();
            renderCampaignSelector();
            renderAll();
            alert('Database reset.');
        }
    });
}

// ----------------------------------------------------
// Master Renderer
// ----------------------------------------------------
function migrateAllCharacters() {
    (state.campaigns || []).forEach(camp => {
        Object.values(camp.characters || {}).forEach(ensureProficiencyFlags);
    });
}

function renderAll() {
    migrateAllCharacters();
    renderMapMarkers();
    renderCharacterTabs();
    renderSelectedCharacter();
    renderInitiativeList();
    renderRollHistory();
    renderSessionLogsList();
}
