import { describe, it, expect } from "vitest";
import {
  applyDamage,
  applyPassiveTick,
  computeDamageReduction,
  createDefaultPlayer,
  processLevelUps,
  updatePlayerTimers,
} from "./logic";

function freshPlayer() {
  return createDefaultPlayer();
}

describe("computeDamageReduction", () => {
  it("V=4 で 4% 軽減", () => {
    const { vitalityReduction } = computeDamageReduction(4, 0);
    expect(vitalityReduction).toBeCloseTo(0.96);
  });

  it("defenseBreak が poisonPenalty に反映される", () => {
    const { poisonPenalty } = computeDamageReduction(4, 0.14);
    expect(poisonPenalty).toBeCloseTo(1.14);
  });
});

describe("applyDamage", () => {
  it("基本ダメージ計算", () => {
    const player = freshPlayer();
    const { damageDealt } = applyDamage(player, 10, "None", false);
    expect(damageDealt).toBeCloseTo(10 * 0.96);
    expect(player.hp).toBeCloseTo(36 - 9.6);
    expect(player.hitInvulnMs).toBe(450);
  });

  it("hitInvulnMs 中はダメージを受けない", () => {
    const player = freshPlayer();
    player.hitInvulnMs = 100;
    const { damageDealt } = applyDamage(player, 10, "None", false);
    expect(damageDealt).toBe(0);
    expect(player.hp).toBe(36);
  });

  it("bypassInvuln で無敵を貫通", () => {
    const player = freshPlayer();
    player.hitInvulnMs = 100;
    const { damageDealt } = applyDamage(player, 10, "None", true);
    expect(damageDealt).toBeGreaterThan(0);
    expect(player.hp).toBeLessThan(36);
  });

  it("Fire 属性で burnMs が設定される", () => {
    const player = freshPlayer();
    applyDamage(player, 5, "Fire", false);
    expect(player.burnMs).toBe(2500);
  });

  it("Ice 属性で iceMs が設定される", () => {
    const player = freshPlayer();
    applyDamage(player, 5, "Ice", false);
    expect(player.iceMs).toBe(2000);
  });

  it("Thunder 属性で thunderMs が設定される", () => {
    const player = freshPlayer();
    applyDamage(player, 5, "Thunder", false);
    expect(player.thunderMs).toBe(180);
  });

  it("Poison 属性で poisonMs と defenseBreak が設定される", () => {
    const player = freshPlayer();
    applyDamage(player, 5, "Poison", false);
    expect(player.poisonMs).toBe(3200);
    expect(player.defenseBreak).toBeCloseTo(0.07);
  });

  it("Normal 属性ではステータス異常が付かない", () => {
    const player = freshPlayer();
    applyDamage(player, 5, "None", false);
    expect(player.burnMs).toBe(0);
    expect(player.iceMs).toBe(0);
    expect(player.thunderMs).toBe(0);
    expect(player.poisonMs).toBe(0);
  });

  it("HP が 0 以下になると died=true", () => {
    const player = freshPlayer();
    player.hp = 1;
    const { died } = applyDamage(player, 100, "None", false);
    expect(died).toBe(true);
  });
});

describe("applyPassiveTick (DoT)", () => {
  it("burn の tick ダメージで burnMs が再適用されない", () => {
    const player = freshPlayer();
    player.burnMs = 800;
    applyPassiveTick(player);
    // burnMs は tick 前の値のまま（再適用されていない）
    expect(player.burnMs).toBe(800);
    expect(player.hp).toBeLessThan(36);
  });

  it("poison の tick ダメージで poisonMs が再適用されない", () => {
    const player = freshPlayer();
    player.poisonMs = 1000;
    applyPassiveTick(player);
    expect(player.poisonMs).toBe(1000);
    expect(player.hp).toBeLessThan(36);
  });

  it("burn 中は HP が自然回復しない", () => {
    const player = freshPlayer();
    player.hp = 20;
    player.burnMs = 500;
    applyPassiveTick(player);
    // burn ダメージで HP は減るが、regen は適用されない
    expect(player.hp).toBeLessThan(20);
  });

  it("ステータス異常なしなら自然回復する", () => {
    const player = freshPlayer();
    player.hp = 20;
    const { regen } = applyPassiveTick(player);
    expect(regen).toBeGreaterThan(0);
    expect(player.hp).toBeGreaterThan(20);
  });

  it("HP が maxHp を超えない", () => {
    const player = freshPlayer();
    player.hp = player.maxHp;
    applyPassiveTick(player);
    expect(player.hp).toBe(player.maxHp);
  });
});

describe("updatePlayerTimers", () => {
  it("各タイマーが delta 分減少する", () => {
    const player = freshPlayer();
    player.hitInvulnMs = 450;
    player.burnMs = 2500;
    player.iceMs = 2000;
    player.thunderMs = 180;
    player.poisonMs = 3200;

    updatePlayerTimers(player, 100);

    expect(player.hitInvulnMs).toBe(350);
    expect(player.burnMs).toBe(2400);
    expect(player.iceMs).toBe(1900);
    expect(player.thunderMs).toBe(80);
    expect(player.poisonMs).toBe(3100);
  });

  it("タイマーは 0 未満にならない", () => {
    const player = freshPlayer();
    player.hitInvulnMs = 50;
    updatePlayerTimers(player, 200);
    expect(player.hitInvulnMs).toBe(0);
  });

  it("poison 切れで defenseBreak が徐々に回復", () => {
    const player = freshPlayer();
    player.defenseBreak = 0.1;
    player.poisonMs = 0;
    updatePlayerTimers(player, 16);
    expect(player.defenseBreak).toBeCloseTo(0.095);
  });
});

describe("processLevelUps", () => {
  it("XP が足りないとレベルアップしない", () => {
    const player = freshPlayer();
    player.xp = 10;
    const gained = processLevelUps(player);
    expect(gained).toBe(0);
    expect(player.level).toBe(1);
  });

  it("XP が足りるとレベルアップ", () => {
    const player = freshPlayer();
    player.xp = 55;
    const gained = processLevelUps(player);
    expect(gained).toBe(1);
    expect(player.level).toBe(2);
    expect(player.statPoints).toBe(3);
    expect(player.xp).toBe(5); // 55 - 50
  });

  it("一度に複数レベルアップ", () => {
    const player = freshPlayer();
    player.xp = 200;
    const gained = processLevelUps(player);
    expect(gained).toBeGreaterThan(1);
    expect(player.level).toBeGreaterThan(2);
    expect(player.statPoints).toBe(gained * 3);
  });
});
