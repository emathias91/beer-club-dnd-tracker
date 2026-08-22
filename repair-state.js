#!/usr/bin/env node
/**
 * repair-state.js — fixes the corrupted character stats in the LIVE campaign save.
 *
 * Only touches the fields that were shipped with bad seed values. Backstories,
 * features, spells, skills, saves, equipment, session logs, map pins, party
 * position and roll history are all left exactly as they are.
 *
 * Writes a timestamped backup before changing anything.
 *
 * Run:  node repair-state.js
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const FILE = path.join(DATA_DIR, 'campaign_state.json');

const FIX = {
  Elowen: {
    class: 'Druid', subclass: 'Circle of the Land', species: 'Wood Elf', background: 'Hermit',
    hp: { current: 27, max: 27, temp: 0 }, ac: 14, speed: '35 ft',
    passivePerception: 13, initiative: '+1',
    abilities: { STR: [8, '-1'], DEX: [12, '+1'], CON: [16, '+3'], INT: [13, '+1'], WIS: [16, '+3'], CHA: [10, '+0'] },
    weapons: [
      { name: 'Shillelagh Staff', bonus: '+5', damage: '1d8+3 force', notes: 'Must cast Shillelagh first' },
      { name: 'Produce Flame', bonus: '+5', damage: '1d8 fire', notes: '60 ft' },
      { name: 'Quarterstaff', bonus: '-1', damage: '1d6-1 bludgeoning', notes: '' },
      { name: 'Sickle', bonus: '+3', damage: '1d4-1 slashing', notes: '' }
    ]
  },
  Fizzwizzle: {
    class: 'Artificer', subclass: 'Artillerist', species: 'Rock Gnome', background: 'Artisan',
    hp: { current: 21, max: 21, temp: 0 }, ac: 14, speed: '30 ft',
    passivePerception: 12, initiative: '+2',
    abilities: { STR: [8, '-1'], DEX: [14, '+2'], CON: [12, '+1'], INT: [17, '+3'], WIS: [14, '+2'], CHA: [10, '+0'] },
    weapons: [
      { name: 'Dagger', bonus: '+4', damage: '1d4+2 piercing', notes: 'Throw 20/60' },
      { name: 'Eldritch Cannon: Force Ballista', bonus: '+5', damage: '2d8 force', notes: '120 ft, push 5 ft' },
      { name: 'Eldritch Cannon: Flamethrower', bonus: 'DC 13', damage: '2d8 fire', notes: '15 ft cone, DEX save for half' }
    ]
  },
  Gemini: {
    class: 'Warlock', subclass: 'Fiend Patron', species: 'Infernal Tiefling', background: 'Wayfarer',
    hp: { current: 21, max: 21, temp: 0 }, ac: 14, speed: '30 ft',
    passivePerception: 10, initiative: '+3',
    abilities: { STR: [8, '-1'], DEX: [16, '+3'], CON: [13, '+1'], INT: [12, '+1'], WIS: [10, '+0'], CHA: [16, '+3'] },
    weapons: [
      { name: 'Eldritch Blast', bonus: '+5', damage: '1d10+3 force', notes: '120 ft, Agonizing Blast' },
      { name: 'Fire Bolt', bonus: '+5', damage: '1d10 fire', notes: '120 ft' },
      { name: 'Dagger', bonus: '+5', damage: '1d4+3 piercing', notes: 'Throw 20/60' },
      { name: 'Sickle', bonus: '+1', damage: '1d4-1 slashing', notes: '' }
    ]
  },
  Thorin: {
    class: 'Paladin', subclass: 'Oath of the Ancients', species: 'Dwarf', background: 'Noble',
    hp: { current: 28, max: 28, temp: 0 }, ac: 18, speed: '30 ft',
    passivePerception: 13, initiative: '+0',
    abilities: { STR: [16, '+3'], DEX: [10, '+0'], CON: [13, '+1'], INT: [8, '-1'], WIS: [12, '+1'], CHA: [16, '+3'] },
    weapons: [
      { name: 'Longsword', bonus: '+5', damage: '1d8+5 slashing', notes: 'Versatile 1d10; Sap: target disadv' },
      { name: 'Javelin', bonus: '+5', damage: '1d6+3 piercing', notes: 'Throw 30/120; Slow: -10 ft speed' }
    ]
  }
};

if (!fs.existsSync(FILE)) {
  console.error(`No save file found at ${FILE}`);
  process.exit(1);
}

const raw = fs.readFileSync(FILE, 'utf8');
let state;
try {
  state = JSON.parse(raw);
} catch (e) {
  console.error('Save file is not valid JSON; aborting so nothing is made worse.');
  process.exit(1);
}

// 1. Backup first, always.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(DATA_DIR, `campaign_state.backup-${stamp}.json`);
fs.writeFileSync(backup, raw, 'utf8');
console.log(`Backup written: ${backup}`);

let changed = 0;
for (const camp of state.campaigns || []) {
  const chars = camp.characters || {};
  for (const [key, fix] of Object.entries(FIX)) {
    const c = chars[key];
    if (!c) continue;
    c.class = fix.class;
    c.subclass = fix.subclass;
    c.species = fix.species;
    c.background = fix.background;
    c.hp = { ...fix.hp };
    c.ac = fix.ac;
    c.speed = fix.speed;
    c.passivePerception = fix.passivePerception;
    c.initiative = fix.initiative;
    for (const [ab, [score, mod]] of Object.entries(fix.abilities)) {
      c.abilities[ab] = { score, mod };
    }
    if (!Array.isArray(c.weapons) || c.weapons.length === 0) {
      c.weapons = fix.weapons;
    }
    changed++;
    console.log(`  repaired ${key}: ${fix.class} — HP ${fix.hp.max}, AC ${fix.ac}, Speed ${fix.speed}`);
  }
}

// 2. Keep the combat tracker in step with the repaired sheets.
const nameMap = {};
for (const camp of state.campaigns || []) {
  for (const [key, c] of Object.entries(camp.characters || {})) {
    if (FIX[key]) nameMap[c.name] = FIX[key];
  }
}
for (const cb of state.combatants || []) {
  const fix = nameMap[cb.name];
  if (fix) {
    cb.hp = fix.hp.current;
    cb.maxHp = fix.hp.max;
    console.log(`  combat tracker: ${cb.name} -> ${cb.hp}/${cb.maxHp}`);
  }
}

// 3. Atomic write so a crash mid-save can't truncate the file.
const tmp = FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
fs.renameSync(tmp, FILE);

console.log(`\nDone. Repaired ${changed} character sheet(s).`);
console.log('Refresh the tracker in your browser to see the corrected stats.');
