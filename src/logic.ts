import type { Attribute } from "./dungeon";

export type StatKey = "P" | "I" | "V" | "F" | "A" | "S" | "T";

export interface PlayerState {
  hp: number;
  maxHp: number;
  xp: number;
  level: number;
  nextXp: number;
  statPoints: number;
  stats: Record<StatKey, number>;
  burnMs: number;
  iceMs: number;
  thunderMs: number;
  poisonMs: number;
  defenseBreak: number;
  hitInvulnMs: number;
  powerBoostMs: number;
  speedBoostMs: number;
}

export function computeDamageReduction(vitalityStat: number, defenseBreak: number): { vitalityReduction: number; poisonPenalty: number } {
  return {
    vitalityReduction: 1 - vitalityStat * 0.01,
    poisonPenalty: 1 + defenseBreak,
  };
}

export function applyDamage(
  player: PlayerState,
  amount: number,
  attribute: Attribute,
  bypassInvuln: boolean,
  armorDefense = 0
): { died: boolean; damageDealt: number } {
  if (!bypassInvuln && player.hitInvulnMs > 0) {
    return { died: false, damageDealt: 0 };
  }

  const { vitalityReduction, poisonPenalty } = computeDamageReduction(player.stats.V, player.defenseBreak);
  const actualDamage = Math.max(1, amount * vitalityReduction * poisonPenalty - armorDefense);
  player.hp -= actualDamage;
  if (!bypassInvuln) {
    player.hitInvulnMs = 450;
  }

  if (attribute === "Fire") {
    player.burnMs = Math.max(player.burnMs, 2500);
  } else if (attribute === "Ice") {
    player.iceMs = Math.max(player.iceMs, 2000);
  } else if (attribute === "Thunder") {
    player.thunderMs = Math.max(player.thunderMs, 180);
  } else if (attribute === "Poison") {
    player.poisonMs = Math.max(player.poisonMs, 3200);
    player.defenseBreak = Math.min(0.35, player.defenseBreak + 0.07);
  }

  return { died: player.hp <= 0, damageDealt: actualDamage };
}

export interface TickResult {
  died: boolean;
  burnDamage: number;
  poisonDamage: number;
  regen: number;
}

export function updatePlayerTimers(player: PlayerState, delta: number): void {
  player.hitInvulnMs = Math.max(0, player.hitInvulnMs - delta);
  if (player.thunderMs > 0) {
    player.thunderMs = Math.max(0, player.thunderMs - delta);
  }
  player.burnMs = Math.max(0, player.burnMs - delta);
  player.iceMs = Math.max(0, player.iceMs - delta);
  player.poisonMs = Math.max(0, player.poisonMs - delta);

  if (player.poisonMs <= 0) {
    player.defenseBreak = Math.max(0, player.defenseBreak - 0.005);
  }
  player.powerBoostMs = Math.max(0, player.powerBoostMs - delta);
  player.speedBoostMs = Math.max(0, player.speedBoostMs - delta);
}

export function applyPassiveTick(player: PlayerState): TickResult {
  let burnDamage = 0;
  let poisonDamage = 0;

  if (player.burnMs > 0) {
    const result = applyDamage(player, 2.5, "None", true);
    burnDamage = result.damageDealt;
    if (player.hp < 1) player.hp = 1; // DoT won't kill, leaves 1 HP
  }
  if (player.poisonMs > 0) {
    const result = applyDamage(player, 1.2, "None", true);
    poisonDamage = result.damageDealt;
    if (player.hp < 1) player.hp = 1; // DoT won't kill, leaves 1 HP
  }

  return { died: false, burnDamage, poisonDamage, regen: 0 };
}

export function healOnKill(player: PlayerState): number {
  const amount = 1 + player.stats.V * 0.3;
  const healed = Math.min(amount, player.maxHp - player.hp);
  player.hp += healed;
  return healed;
}

export function processLevelUps(player: PlayerState): number {
  let levelsGained = 0;
  while (player.xp >= player.nextXp) {
    player.xp -= player.nextXp;
    player.level += 1;
    player.nextXp = Math.floor(player.nextXp * 1.5);
    player.statPoints += 3;
    levelsGained += 1;
  }
  return levelsGained;
}

export function createDefaultPlayer(): PlayerState {
  return {
    hp: 60,
    maxHp: 60,
    xp: 0,
    level: 1,
    nextXp: 80,
    statPoints: 0,
    stats: { P: 4, I: 4, V: 4, F: 4, A: 4, S: 4, T: 4 },
    burnMs: 0,
    iceMs: 0,
    thunderMs: 0,
    poisonMs: 0,
    defenseBreak: 0,
    hitInvulnMs: 0,
    powerBoostMs: 0,
    speedBoostMs: 0,
  };
}
