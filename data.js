// Initial D&D Character Data & Session Logs
// This file is loaded first and acts as the default database.

const INITIAL_CHARACTER_DATA = {
  "Elowen": {
    "name": "Elowen",
    "player": "Denise",
    "class": "Druid",
    "subclass": "Circle of the Land",
    "level": 3,
    "background": "Hermit",
    "species": "Wood Elf",
    "xp": "",
    "hp": {
      "current": 27,
      "max": 27,
      "temp": 0
    },
    "ac": 14,
    "initiative": "+1",
    "speed": "35 ft",
    "passivePerception": 13,
    "proficiencyBonus": "+2",
    "abilities": {
      "STR": {
        "score": 8,
        "mod": "-1"
      },
      "DEX": {
        "score": 12,
        "mod": "+1"
      },
      "CON": {
        "score": 16,
        "mod": "+3"
      },
      "INT": {
        "score": 13,
        "mod": "+1"
      },
      "WIS": {
        "score": 16,
        "mod": "+3"
      },
      "CHA": {
        "score": 10,
        "mod": "+0"
      }
    },
    "saves": {
      "STR": "-1",
      "DEX": "+1",
      "CON": "+3",
      "INT": "+3",
      "WIS": "+5",
      "CHA": "0"
    },
    "skills": {
      "acrobatics": "+1",
      "animalHandling": "+5",
      "arcana": "+4",
      "athletics": "-1",
      "deception": "0",
      "history": "+1",
      "insight": "+3",
      "intimidation": "0",
      "investigation": "+1",
      "medicine": "+5",
      "nature": "+6",
      "perception": "+3",
      "performance": "0",
      "persuasion": "0",
      "religion": "+3",
      "sleightOfHand": "+1",
      "stealth": "+1",
      "survival": "+5"
    },
    "languages": "Common\r\nElvish\r\nGnomish\r\nDruidic",
    "tools": "Herbalism Kit (INT)\r\nBrewer's Supplies (INT)",
    "equipment": "Leather Armor\r\nShield\r\nSickle\r\nDruidic Focus (Quarterstaff)\r\nHerbalism Kit\r\nBrewer's Supplies\r\nHealer's Kit\r\nBedroll\r\nBook (philosophy)\r\nLamp\r\nOil (3 flasks)\r\nTraveler's Clothes",
    "features": {
      "classFeatures": "Spellcasting: Regain all spell slots on long rest. Can change prepared spells on long rest. Can use druidic focus as spellcasting focus. \r\n\r\nPrimal Order: Magician. 1 extra cantrip. Add WIS mod to Arcana and Nature checks.\r\n\r\nDruidic: You know druidic, the secret language of the druids. You can leave secret messages in druidic. Other druids easily spot. Others need to investigate to find but cannot decipher.\r\nYou always have speak with animals as a prepared spell.\r\n\r\nWild Companion: As a magic action, you can expend a spell slot or use of Wild Shape to cast Find Familiar without material compoents. When cast this way, the familiar is fey and disappears when you finish a Long Rest.\r\n\r\nLand's Aid: Action - expend wild shape use. Within 60 ft, create 10 ft radius sphere of flowers and thorns. Each creature you choose in range: CON save. 2d6 Necrotic damage on failed save or half on success. One creature you choose in range heals 2d6 hp. \r\n\r\nCircle of the Land: Whenever you finish a Long rest, choose one of the below circles and have those spells prepared.\r\nArid: Blur, Burning Hands, Fire Bolt\r\nPolar: Fog Cloud, Hold Person, Ray of Frost\r\nTemperate: Misty Step, Shocking Grasp, Sleep\r\nTropical: Acid Splash, Ray of Sickness, Web\r\n\r\n\n\nWild Shape: As a Bonus Action, you can shape into an animal form. You can stay in the form for 1 hour or until you are incapacitated or leave it early as another bonus aciton.\r\nYou have 2 uses per long rest. \r\nYou gain 3 temp HP when you wild shape.\r\nWhile wild shaped, your stats are replaced with your new form, but you retain your hp, INT, WIS, CHA, class features, languages, and feats. You also retain your proficiencies as well as gaining the creature's proficiencies, using the better one if both you and the creature have the same proficiency. \r\nYou cannot cast spells while wild shaped, but can maintain concentration on a spell cast before wild shaping. \r\nEquipment merges into your form and cannot be used. You can choose to have the equipment not do this, but the form must be capable or wearing or wielding the equipment to maintain access.\r\nRemaining Uses: OO\r\n\r\n",
      "speciesTraits": "Darkvision 60 ft\r\n\r\nFey Ancestry: Advantage on saving throws to avoid or end being charmed\r\n\r\nTrance: You don't need to sleep. Magic can't make you sleep. Finish a long rest in 4 hours if you spend it in trancelike state.\r\n\r\nLineage: Gain druidcraft at level 1, longstrider at level 3, pass without trace at level 5, can cast them once per long rest without spell slot.\r\nLongstrider Uses: O",
      "feats": " "
    },
    "spellcasting": {
      "ability": "Wisdom",
      "saveDC": 13,
      "attackBonus": "+5",
      "slots": {
        "lvl1": {
          "total": 4,
          "expended": 0
        },
        "lvl2": {
          "total": 2,
          "expended": 0
        },
        "lvl3": {
          "total": 0,
          "expended": 0
        }
      }
    },
    "weapons": [
      {
        "name": "Shillelagh Staff",
        "bonus": "+5",
        "damage": "1d8+3 force",
        "notes": "Must cast Shillelagh first",
        "ability": "WIS"
      },
      {
        "name": "Produce Flame",
        "bonus": "+5",
        "damage": "1d8 fire",
        "notes": "60 ft",
        "ability": "WIS"
      },
      {
        "name": "Quarterstaff",
        "bonus": "-1",
        "damage": "1d6-1 bludgeoning",
        "notes": "",
        "ability": "STR"
      },
      {
        "name": "Sickle",
        "bonus": "+3",
        "damage": "1d4-1 slashing",
        "notes": "",
        "ability": "STR"
      }
    ],
    "spells": [
      {
        "level": 0,
        "name": "Druidcraft",
        "notes": "Forecast,Bloom,SensoryEffect,FirePlay",
        "castingTime": "Action",
        "range": "30 ft"
      },
      {
        "range": "Self",
        "castingTime": "Bonus",
        "name": "Produce Flame",
        "notes": "20 ft light, can throw as attack action",
        "level": 0
      },
      {
        "name": "Rat",
        "level": 0
      },
      {
        "notes": "1 min. 1 dmg type reduced by 1d4 once/turn",
        "range": "Touch",
        "castingTime": "Action",
        "level": 0,
        "name": "Resistance"
      },
      {
        "notes": "combat",
        "level": 0,
        "name": "Riding Horse"
      },
      {
        "name": "Shillelagh",
        "castingTime": "Bonus",
        "range": "Self",
        "level": 0,
        "notes": "10 minute duration"
      },
      {
        "notes": "climb/scout",
        "level": 0,
        "name": "Spider"
      },
      {
        "notes": "speed/travel",
        "name": "Wolf",
        "level": 0
      },
      {
        "name": "Longstrider",
        "castingTime": "Touch",
        "range": "Action",
        "level": 1
      },
      {
        "notes": "Quarterstaff stronger 1 min, d8 force use WIS",
        "range": "Self",
        "castingTime": "Action",
        "level": 1,
        "name": "Speak with Animals"
      }
    ],
    "backstory": "Elowen is a reclusive Wood Elf Druid, with a deep affinity for healing that blossomed in her childhood within the deep forest. Driven by a desire to protect nature's balance and acting on a mysterious, lingering intuition, she left her community for a hermetic life, now venturing out only when the natural world is severely threatened or a higher power \"maybe named Chuck\" calls her. Hobbies: a tinkering passion for brewing deep, dark ales.Why She Adventures Elowen rarely leaves her forest, but the dark ale demands better ingredients. She seeks rare, magical herbs and unusual ferments to create the ultimate brew—one that can heal the spirit as well as the body. Furthermore, she feels a strange pull to protect the natural balance against a creeping, unnatural darkness that her forest animals have warned her about.Personality Trait: \"I am quiet and distant, but I will passionately share my brewing recipes with anyone who appreciates a good dark stout.\"Ideal: \"Balance. Nature requires both the decay of the forest floor and the bright bloom of new life, much like a good stout needs both sweetness and bitterness.\"Bond: \"I protect a small, forgotten grove that acts as a thin spot between the material plane and the Feywild.\"Flaw: \"I often prioritize taking care of injured creatures or finishing a brew over my own safety.\"",
    "saveProfs": [
      "INT",
      "WIS"
    ],
    "skillProfs": {
      "nature": "prof",
      "religion": "prof",
      "animalHandling": "prof",
      "medicine": "prof",
      "survival": "prof"
    },
    "skillMisc": {
      "arcana": "WIS",
      "nature": "WIS"
    },
    "resources": [
      {
        "name": "Wild Shape",
        "current": 2,
        "max": 2,
        "reset": "long"
      },
      {
        "name": "Longstrider (free cast)",
        "current": 1,
        "max": 1,
        "reset": "long"
      }
    ],
    "coins": {
      "pp": 0,
      "gp": 0,
      "ep": 0,
      "sp": 0,
      "cp": 0
    }
  },
  "Fizzwizzle": {
    "name": "Fizzwizzle \"Fizz\" Tinkspark",
    "player": "Zane",
    "class": "Artificer",
    "subclass": "Artillerist",
    "level": 3,
    "background": "Artisan",
    "species": "Rock Gnome",
    "xp": "",
    "hp": {
      "current": 21,
      "max": 21,
      "temp": 0
    },
    "ac": 14,
    "initiative": "+2",
    "speed": "30 ft",
    "passivePerception": 12,
    "proficiencyBonus": "+2",
    "abilities": {
      "STR": {
        "score": 8,
        "mod": "-1"
      },
      "DEX": {
        "score": 14,
        "mod": "+2"
      },
      "CON": {
        "score": 12,
        "mod": "+1"
      },
      "INT": {
        "score": 17,
        "mod": "+3"
      },
      "WIS": {
        "score": 14,
        "mod": "+2"
      },
      "CHA": {
        "score": 10,
        "mod": "+0"
      }
    },
    "saves": {
      "STR": "-1",
      "DEX": "+2",
      "CON": "+3",
      "INT": "+5",
      "WIS": "+2",
      "CHA": "0"
    },
    "skills": {
      "acrobatics": "+2",
      "animalHandling": "+2",
      "arcana": "+5",
      "athletics": "-1",
      "deception": "0",
      "history": "+3",
      "insight": "+2",
      "intimidation": "0",
      "investigation": "+5",
      "medicine": "+4",
      "nature": "+3",
      "perception": "+2",
      "performance": "0",
      "persuasion": "+2",
      "religion": "+3",
      "sleightOfHand": "+2",
      "stealth": "+2",
      "survival": "+2"
    },
    "languages": "Common\r\nGnomish\r\nDwarvish",
    "tools": "Tinker's Tools (DEX)              Thieves' Tools (DEX)\r\nSmith's Tools (STR)               Mason's Tools (STR)\r\nCarpenter's Tools (STR)        Leatherworker's Tools (DEX)\r\nWeaver's Tools (DEX)           Woodcarver's Tools (DEX)",
    "equipment": "Studded Leather Armor\r\nDagger\r\nTinker's Tools\r\nThieves' Tools\r\nSmith's Tools\r\nMason's Tools\r\n2 Pouches\r\nTraveler's Clothes\r\nBackpack\r\nCaltrops\r\nCrowbar\r\n2 flasks Oil\r\nRations x \r\nRope\r\nTinderbox\r\n10 Torches\r\nWaterskin",
    "features": {
      "classFeatures": "Spellcasting: Can use Tools you have proficiency with as spellcasting focus, and you must have these tools in hand to cast any artificer spell.\r\nRegain all spell slots on long rest.\r\nCan change all prepared spells on long rest.\r\n\r\nReplicate Magic Item: When you finish a long rest, you can create one or two magic items from your list of known plans. If the item requires attunement, you can attune it to yourself the instant you create it. \r\nYou can have up to 2 magic items created at a time. If you create one above this limit, the oldest item vanishes. Items vanish 1d4 days after you die.\r\nYou can use and wand or weapon created by this featuer as a spellcasting focus in lieu of using a set of Artisan's Tools.\r\n\r\nTinker's Magic: 3 uses/long rest. As a magic action while holding Tinker's Tools, create one item from list within 5 ft. Item lasts until long rest. \r\nBall Bearings, Basket, Bedroll, Bell, Blanket, Block&Tackle, Bucket, Caltrops, Candle, Crowbar, Flask, Jug, Lamp, Net, Oil, Paper, Parchment, Pole, Pouch, Rope, Sack, Shovel, String, Tinderbox, Torch, Vial\r\nRemaining Uses: OOO\n\nEldritch Cannon: Using Smith's Tools or Woodcarver's Tools, you can use action to create small or tiny eldritch cannon in unoccupied space within 5 ft. You determine appearance, if you carry, or if it stands on wheels or legs if you don't carry it. It disappears after 1 hour. You can create once per long rest for free. After this you must expend a spell slot to create another. You can only have one cannon at a time.\r\nAC: 18; hp: 15; cast mending to heal it 2d6\r\nImmune to poison, psychic\r\nBonus action: perform one of the below actions and move cannon up to 15 ft. before or after the action:\r\n  Flamethrower: 15 ft. cone. DEX save. Take 2d8 fire damage on fail or half as much on success, flammable objects not carried ignite\r\n  Force Ballista: 120 ft range. Attack roll. 2d8 force damage, and push target 5 ft. \r\n  Protector: Grants each creature of your choice within 10 ft. 1d8 +3 temporary hp. \r\n  \r\n☐",
      "speciesTraits": "Darkvision 60 ft\r\n\r\nGnomish Cunning: Advantage on INT,WIS,CHA saving throws\r\n\r\nGnomish Lineage: Know Mending & Prestidigitation. Can spend 10 minutes casting Prestidigitation to create Tiny clockwork device (AC 5,1hp). Device produces effect of Prestidigitation, creature can use bonus action to produce effect with device. Can make 3 devices at a time, they last 8 hours or if you dismantle. ",
      "feats": " "
    },
    "spellcasting": {
      "ability": "Intelligence",
      "saveDC": 13,
      "attackBonus": "+5",
      "slots": {
        "lvl1": {
          "total": 3,
          "expended": 0
        },
        "lvl2": {
          "total": 0,
          "expended": 0
        },
        "lvl3": {
          "total": 0,
          "expended": 0
        }
      }
    },
    "weapons": [
      {
        "name": "Dagger",
        "bonus": "+4",
        "damage": "1d4+2 piercing",
        "notes": "Throw 20/60",
        "ability": "DEX"
      },
      {
        "name": "Eldritch Cannon: Force Ballista",
        "bonus": "+5",
        "damage": "2d8 force",
        "notes": "120 ft, push 5 ft",
        "ability": "INT"
      },
      {
        "name": "Eldritch Cannon: Flamethrower",
        "bonus": "DC 13",
        "damage": "2d8 fire",
        "notes": "15 ft cone, DEX save for half",
        "ability": "INT"
      }
    ],
    "spells": [
      {
        "level": 0,
        "name": "Alchemy Jug"
      },
      {
        "name": "Bag of Holding",
        "level": 0
      },
      {
        "name": "Clockwork Amulet",
        "level": 0
      },
      {
        "level": 0,
        "name": "Mending",
        "notes": "Fix nonmagical object",
        "castingTime": "1 minute",
        "range": "Touch"
      },
      {
        "range": "10 ft",
        "castingTime": "Action",
        "name": "Prestidigitation",
        "notes": "Sensory,Fire,Clean,Sensation,Mark,Creation",
        "level": 0
      },
      {
        "level": 0,
        "name": "Wand of the War Mage +1"
      },
      {
        "range": "Self",
        "castingTime": "Reaction",
        "name": "Shield",
        "level": 1,
        "notes": "+5 AC until start of next turn"
      },
      {
        "range": "self:15 ft. cube",
        "castingTime": "Action",
        "level": 1,
        "name": "Thunderwave"
      }
    ],
    "backstory": "Fizzwizzle Tinkspark was born in the spark-scorched warrens of Gearwhistle Hollow, a Rock Gnome enclave deep beneath the Ironspine Mountains. From the moment he could walk, he was a tiny whirlwind of gears, sparks, and questionable decisions. While other gnome children played quietly, Fizz was rewiring the family lamps into singing, dancing contraptions that usually ended up on fire. His parents and six older siblings learned early to hide anything flammable and never leave him unsupervised with tools.His genius (or madness) truly revealed itself on his 42nd birthday when he unveiled the Auto-Digging Mole-Drill Mark I. It worked brilliantly for eleven glorious seconds — then drilled straight through a support pillar, caused a small cave-in, and launched the town’s prize mushroom garden into the ceiling. After the dust settled and the elders finished yelling, his family suggested the wider world might have more space for his particular brand of enthusiasm.With a backpack full of half-finished gadgets and his mother’s “please don’t explode anyone important” warning, Fizz left home and became a traveling merchant of wonders. He wanders the Sword Coast, selling enchanted tools, clockwork toys, self-stirring pots, and “mostly reliable” mining equipment. He’s repaired broken carts, enchanted pickaxes to glow in the dark, and turned ordinary lanterns into floating singing lights for many clients — including the ambitious dwarf miner Gundren Rockseeker.Gundren had used Fizz’s services several times before and was impressed by both his skill and his wild creativity. So when Gundren prepared a major new expedition to reclaim the lost mine of Wave Echo Cave near Phandalin, he sought Fizz out in Neverwinter. “Ten gold pieces and all the scrap you can carry,” the dwarf growled, sliding the coins across the table. Fizz’s eyes lit up like Fire Bolts. He enthusiastically agreed to join the expedition as the official tinkerer and artificer.Gundren and his bodyguard Sildar Hallwinter rode ahead to “take care of business,” while Fizz traveled with the supply wagon along the Triboar Trail. That’s when everything went wonderfully wrong. The party discovered two dead horses lying in the road — Gundren’s and Sildar’s — riddled with goblin arrows. Before they could even clear the path, Cragmaw goblins ambushed them from the trees.In the chaos of battle, instead of taking the safer route to town, the group boldly tracked the fleeing goblins straight back through the wilderness to their lair deep inside Cragmaw Hideout. What followed was a chaotic, explosive rescue mission. Fizz’s gadgets, Fire Bolts, Grease traps, and hasty inventions helped turn the tide as they fought through goblin ambushes. In the end, they successfully rescued Sildar Hallwinter from captivity. The expedition may have started with dead horses and goblin trouble, but it ended in roaring victory.Now, with the Sildar Hallwinter rescued, the grand mining expedition can’t continue until he finds Gundren Rockseeker.  With new scars, and a head full of fresh ideas from the lost mine, Fizzwizzle “Fizz” Tinkspark is more excited than ever. The world is full of things that need improving with a little spark and a lot of enthusiasm — and he’s just getting started!Personality Notes (perfect for your sheet or quick roleplay reminders)Alignment: Chaotic Good — rules are for people who haven’t invented better ones yet.Ideal: “Everything can be improved with a little spark and a lot of enthusiasm!”Bond: “My family back in Gearwhistle Hollow will one day hear legends of the greatest tinkerer the Sword Coast has ever seen.”Flaw: “If I haven’t tested it with the words ‘hold my ale,’ it’s clearly not finished yet.”",
    "saveProfs": [
      "CON",
      "INT"
    ],
    "skillProfs": {
      "arcana": "prof",
      "investigation": "prof",
      "medicine": "prof",
      "persuasion": "prof"
    },
    "skillMisc": {},
    "resources": [
      {
        "name": "Tinker's Magic",
        "current": 3,
        "max": 3,
        "reset": "long"
      },
      {
        "name": "Eldritch Cannon (free)",
        "current": 1,
        "max": 1,
        "reset": "long"
      }
    ],
    "coins": {
      "pp": 0,
      "gp": 0,
      "ep": 0,
      "sp": 0,
      "cp": 0
    }
  },
  "Gemini": {
    "name": "Gemini",
    "player": "Ethan",
    "class": "Warlock",
    "subclass": "Fiend Patron",
    "level": 3,
    "background": "Wayfarer",
    "species": "Infernal Tiefling",
    "xp": "",
    "hp": {
      "current": 21,
      "max": 21,
      "temp": 0
    },
    "ac": 14,
    "initiative": "+3",
    "speed": "30 ft",
    "passivePerception": 10,
    "proficiencyBonus": "+2",
    "abilities": {
      "STR": {
        "score": 8,
        "mod": "-1"
      },
      "DEX": {
        "score": 16,
        "mod": "+3"
      },
      "CON": {
        "score": 13,
        "mod": "+1"
      },
      "INT": {
        "score": 12,
        "mod": "+1"
      },
      "WIS": {
        "score": 10,
        "mod": "+0"
      },
      "CHA": {
        "score": 16,
        "mod": "+3"
      }
    },
    "saves": {
      "STR": "-1",
      "DEX": "+3",
      "CON": "+1",
      "INT": "+1",
      "WIS": "+2",
      "CHA": "+5"
    },
    "skills": {
      "acrobatics": "+3",
      "animalHandling": "0",
      "arcana": "+1",
      "athletics": "-1",
      "deception": "+5",
      "history": "+1",
      "insight": "+2",
      "intimidation": "+3",
      "investigation": "+3",
      "medicine": "0",
      "nature": "+1",
      "perception": "0",
      "performance": "+3",
      "persuasion": "+3",
      "religion": "+1",
      "sleightOfHand": "+3",
      "stealth": "+5",
      "survival": "0"
    },
    "languages": "Common\r\nGoblin\r\nElvish",
    "tools": "Thieves' Tools (DEX)",
    "equipment": "Leather Armor\r\nSickle\r\n4 Daggers\r\nArcane Focus (orb)\r\nBook (occult lore)\r\nThieves' Tools\r\nDice Set\r\nBedroll\r\n2 Pouches\r\nTraveler's Clothes\r\nBackpack\r\nInk\r\nInk Pen\r\nLamp\r\n9 flasks Oil\r\n20 sheets Parchment\r\nTinderbox\r\nFamiliar Incense x\r\n",
    "features": {
      "classFeatures": "Eldritch Invocations: \r\nPact of the Chain: You know Find Familiar and can cast it as an action without spending spell slot. Can choose regular form or special warlock form.\r\nWhen you take attack action, can forgo an attack to let familiar attack as its reaction.\r\n\r\nAgonizing Blast: Add you charisma modifier to Eldritch Blast's damage rolls.\r\n\r\nFiendish Vigor: You can cast False Life on yourself without expending a spell slot. When you do, you don't roll, you always get 12 Temp hp.\r\n\r\n\n\nPact Magic: Regain spell slots on short or long rest. Can change one spell on level up. Can use arcane focus as spellcasting focus.\r\n\r\nDark One's Blessing: When you reduce an enemy to 0 hp, you gain temp hp equal to CHA mod + warlock level (6). You also gain this benefit if someone else reduces an enemy within 10 ft of you to 0 hp.\r\n\r\nMagical Cunning: Once per long rest, You can perform a 1 minute rite to regain 1 spell slot. \r\nRemaining Uses: O",
      "speciesTraits": "Darkvision 60 ft\r\n\r\nOtherworldly Presence: Know the Thaumaturgy cantrip\r\n\r\nInfernal Legacy: Resistance to fire damage. Know fire bolt, hellish rebuke at level 3, and darkness at level 5\r\n\r\nOnce per long rest, can cast Hellish Rebuke as level 1 spell without spending a spell slot.\r\nRemaining Uses: O\r\n",
      "feats": " "
    },
    "spellcasting": {
      "ability": "Charisma",
      "saveDC": 13,
      "attackBonus": "+5",
      "slots": {
        "lvl1": {
          "total": 0,
          "expended": 0
        },
        "lvl2": {
          "total": 2,
          "expended": 0
        },
        "lvl3": {
          "total": 0,
          "expended": 0
        }
      }
    },
    "weapons": [
      {
        "name": "Eldritch Blast",
        "bonus": "+5",
        "damage": "1d10+3 force",
        "notes": "120 ft, Agonizing Blast",
        "ability": "CHA"
      },
      {
        "name": "Fire Bolt",
        "bonus": "+5",
        "damage": "1d10 fire",
        "notes": "120 ft",
        "ability": "CHA"
      },
      {
        "name": "Dagger",
        "bonus": "+5",
        "damage": "1d4+3 piercing",
        "notes": "Throw 20/60",
        "ability": "DEX"
      },
      {
        "name": "Sickle",
        "bonus": "+1",
        "damage": "1d4-1 slashing",
        "notes": "",
        "ability": "STR"
      }
    ],
    "spells": [
      {
        "notes": "Attack 1d10 +3 Force",
        "range": "120 ft",
        "castingTime": "Action",
        "level": 0,
        "name": "Eldritch Blast"
      },
      {
        "name": "False Life",
        "level": 0,
        "range": "Self",
        "castingTime": "Action",
        "notes": "10 temp hp & 10 cold dmg on meleevattacker 1 hr"
      },
      {
        "level": 0,
        "notes": "Consumes Burning Incense (10gp) on cast",
        "range": "10 ft",
        "castingTime": "Action",
        "name": "Find Familiar"
      },
      {
        "range": "120 ft",
        "castingTime": "Action",
        "name": "Fire Bolt",
        "notes": "Attack 1d10 Fire",
        "level": 0
      },
      {
        "name": "Prestidigitation",
        "castingTime": "Action",
        "range": "10 ft",
        "level": 0,
        "notes": "1d6 extra necro damage on target 4 hrs"
      },
      {
        "level": 0,
        "name": "Thaumaturgy",
        "notes": "Eyes,Voice,Fire,Hand,Sound,Tremor",
        "castingTime": "Action",
        "range": "30 ft"
      },
      {
        "name": "Armor of Agathys",
        "castingTime": "Bonus",
        "range": "Self",
        "level": 2,
        "notes": "Gain 12 temp hp"
      },
      {
        "range": "Self",
        "castingTime": "Action",
        "notes": "Attacking Creature: DEX Save: 3d10 fire damage",
        "name": "Burning Hands",
        "level": 2
      },
      {
        "range": "30 ft",
        "castingTime": "Action",
        "name": "Charm Person",
        "level": 2,
        "notes": "WIS save, 1 hr charm 2 humanoids"
      },
      {
        "notes": "WIS sv, 25 word limit, charms",
        "level": 2,
        "castingTime": "Action",
        "range": "60 ft",
        "name": "Command"
      },
      {
        "notes": "DEX sv, 15ft cone, 4d6 fire",
        "name": "Hellish Rebuke",
        "castingTime": "Reaction",
        "range": "60 ft",
        "level": 2
      },
      {
        "notes": "Sensory,Fire,Clean,Sensation,Mark,Creation",
        "range": "90 ft",
        "castingTime": "Bonus",
        "level": 2,
        "name": "Hex"
      },
      {
        "notes": "teleport 30 ft.",
        "range": "Self",
        "castingTime": "Bonus",
        "name": "Misty Step",
        "level": 2
      },
      {
        "name": "Scorching Ray",
        "level": 2,
        "castingTime": "Action",
        "notes": "x3 rays, 2d6 fire on hit",
        "range": "120 ft"
      },
      {
        "notes": "WIS sv, one word command, 2 targets",
        "range": "30 ft",
        "castingTime": "Action",
        "name": "Suggestion",
        "level": 2
      }
    ],
    "backstory": "Gemini’s Backstory: The Devil’s Favorite Party GirlGemini was born under a blood-red moon in the slums of Neverwinter’s Dock Ward, the unmistakable mark of her infernal heritage already curling from her scalp in a pair of elegant black horns that swept back like a crown. Her mother—a human washerwoman—named her Gemini after the twin stars that had burned especially bright the night she was born, whispering that maybe the girl would have “two lives” to make up for the one the devils had cursed her with. The second life arrived the moment she turned sixteen.She had scraped together enough coin and charm to enroll at the College of the Unseen Hand, Neverwinter’s notoriously cutthroat arcane academy tucked behind the walls of the Protector’s Enclave. Most students came from noble houses or rich merchant families. Gemini came with nothing but a quick tongue, a tail that never stopped flicking with mischief, and a hunger to prove that a tiefling could outshine them all. She threw herself into forbidden tomes the way other students threw themselves into wine—especially the cracked black-leather grimoire labeled *Dialogues with the Nine Hells*.One drunken study session changed everything.She and three other apprentices had been trying to summon a minor imp for extra credit. They got a pit fiend’s lesser lieutenant instead. The thing manifested in a cyclone of brimstone and laughter, took one look at the terrified students… and locked eyes with Gemini. It recognized the blood. “Little cousin,” it purred, “you’ve been wasting your fire on parlor tricks. Sign here, and I’ll give you the real party.”The contract appeared in living flame across her palm. In exchange for power, she would owe the fiend—Lord Varyx of the Brazen Chain—seven “debts of revelry”: seven nights in which she must throw the wildest, most legendary parties the Material Plane had ever seen, feeding him the chaos, lust, and reckless joy like fine wine. She laughed, signed in her own blood, and the pact snapped shut. The other students never spoke of that night again; two transferred to safer colleges, one still wakes up screaming.From that moment, Gemini became the college’s worst-kept secret and best-loved legend. Lectures by day, eldritch raves by night. She could charm the pants off a paladin, blast a hole through a tavern wall with a flick of her wrist, and still show up to morning classes with last night’s lipstick smeared across her horns. The faculty eventually “suggested” she take a year of field study—code for “get out before you burn the place down.”She was nursing a spectacular hangover in the Tap and Tack tavern when Gundren Rockseeker stomped in, grumbling about needing reliable muscle for a simple escort job to Phandalin. The dwarf was interviewing sellswords when Gemini sauntered up, tail swaying, and offered to “audition.” One minor illusion of a dancing dragon made of multicolored hellfire, one perfectly timed *charm person* on the tavern bouncer who’d tried to throw her out, and Gundren was roaring with laughter. “Lass, ye’ve got more spark than half the mercenaries in the Sword Coast and twice the charm,” he declared, slamming a tankard into her hand. “Ye’re hired—long as ye don’t blow up me wagon.”And that’s how the infernal party girl of Neverwinter became the newest member of the expedition.Now she rides with the others, horns wrapped in colorful ribbons, spellbook tucked beside a wineskin, and Lord Varyx’s amused voice occasionally whispering in her mind: *Remember, little cousin… you still owe me six more nights of glorious chaos.*Gemini intends to deliver—with interest.Quick DM Hooks & FlavorPatron Goal: Varyx doesn’t want souls; he wants stories. The wilder Gemini’s adventures, the sweeter the feast.Tiefling Trait Twist: Her infernal legacy lets her cast thaumaturgy at will; she uses it constantly to make her parties louder, her eyes glow hotter, and her laughter echo like distant thunder.Wayfarer Background: She’s got maps of every back-alley tavern from Waterdeep to Mirabar tattooed on the inside of her forearms in glowing infernal script—only visible when she’s drunk or casting.Secret: The seventh and final debt is coming due soon. If she doesn’t throw the party to end all parties, Varyx has promised to collect in person… and he’s bringing friends.She’s loud, she’s reckless, she’s brilliant, and she’s about to turn the whole Sword Coast into her personal dance floor. Let the adventure begin.",
    "saveProfs": [
      "WIS",
      "CHA"
    ],
    "skillProfs": {
      "investigation": "prof",
      "stealth": "prof",
      "deception": "prof",
      "insight": "prof"
    },
    "skillMisc": {},
    "resources": [
      {
        "name": "Lucky points",
        "current": 2,
        "max": 2,
        "reset": "long"
      },
      {
        "name": "Magical Cunning",
        "current": 1,
        "max": 1,
        "reset": "long"
      },
      {
        "name": "Hellish Rebuke (free cast)",
        "current": 1,
        "max": 1,
        "reset": "long"
      }
    ],
    "coins": {
      "pp": 0,
      "gp": 0,
      "ep": 0,
      "sp": 0,
      "cp": 0
    }
  },
  "Thorin": {
    "name": "Thorin Thundershield",
    "player": "Chris",
    "class": "Paladin",
    "subclass": "Oath of the Ancients",
    "level": 3,
    "background": "Noble",
    "species": "Dwarf",
    "xp": "",
    "hp": {
      "current": 28,
      "max": 28,
      "temp": 0
    },
    "ac": 18,
    "initiative": "+0",
    "speed": "30 ft",
    "passivePerception": 13,
    "proficiencyBonus": "+2",
    "abilities": {
      "STR": {
        "score": 16,
        "mod": "+3"
      },
      "DEX": {
        "score": 10,
        "mod": "+0"
      },
      "CON": {
        "score": 13,
        "mod": "+1"
      },
      "INT": {
        "score": 8,
        "mod": "-1"
      },
      "WIS": {
        "score": 12,
        "mod": "+1"
      },
      "CHA": {
        "score": 16,
        "mod": "+3"
      }
    },
    "saves": {
      "STR": "+3",
      "DEX": "0",
      "CON": "+1",
      "INT": "-1",
      "WIS": "+3",
      "CHA": "+5"
    },
    "skills": {
      "acrobatics": "0",
      "animalHandling": "+1",
      "arcana": "-1",
      "athletics": "+5",
      "deception": "+3",
      "history": "+1",
      "insight": "+3",
      "intimidation": "+5",
      "investigation": "-1",
      "medicine": "+1",
      "nature": "-1",
      "perception": "+3",
      "performance": "+3",
      "persuasion": "+5",
      "religion": "+1",
      "sleightOfHand": "0",
      "stealth": "0",
      "survival": "+1"
    },
    "languages": "Common\r\nDwarvish\r\nDraconic",
    "tools": "Dragonchess (WIS)",
    "equipment": "Chain Mail\r\nShield - Holy Symbol Emblem\r\nLongsword\r\n6 Javelins\r\nDragonchess set\r\nFine Clothes\r\nPerfume\r\nBackpack\r\nBlanket\r\nHoly Water\r\nLamp\r\n7 days Rations\r\nRobe\r\nTinderbox\r\n",
    "features": {
      "classFeatures": "Lay on Hands: Healing Pool of 3x paladin level replenished on long rest. Bonus action, touch creature to heal them any amount from remaining pool. Can also spend 5 from pool to remove poisoned condition (does not heal). \r\nRemaining hp: \r\n\r\nSpellcasting: Regain spell slots on long rest. Can replace one prepared spell on long rest. Can use Holy Symbol as spellcasting focus.\r\n\r\nFighting Style: Dueling: +2 damage when holding a weapon in one hand and no other weapons. \n\nWeapon Mastery: 2 weapons\r\nLongsword, Javelin\r\nCan change on long rest.\r\n\r\nPaladin's Smite: You always have the Divine Smite spell prepared. Additionally, once per long rest, you can cast it without expending a spell slot.\r\nRemaining Uses: O\r\n\r\n",
      "speciesTraits": "Darkvision 120 ft\r\n\r\nDwarven Resilience: Resistance to Poison damage and advantage on saving throws to avoid or end poisoned condition.\r\n\r\nDwarven Toughness: HP max increased by 1 each level.\r\n\r\nStonecunning: Bonus Action. \r\n2 uses/long rest. Gain tremor sense with 60 ft range for 10 minutes. Must be on a stone surface.",
      "feats": " "
    },
    "spellcasting": {
      "ability": "Charisma",
      "saveDC": 13,
      "attackBonus": "+5",
      "slots": {
        "lvl1": {
          "total": 3,
          "expended": 0
        },
        "lvl2": {
          "total": 0,
          "expended": 0
        },
        "lvl3": {
          "total": 0,
          "expended": 0
        }
      }
    },
    "weapons": [
      {
        "name": "Longsword",
        "bonus": "+5",
        "damage": "1d8+5 slashing",
        "notes": "Versatile 1d10; Sap: target disadv",
        "ability": "STR"
      },
      {
        "name": "Javelin",
        "bonus": "+5",
        "damage": "1d6+3 piercing",
        "notes": "Throw 30/120; Slow: -10 ft speed",
        "ability": "STR"
      }
    ],
    "spells": [
      {
        "level": 1,
        "name": "Divine Smite",
        "notes": "+2d8 radiant damage, more if fiend/undead",
        "castingTime": "Bonus",
        "range": "Self"
      }
    ],
    "backstory": "Chuck’s notes, feel free to delete or tweak, this is your backstory and character:Paladin who recently arrived in the coastal city of Neverwinter seeking a worthy cause to lend his sword. Quick to impress Gundren and earn a position in the party.",
    "saveProfs": [
      "WIS",
      "CHA"
    ],
    "skillProfs": {
      "athletics": "prof",
      "history": "prof",
      "religion": "prof",
      "insight": "prof",
      "perception": "prof",
      "intimidation": "prof",
      "persuasion": "prof"
    },
    "skillMisc": {},
    "resources": [
      {
        "name": "Lay on Hands (HP pool)",
        "current": 15,
        "max": 15,
        "reset": "long"
      },
      {
        "name": "Channel Divinity",
        "current": 2,
        "max": 2,
        "reset": "short"
      },
      {
        "name": "Paladin's Smite (free cast)",
        "current": 1,
        "max": 1,
        "reset": "long"
      },
      {
        "name": "Stonecunning",
        "current": 2,
        "max": 2,
        "reset": "long"
      }
    ],
    "coins": {
      "pp": 0,
      "gp": 0,
      "ep": 0,
      "sp": 0,
      "cp": 0
    }
  }
};




