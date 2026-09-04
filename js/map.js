// Map panel: image load/upload lifecycle, zoom, drag-drop marker placement,
// party token, and the map-related modal wiring (pulled out of app.js's old
// initModals grab-bag: the "Save Map Pin" handler now lives in initMapPanel).
//
// NOTE: updateEmptyCampaignChrome lives in js/campaigns.js, which itself
// imports showMarkerDetails back from this module — a sibling-to-sibling
// circular import (same pattern as js/combat.js <-> js/sessionLogs.js), safe
// because both sides only reference the import inside a function body, never
// at module-eval time.
import { updateEmptyCampaignChrome } from './campaigns.js';
import { state, getActiveCampaign, saveLocalUi } from './state.js';
import { canUseDestructiveAdmin, requireDmAction } from './auth.js';
import { sessionHeaders, setSyncStatus, saveStateToServer, saveState } from './sync.js';

/** Normalize campaign mapImage to a fetchable URL (maps volume preferred). */
export function resolveCampaignMapUrl(mapImage) {
    const raw = String(mapImage || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
    if (raw.startsWith('/maps/')) return raw;
    // bare filename → try portable maps path first
    const base = raw.split(/[\\/]/).pop();
    if (base && /\.(webp|png|jpe?g|gif|svg)$/i.test(base)) {
        return '/maps/' + encodeURIComponent(base);
    }
    return raw;
}

export function showMapMissing(show, message, reason) {
    const overlay = document.getElementById('map-missing-overlay');
    const status = document.getElementById('map-missing-status');
    const img = document.getElementById('map-image');
    if (overlay) overlay.style.display = show ? 'flex' : 'none';
    if (img) img.style.visibility = show ? 'hidden' : 'visible';
    if (status && message != null) status.textContent = message;
    if (overlay && reason) overlay.dataset.reason = reason;
    if (show) updateMapUploadChrome();
}

/** DM can upload / change map; players see read-only blank copy. */
export function updateMapUploadChrome() {
    const isDm = canUseDestructiveAdmin();
    const overlay = document.getElementById('map-missing-overlay');
    const reason = (overlay && overlay.dataset.reason) || 'unset';
    const title = document.getElementById('map-missing-title');
    const body = document.getElementById('map-missing-body');
    const actions = document.getElementById('map-missing-actions');
    const browseBtn = document.getElementById('btn-browse-map');
    const changeBtn = document.getElementById('map-change-image');
    const mapInput = document.getElementById('campaign-map-input');
    const mapInputLabel = mapInput && mapInput.closest('label');

    if (reason === 'error') {
        if (title) title.textContent = 'Map file not found';
        if (body) {
            body.innerHTML = isDm
                ? 'The map file saved for this campaign could not be loaded. Confirm it exists in the <code>maps/</code> folder, or upload a replacement.'
                : 'The campaign map file is missing. Only the DM can fix this.';
        }
    } else {
        if (title) title.textContent = 'No map uploaded';
        if (body) {
            body.innerHTML = isDm
                ? 'Maps are not shipped in git (copyright). Place files in the <code>maps/</code> folder or upload one here.'
                : 'No map uploaded. Only the DM can upload a campaign map.';
        }
    }
    if (actions) actions.style.display = isDm ? '' : 'none';
    if (browseBtn) {
        browseBtn.style.display = isDm ? '' : 'none';
        browseBtn.disabled = !isDm;
        browseBtn.title = isDm ? 'Upload a campaign map image' : 'Only the DM can upload a map';
    }
    if (changeBtn) {
        changeBtn.style.display = isDm ? '' : 'none';
        changeBtn.disabled = !isDm;
        changeBtn.title = isDm ? 'Change map image' : 'Only the DM can change the map';
    }
    if (mapInput) {
        mapInput.disabled = !isDm;
        mapInput.readOnly = !isDm;
        mapInput.title = isDm
            ? 'Map path or /maps/… URL'
            : 'Only the DM can set the campaign map';
        if (mapInputLabel) mapInputLabel.style.opacity = isDm ? '' : '0.65';
    }
}

export function bindMapImageLifecycle(mapImg) {
    if (!mapImg || mapImg.dataset.mapBound === '1') return;
    mapImg.dataset.mapBound = '1';
    mapImg.addEventListener('load', () => {
        if (mapImg.naturalWidth > 0) {
            showMapMissing(false, '');
        } else {
            const active = getActiveCampaign();
            const name = active && active.mapImage ? active.mapImage : '(none)';
            showMapMissing(true, 'Map file appears corrupted: ' + name, 'error');
        }
    });
    mapImg.addEventListener('error', () => {
        const active = getActiveCampaign();
        const name = active && active.mapImage ? active.mapImage : '(none)';
        showMapMissing(true, 'Could not load: ' + name, 'error');
    });
}

export async function uploadMapFile(file) {
    if (!file) return null;
    if (!canUseDestructiveAdmin()) {
        throw new Error('Only the DM can upload a campaign map.');
    }
    const status = document.getElementById('map-missing-status');
    if (status) status.textContent = 'Uploading ' + file.name + '…';
    const buf = await file.arrayBuffer();
    // base64 without huge stack
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const dataBase64 = btoa(binary);
    const res = await fetch('/api/maps/upload', {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({
            filename: file.name,
            dataBase64
        })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || ('Upload failed (' + res.status + ')'));
    }
    return data;
}

export async function applyUploadedMap(uploadResult) {
    const active = getActiveCampaign();
    if (!active || !uploadResult || !uploadResult.url) return;
    active.mapImage = uploadResult.url;
    // force full meta write
    if (state.revisions) {
        // leave revisions; saveState smart path handles meta
    }
    await saveStateToServer();
    renderMapMarkers();
    showMapMissing(false, '');
    setSyncStatus('Map uploaded', 'ok');
}

export function openMapFilePicker() {
    const input = document.getElementById('map-file-input');
    if (input) {
        input.value = '';
        input.click();
    }
}

export function openAddMarkerModal(x, y) {
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

export function openEditMarkerModal(marker) {
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

export function initMapPanel() {
    const container = document.getElementById('map-image-container');
    const token = document.getElementById('party-token');
    const mapImg = document.getElementById('map-image');
    bindMapImageLifecycle(mapImg);

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

    const openMapPicker = () => {
        if (!canUseDestructiveAdmin()) {
            alert('Only the DM can upload a campaign map.');
            return;
        }
        openMapFilePicker();
    };
    const changeBtn = document.getElementById('map-change-image');
    if (changeBtn) changeBtn.addEventListener('click', openMapPicker);
    const browseBtn = document.getElementById('btn-browse-map');
    if (browseBtn) browseBtn.addEventListener('click', openMapPicker);
    const fileInput = document.getElementById('map-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', async () => {
            const file = fileInput.files && fileInput.files[0];
            if (!file) return;
            try {
                const result = await uploadMapFile(file);
                await applyUploadedMap(result);
            } catch (e) {
                console.error(e);
                showMapMissing(true, e.message || 'Upload failed');
                alert(e.message || 'Map upload failed');
            }
        });
    }

    function applyZoom() {
        container.style.transform = `scale(${state.zoomLevel})`;
        saveLocalUi();
    }

    // Add Marker Mode Button
    const addMarkerBtn = document.getElementById('btn-add-marker-modal');
    addMarkerBtn.addEventListener('click', () => {
        state.isAddingMarker = true;
        addMarkerBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Click on the Map...';
        addMarkerBtn.classList.add('btn-dnd-success');
    });

    mapImg.addEventListener('click', (e) => {
        if (mapImg.style.visibility === 'hidden') return;
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

        const maxW = mapImg.naturalWidth || 2000;
        const maxH = mapImg.naturalHeight || 2000;
        newX = Math.max(0, Math.min(maxW, newX));
        newY = Math.max(0, Math.min(maxH, newY));

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
        if (!active || !active.partyPosition) {
            alert('Create a campaign first.');
            return;
        }
        document.getElementById('party-location-input').value = active.partyPosition.lastUpdated || '';
        document.getElementById('modal-party-location').style.display = 'flex';
    });

    document.getElementById('btn-save-party-location').addEventListener('click', () => {
        const active = getActiveCampaign();
        if (!active || !active.partyPosition) return;
        const val = document.getElementById('party-location-input').value.trim();
        active.partyPosition.lastUpdated = val || "Active travel";
        saveState();
        showPartyDetails();
        document.getElementById('modal-party-location').style.display = 'none';
    });

    // Save Map Pin — moved out of the old initModals grab-bag.
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
}

export function renderMapMarkers() {
    const active = getActiveCampaign();
    updateEmptyCampaignChrome();
    if (!active) {
        const layer = document.getElementById('map-markers-layer');
        if (layer) layer.innerHTML = '';
        const mapImg = document.getElementById('map-image');
        if (mapImg) {
            mapImg.removeAttribute('src');
            mapImg.removeAttribute('data-resolved');
        }
        const token = document.getElementById('party-token');
        if (token) {
            token.style.left = '100px';
            token.style.top = '100px';
        }
        return;
    }

    const layer = document.getElementById('map-markers-layer');
    layer.innerHTML = '';

    // Set map image src (portable /maps/… preferred)
    const mapImg = document.getElementById('map-image');
    bindMapImageLifecycle(mapImg);
    const url = resolveCampaignMapUrl(active.mapImage);
    if (!url) {
        mapImg.removeAttribute('src');
        showMapMissing(true, '', 'unset');
    } else {
        // Bust cache when switching maps
        const bust = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(url);
        if (mapImg.getAttribute('data-resolved') !== url) {
            mapImg.setAttribute('data-resolved', url);
            showMapMissing(false, 'Loading map…');
            mapImg.src = bust;
        } else if (mapImg.naturalWidth > 0) {
            showMapMissing(false, '');
        }
    }

    // Render location markers
    (active.mapMarkers || []).forEach(marker => {
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
    const pos = active.partyPosition || { x: 100, y: 100 };
    token.style.left = `${pos.x}px`;
    token.style.top = `${pos.y}px`;

    // Set map transform scale
    document.getElementById('map-image-container').style.transform = `scale(${state.zoomLevel})`;
}

export function showMarkerDetails(marker) {
    const active = getActiveCampaign();
    const placeholder = document.getElementById('marker-details-placeholder');
    const content = document.getElementById('marker-content');
    const delBtn = document.getElementById('btn-delete-marker');

    if (!marker) {
        placeholder.style.display = 'flex';
        content.style.display = 'none';
        if (delBtn) delBtn.style.display = 'none';
        return;
    }

    placeholder.style.display = 'none';
    content.style.display = 'block';

    document.getElementById('marker-name').innerText = marker.name;
    document.getElementById('marker-description').innerText = marker.description || 'No notes.';

    const badge = document.getElementById('marker-type-badge');
    badge.innerText = marker.type || 'town';
    badge.className = `marker-badge ${marker.type || 'town'}`;

    // Edit stays available; Delete description/notes is DM-only
    document.getElementById('btn-edit-marker').onclick = () => {
        openEditMarkerModal(marker);
    };

    const isDm = canUseDestructiveAdmin();
    if (delBtn) {
        delBtn.style.display = isDm ? 'inline-flex' : 'none';
        delBtn.title = isDm
            ? 'Delete this location pin and its notes'
            : 'Only the DM can delete location notes';
        delBtn.onclick = () => {
            if (!requireDmAction('delete location notes')) return;
            if (confirm(`Are you sure you want to delete the marker for ${marker.name}?`)) {
                if (!active) return;
                active.mapMarkers = (active.mapMarkers || []).filter(m => m.id !== marker.id);
                saveState();
                renderMapMarkers();
                showMarkerDetails(null);
            }
        };
    }
}

export function showPartyDetails() {
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

    // Party token is not a deletable location note
    const delBtn = document.getElementById('btn-delete-marker');
    if (delBtn) {
        delBtn.style.display = 'none';
        delBtn.onclick = null;
    }

    document.getElementById('party-loc-desc').innerText = active.partyPosition.lastUpdated;
}
