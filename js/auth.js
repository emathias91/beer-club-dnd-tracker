// Seat-role/auth helpers. Zero deps, called from nearly every subsystem.

export function canUseDestructiveAdmin() {
    // With seats: Import/Reset are DM-only. Without seat API, allow (offline/file open).
    if (!window.SeatSession || typeof SeatSession.get !== 'function') return true;
    const seat = SeatSession.get();
    if (!seat) return true;
    return seat.role === 'dm' || SeatSession.isDm();
}

/** Alert + bail unless DM seat (or no seat system / offline). */
export function requireDmAction(what) {
    if (canUseDestructiveAdmin()) return true;
    alert('Only the DM can ' + (what || 'do that') + '.');
    return false;
}