const INITIAL_SESSION_LOGS = [
  {
    "id": 1,
    "title": "Session 1: The Triboar Ambush",
    "date": "2026-05-15",
    "summary": "Hired by Gundren Rockseeker in Neverwinter to escort supplies to Phandalin. Tracked ambushing goblins to Cragmaw Hideout, struck a deal with Yeemik, defeated Klarg, and rescued Sildar Hallwinter.",
    "content": "DM Notes:\n- Hired by Gundren Rockseeker in Neverwinter to escort supplies to Phandalin\n- Discovered signs of an ambush on the Triboar Trail and were attacked by goblins\n- Captured a goblin and learned of a nearby hideout\n- Tracked the goblins to Cragmaw Hideout\n- Released the wolves held in Cragmaw Hideout\n- Struck a deal with Yeemik to defeat Klarg in exchange for Sildar’s safety\n- Defeated Klarg and rescued Sildar Hallwinter\n- Chose to leave remaining goblins and withdraw"
  },
  {
    "id": 2,
    "title": "Session 2: Trouble in Phandalin & The Redbrand Hideout",
    "date": "2026-05-22",
    "summary": "Arrived in Phandalin. Scouted Tresendar Manor, infiltrated the Redbrand Hideout, freed prisoners, and captured the wizard Glasstaff.",
    "content": "DM Notes:\n- Arrived in Phandalin\n- Sildar told of Gundren seeking Wave Echo Cave\n- Delivered supplies to Barthen, Redbrands took tax\n- Attempted to talk to strange spider which then ran away\n- Visited Shrine of Luck, did not receive good luck from Garaele\n- Garaele mentioned Agatha can answer a question for those brave enough to face her, near Conyberry\n- Visited weapons shop. Received Redbrand cloaks from Halia and promise of reward if they kill the leader Glasstaff\n- Visited Inn. Briefly met with Sildar\n- Scouted Sleeping Giant taphouse, decided not to engage\n- Scouted Tresendar Manor and found Redbrand Hideout in cellar\n- Freed prisoners in the hideout, including the deceased sheriff’s family and the halfling Darrin Copperpot who claims to have found a box the Redbrands took\n- Fully scouted the hideout with familiars\n- Surprised Glasstaff and took him down as he attempted to flee"
  }
];

