/**
 * Balance simulator: Simulates player progression through floors
 * to verify DPS vs Boss HP at each boss floor.
 *
 * Run: npx tsx src/balance-sim.ts
 */

// ---- Inline types (avoid importing Phaser-dependent code) ----

type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";
type SpecialEffect = "Multishot" | "Homing" | "Explosion" | "Chain" | "Lifesteal";

interface WandStats {
  damage: number;
  fireRate: number;
  projectileSpeed: number;
  piercing: number;
}

interface Wand {
  name: string;
  attribute: string;
  rarity: Rarity;
  stats: WandStats;
  specialEffects: SpecialEffect[];
}

interface PlayerStats {
  P: number; I: number; V: number; F: number; A: number; S: number; T: number;
}

// ---- Constants (mirroring game.ts) ----

const RARITIES: Rarity[] = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const SPECIAL_EFFECTS: SpecialEffect[] = ["Multishot", "Homing", "Explosion", "Chain", "Lifesteal"];
const BASE_SPEED = 120;

function rarityValue(r: Rarity): number { return RARITIES.indexOf(r); }

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createRandomWand(floor: number, starter = false): Wand {
  const fortuneBonus = Math.floor(floor / 25);
  const rarityRoll = randomBetween(0, 100) + fortuneBonus * 8;
  const rarity: Rarity =
    starter ? "Common" :
    rarityRoll > 98 ? "Legendary" :
    rarityRoll > 88 ? "Epic" :
    rarityRoll > 72 ? "Rare" :
    rarityRoll > 44 ? "Uncommon" : "Common";

  const ri = rarityValue(rarity);
  const effectCount = Math.max(0, ri - 1);
  const effects = [...SPECIAL_EFFECTS].sort(() => Math.random() - 0.5).slice(0, effectCount) as SpecialEffect[];
  const hasMultishot = effects.includes("Multishot");
  const damage = (3 + floor * 0.25 + ri * 1.5) * (hasMultishot ? 0.4 : 1);
  const fireRate = Math.max(180, 520 - floor * 2 - ri * 45);

  return {
    name: `Wand F${floor}`,
    attribute: "None",
    rarity,
    stats: { damage, fireRate, projectileSpeed: 340 + ri * 40, piercing: 1 },
    specialEffects: effects
  };
}

// ---- DPS calculation (mirroring game logic) ----

function calcDps(wand: Wand, stats: PlayerStats, powerBoost = false): number {
  const dmg = wand.stats.damage * (1 + stats.P * 0.08) * (powerBoost ? 1.5 : 1);
  const interval = Math.max(120, wand.stats.fireRate - stats.S * 12);
  const shots = wand.specialEffects.includes("Multishot") ? 3 : 1;
  const critMultiplier = 1 + stats.T * 0.015 * 0.7;
  return dmg * shots * critMultiplier / (interval / 1000);
}

// ---- Boss HP calculation (mirroring game.ts) ----

const BOSS_MULTIPLIERS: Record<number, number> = {
  10: 20, 20: 60, 30: 80, 40: 100, 50: 130,
  60: 170, 70: 200, 80: 220, 90: 210, 100: 300
};

function bossHp(floor: number): number {
  const mult = BOSS_MULTIPLIERS[floor] ?? 1;
  return (18 + floor * 2 + 24) * mult; // elite = true for bosses
}

// ---- Enemy XP ----

function enemyXp(floor: number, aStat: number): number {
  return 5 + Math.floor(floor / 2) + Math.floor(aStat * 0.6);
}

// ---- Simulate a run ----

function simulateRun() {
  const stats: PlayerStats = { P: 4, I: 4, V: 4, F: 4, A: 4, S: 4, T: 4 };
  let wand = createRandomWand(1, true);
  let level = 1;
  let xp = 0;
  let nextXp = 50;
  let hp = 36;
  const maxHp = 36;

  console.log("=== Balance Simulation ===\n");
  console.log("Floor | Wand DMG | FireRate | DPS    | BossHP   | Time(s) | Level | Stats");
  console.log("------|----------|---------|--------|----------|---------|-------|------");

  for (let floor = 1; floor <= 100; floor++) {
    // Simulate finding better wands
    const enemiesPerFloor = Math.max(3, Math.floor(6 * Math.min(1, 0.4 + floor * 0.06)));
    for (let i = 0; i < enemiesPerFloor; i++) {
      // XP gain
      xp += enemyXp(floor, stats.A);
      while (xp >= nextXp) {
        xp -= nextXp;
        level += 1;
        nextXp = Math.floor(nextXp * 1.5);
        // Auto-allocate stats (simple strategy: rotate)
        const keys: (keyof PlayerStats)[] = ["P", "S", "T", "V", "A", "P", "S", "T", "V"];
        for (let sp = 0; sp < 3; sp++) {
          const key = keys[(level * 3 + sp) % keys.length];
          if (stats[key] < 20) stats[key]++;
        }
      }

      // 8% chance to find a wand
      if (Math.random() < 0.08 + stats.F * 0.01) {
        const found = createRandomWand(floor + stats.F);
        const foundDps = calcDps(found, stats);
        const currentDps = calcDps(wand, stats);
        if (foundDps > currentDps) {
          wand = found;
        }
      }
    }

    // Report at boss floors and every 10 floors
    if (floor % 10 === 0 || floor === 1 || floor === 5) {
      const dps = calcDps(wand, stats);
      const bHp = floor % 10 === 0 ? bossHp(floor) : 0;
      const fightTime = bHp > 0 ? (bHp / dps).toFixed(1) : "-";
      const statStr = `P${stats.P} S${stats.S} V${stats.V} T${stats.T} A${stats.A}`;
      console.log(
        `F${String(floor).padStart(3)}  | ${wand.stats.damage.toFixed(1).padStart(8)} | ${String(wand.stats.fireRate).padStart(7)} | ${dps.toFixed(1).padStart(6)} | ${String(bHp).padStart(8)} | ${String(fightTime).padStart(7)} | ${String(level).padStart(5)} | ${statStr}`
      );
    }
  }

  console.log("\n=== DPS with Power Potion (2x) ===\n");
  for (const floor of [10, 20, 50, 100]) {
    const dps = calcDps(wand, stats, true);
    const bHp = bossHp(floor);
    console.log(`F${floor}: DPS ${dps.toFixed(1)} vs Boss HP ${bHp} → ${(bHp / dps).toFixed(1)}s`);
  }
}

// Run multiple simulations
for (let run = 0; run < 3; run++) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`RUN ${run + 1}`);
  console.log(`${"=".repeat(60)}`);
  simulateRun();
}