const INITIAL_MAP_MARKERS = [
  {
    "id": 1,
    "name": "Neverwinter",
    "x": 200,
    "y": 120,
    "description": "The City of Skilled Hands. Where the party was hired by Gundren Rockseeker.",
    "type": "city"
  },
  {
    "id": 2,
    "name": "Triboar Trail",
    "x": 380,
    "y": 320,
    "description": "Where the party was ambushed by the Cragmaw goblins.",
    "type": "landmark"
  },
  {
    "id": 3,
    "name": "Cragmaw Hideout",
    "x": 420,
    "y": 280,
    "description": "The goblin cave where Sildar was rescued and Klarg was defeated.",
    "type": "dungeon"
  },
  {
    "id": 4,
    "name": "Phandalin",
    "x": 350,
    "y": 480,
    "description": "A frontier settlement built on the ruins of an older town. Current base of operations.",
    "type": "town"
  },
  {
    "id": 5,
    "name": "Tresendar Manor (Redbrand Hideout)",
    "x": 375,
    "y": 510,
    "description": "Ruined manor on the hill above Phandalin. Cellars housed the Redbrand Ruffians.",
    "type": "dungeon"
  },
  {
    "id": 6,
    "name": "Conyberry",
    "x": 750,
    "y": 320,
    "description": "Ruined town near which the banshee Agatha lives.",
    "type": "town"
  }
];

const INITIAL_PARTY_POSITION = {
  "x": 350,
  "y": 480,
  "lastUpdated": "Arrived in Phandalin; cleared Redbrand Hideout"
};
