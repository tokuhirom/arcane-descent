import Phaser from "phaser";
import {
  Attribute,
  DungeonLayout,
  EnemyKind,
  Room,
  TILE_SIZE,
  TileType,
  generateDungeon
} from "./dungeon";
import {
  applyDamage,
  applyPassiveTick,
  updatePlayerTimers,
  processLevelUps,
  type PlayerState,
  type StatKey,
} from "./logic";
import { SfxManager } from "./sfx";

declare const __BUILD_TIME_JST__: string;
declare const __COMMIT_HASH__: string;

type FogState = 0 | 1 | 2;
type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";
type SpecialEffect = "Multishot" | "Homing" | "Explosion" | "Chain" | "Lifesteal";
interface Wand {
  name: string;
  attribute: Attribute;
  rarity: Rarity;
  stats: {
    damage: number;
    fireRate: number;
    projectileSpeed: number;
    piercing: number;
  };
  specialEffects: SpecialEffect[];
}

interface GamePlayerState extends PlayerState {
  wand: Wand;
}

interface EnemySprite extends Phaser.Physics.Arcade.Sprite {
  roomId: number;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  speed: number;
  fireCooldown: number;
  activeRoom: boolean;
  elite: boolean;
  attribute: Attribute;
  weakness: Attribute;
  resistance: Attribute;
  summonCooldown: number;
  burnMs: number;
  slowMs: number;
  stunMs: number;
  defenseBreak: number;
  touchCooldown: number;
  bossTier: number;
  splitDepth: number;
  bossTag?: string;
  isDecoy?: boolean;
  bossAbilityCd: number;
}

interface ProjectileSprite extends Phaser.Physics.Arcade.Image {
  damage: number;
  piercing: number;
  owner: "player" | "enemy";
  attribute: Attribute;
  specialEffects: SpecialEffect[];
  lifetimeMs: number;
  chainHits: number;
}

interface RunState {
  floor: number;
  player: GamePlayerState;
}

interface LootSprite extends Phaser.Physics.Arcade.Image {
  lootType: "wand";
  wand: Wand;
}

interface BossProfile {
  name: string;
  attribute: Attribute;
  kind: EnemyKind;
  maxHpMultiplier: number;
  speedMultiplier: number;
  fireCooldown: number;
}

const GAME_WIDTH = 540;
const GAME_HEIGHT = 960;
const BASE_SPEED = 120;
const ATTRIBUTES: Attribute[] = ["Fire", "Ice", "Thunder", "Poison", "None"];
const RARITIES: Rarity[] = ["Common", "Uncommon", "Rare", "Epic", "Legendary"];
const SPECIAL_EFFECTS: SpecialEffect[] = ["Multishot", "Homing", "Explosion", "Chain", "Lifesteal"];
const STAT_KEYS: StatKey[] = ["P", "I", "V", "F", "A", "S", "T"];
const STAT_LABELS: Record<StatKey, string> = {
  P: "Power",
  I: "Insight",
  V: "Vitality",
  F: "Fortune",
  A: "Arcana",
  S: "Swiftness",
  T: "Fate"
};
const STAT_DESCRIPTIONS: Record<StatKey, string> = {
  P: "攻撃力UP",
  I: "視界範囲が広がる",
  V: "最大HP+5, 被ダメ軽減, 自然回復UP",
  F: "良質な武器の出現率UP",
  A: "属性攻撃・継続ダメージ強化",
  S: "移動速度・攻撃速度UP",
  T: "クリティカル率UP"
};
const BOSS_PROFILES: Record<number, BossProfile> = {
  10: { name: "炎の魔獣", attribute: "Fire", kind: "rusher", maxHpMultiplier: 3.1, speedMultiplier: 1.25, fireCooldown: 1200 },
  20: { name: "氷の巨人", attribute: "Ice", kind: "shooter", maxHpMultiplier: 3.6, speedMultiplier: 0.85, fireCooldown: 1000 },
  30: { name: "雷の鳥", attribute: "Thunder", kind: "rusher", maxHpMultiplier: 3.0, speedMultiplier: 1.6, fireCooldown: 700 },
  40: { name: "毒の蜘蛛", attribute: "Poison", kind: "summoner", maxHpMultiplier: 3.5, speedMultiplier: 1.05, fireCooldown: 1100 },
  50: { name: "無属性の騎士", attribute: "None", kind: "shooter", maxHpMultiplier: 4.0, speedMultiplier: 1.1, fireCooldown: 820 },
  60: { name: "炎氷の双子", attribute: "Fire", kind: "summoner", maxHpMultiplier: 3.7, speedMultiplier: 1.2, fireCooldown: 900 },
  70: { name: "雷の魔導士", attribute: "Thunder", kind: "shooter", maxHpMultiplier: 4.1, speedMultiplier: 1.3, fireCooldown: 620 },
  80: { name: "毒の樹", attribute: "Poison", kind: "summoner", maxHpMultiplier: 4.8, speedMultiplier: 0.4, fireCooldown: 950 },
  90: { name: "虚無の影", attribute: "None", kind: "splitter", maxHpMultiplier: 4.4, speedMultiplier: 1.5, fireCooldown: 760 },
  100: { name: "深淵の王", attribute: "None", kind: "summoner", maxHpMultiplier: 6.5, speedMultiplier: 1.25, fireCooldown: 650 }
};

const sfx = new SfxManager();

function pick<T>(values: T[]): T {
  return values[Phaser.Math.Between(0, values.length - 1)];
}

function rarityValue(rarity: Rarity): number {
  return RARITIES.indexOf(rarity);
}

function clampStat(value: number): number {
  return Phaser.Math.Clamp(value, 1, 20);
}

function createStarterState(): RunState {
  return {
    floor: 1,
    player: {
      hp: 36,
      maxHp: 36,
      xp: 0,
      level: 1,
      nextXp: 50,
      statPoints: 0,
      stats: {
        P: 4,
        I: 4,
        V: 4,
        F: 4,
        A: 4,
        S: 4,
        T: 4
      },
      wand: createRandomWand(1, true),
      burnMs: 0,
      iceMs: 0,
      thunderMs: 0,
      poisonMs: 0,
      defenseBreak: 0,
      hitInvulnMs: 0
    }
  };
}

const SAVE_KEY = "arcane-descent-save";

function saveRun(run: RunState): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(run));
  } catch { /* quota exceeded etc */ }
}

function loadRun(): RunState | null {
  try {
    const data = localStorage.getItem(SAVE_KEY);
    if (!data) return null;
    const run = JSON.parse(data) as RunState;
    if (!run.player || !run.floor) return null;
    // ステータス異常・無敵をリセット
    run.player.burnMs = 0;
    run.player.iceMs = 0;
    run.player.thunderMs = 0;
    run.player.poisonMs = 0;
    run.player.defenseBreak = 0;
    run.player.hitInvulnMs = 0;
    return run;
  } catch {
    return null;
  }
}

function deleteSave(): void {
  localStorage.removeItem(SAVE_KEY);
}

function createRandomWand(floor: number, starter = false): Wand {
  const fortuneBonus = Math.floor(floor / 25);
  const rarityRoll = Phaser.Math.Between(0, 100) + fortuneBonus * 8;
  const rarity: Rarity =
    starter ? "Common" :
    rarityRoll > 98 ? "Legendary" :
    rarityRoll > 88 ? "Epic" :
    rarityRoll > 72 ? "Rare" :
    rarityRoll > 44 ? "Uncommon" : "Common";

  const rarityIndex = rarityValue(rarity);
  const effectCount = Math.max(0, rarityIndex - 1);
  const effects = Phaser.Utils.Array.Shuffle([...SPECIAL_EFFECTS]).slice(0, effectCount);
  const attribute = starter ? "None" : pick(ATTRIBUTES);
  const damage = 8 + floor * 0.7 + rarityIndex * 4;
  const fireRate = Math.max(180, 520 - floor * 2 - rarityIndex * 45);

  return {
    name: `${attribute === "None" ? "魔力" : attribute}の${["ワンド", "杖", "呪具"][Phaser.Math.Between(0, 2)]}`,
    attribute,
    rarity,
    stats: {
      damage,
      fireRate,
      projectileSpeed: 340 + rarityIndex * 40,
      piercing: 1 + (effects.includes("Chain") ? 1 : 0)
    },
    specialEffects: effects
  };
}

function makeText(scene: Phaser.Scene, x: number, y: number, text: string, size = 18, color = "#f8f1ff"): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: "Trebuchet MS, sans-serif",
    fontSize: `${size}px`,
    color
  });
}

class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  create(): void {
    const g = this.add.graphics();

    g.fillStyle(0x8e7cf6, 1);
    g.fillCircle(12, 12, 10);
    g.generateTexture("player", 24, 24);
    g.clear();

    g.fillStyle(0xffd166, 1);
    g.fillCircle(5, 5, 4);
    g.generateTexture("projectile", 10, 10);
    g.clear();

    g.fillStyle(0xff595e, 1);
    g.fillCircle(10, 10, 8);
    g.generateTexture("enemy-chaser", 20, 20);
    g.clear();

    g.fillStyle(0x56cfe1, 1);
    g.fillCircle(10, 10, 8);
    g.generateTexture("enemy-shooter", 20, 20);
    g.clear();

    g.fillStyle(0xff924c, 1);
    g.fillCircle(10, 10, 8);
    g.generateTexture("enemy-rusher", 20, 20);
    g.clear();

    g.fillStyle(0xc77dff, 1);
    g.fillCircle(10, 10, 8);
    g.generateTexture("enemy-splitter", 20, 20);
    g.clear();

    g.fillStyle(0x95d5b2, 1);
    g.fillCircle(10, 10, 8);
    g.generateTexture("enemy-summoner", 20, 20);
    g.clear();

    g.fillStyle(0xfff3b0, 1);
    g.fillRect(0, 0, 18, 18);
    g.generateTexture("chest", 18, 18);
    g.clear();

    g.fillStyle(0x1a1428, 1);
    g.fillRect(0, 0, 22, 22);
    g.fillStyle(0x9d4edd, 1);
    g.fillRect(2, 2, 18, 4);
    g.fillStyle(0x7b2fbf, 1);
    g.fillRect(4, 8, 14, 4);
    g.fillStyle(0x5a1f99, 1);
    g.fillRect(6, 14, 10, 4);
    g.fillStyle(0x3d1070, 1);
    g.fillRect(8, 19, 6, 3);
    g.generateTexture("stairs", 22, 22);
    g.clear();

    g.fillStyle(0xf4d35e, 1);
    g.fillRect(0, 6, 20, 6);
    g.fillStyle(0x8e7cf6, 1);
    g.fillRect(2, 0, 8, 8);
    g.generateTexture("wand-drop", 20, 12);
    g.clear();

    g.fillStyle(0xd7263d, 1);
    g.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    g.generateTexture("door-block", TILE_SIZE, TILE_SIZE);
    g.clear();

    g.fillStyle(0xff6b35, 0.7);
    g.fillCircle(8, 8, 7);
    g.generateTexture("hazard-fire", 16, 16);
    g.clear();

    g.fillStyle(0x80ed99, 0.7);
    g.fillCircle(8, 8, 7);
    g.generateTexture("hazard-poison", 16, 16);
    g.clear();

    g.fillStyle(0x7bdff2, 0.9);
    g.fillRect(0, 0, 14, 14);
    g.generateTexture("ice-pillar", 14, 14);
    g.destroy();

    this.scene.start("TitleScene");
  }
}

class TitleScene extends Phaser.Scene {
  constructor() {
    super("TitleScene");
  }

  create(): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0812, 0.96);
    this.add.ellipse(GAME_WIDTH / 2, 180, 360, 180, 0x241734, 0.8);
    this.add.ellipse(GAME_WIDTH / 2, 220, 260, 120, 0x3d1f52, 0.7);

    makeText(this, 56, 160, "Arcane", 46, "#f4d35e");
    makeText(this, 56, 214, "Descent", 58, "#f8f1ff");
    makeText(this, 56, 320, "ローグライト / ダンジョン探索", 22, "#cdb4db");
    makeText(this, 56, 362, "移動のみ。弾は自動射撃。", 20, "#d9d9ff");

    const saved = loadRun();
    let btnY = 520;

    if (saved) {
      const continueBtn = this.add.rectangle(GAME_WIDTH / 2, btnY, 300, 54, 0x1f3a24, 1)
        .setStrokeStyle(2, 0x80ed99)
        .setInteractive({ useHandCursor: true });
      makeText(this, GAME_WIDTH / 2 - 100, btnY - 14, `続きから (F${saved.floor} LV${saved.player.level})`, 22, "#80ed99");
      continueBtn.on("pointerdown", () => this.continueRun(saved));
      btnY += 70;
    }

    const startButton = this.add.rectangle(GAME_WIDTH / 2, btnY, 300, 54, 0x241734, 1)
      .setStrokeStyle(2, 0xf4d35e)
      .setInteractive({ useHandCursor: true });
    makeText(this, GAME_WIDTH / 2 - 72, btnY - 14, "New Game", 26, "#fff2b2");
    startButton.on("pointerdown", () => this.startRun());

    makeText(this, 56, 680, `Build: ${__BUILD_TIME_JST__}`, 16, "#9ad1ff");
    makeText(this, 56, 706, `Commit: ${__COMMIT_HASH__}`, 16, "#9ad1ff");
    makeText(this, 56, 780, "PC: WASD / Arrow Keys", 18, "#f8f1ff");
    makeText(this, 56, 808, "Mobile: Virtual Joystick", 18, "#f8f1ff");

    this.input.keyboard?.once("keydown-SPACE", () => saved ? this.continueRun(saved) : this.startRun());
    this.input.keyboard?.once("keydown-ENTER", () => saved ? this.continueRun(saved) : this.startRun());
  }

  private continueRun(run: RunState): void {
    if (this.scene.isActive("DungeonScene")) {
      this.scene.stop("DungeonScene");
    }
    this.scene.start("DungeonScene", run);
  }

  private startRun(): void {
    deleteSave();
    if (this.scene.isActive("DungeonScene")) {
      this.scene.stop("DungeonScene");
    }
    this.scene.start("DungeonScene", createStarterState());
  }
}

class BossIntroScene extends Phaser.Scene {
  constructor() {
    super("BossIntroScene");
  }

  create(data: { floor: number }): void {
    sfx.play("bossAlert");
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 420, 180, 0x120f1d, 0.92)
      .setStrokeStyle(2, 0xf4d35e);
    makeText(this, panel.x - 150, panel.y - 40, `BOSS FLOOR ${data.floor}`, 22, "#f4d35e");
    makeText(this, panel.x - 150, panel.y + 5, bossName(data.floor), 30, "#ffffff");
    makeText(this, panel.x - 150, panel.y + 55, "Press SPACE / Tap to descend", 18, "#cdb4db");
    this.input.once("pointerdown", () => this.scene.stop());
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.stop());
  }
}

class StairsConfirmScene extends Phaser.Scene {
  constructor() {
    super("StairsConfirmScene");
  }

  create(data: { floor: number; onDescend: () => void; onCancel: () => void }): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05050b, 0.6);
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 380, 160, 0x0f1020, 0.94)
      .setStrokeStyle(2, 0xf4d35e);

    makeText(this, panel.x - 150, panel.y - 50, `F${data.floor} → F${data.floor + 1}`, 24, "#fff2b2");
    makeText(this, panel.x - 150, panel.y - 15, "次の階に進みますか？", 18, "#f8f1ff");

    const yesBtn = this.add.rectangle(panel.x - 60, panel.y + 40, 110, 36, 0x3a254f, 1)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, 0xf4d35e);
    makeText(this, panel.x - 90, panel.y + 30, "進む", 20, "#f4d35e");

    const noBtn = this.add.rectangle(panel.x + 60, panel.y + 40, 110, 36, 0x241734, 1)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, 0x9d4edd);
    makeText(this, panel.x + 30, panel.y + 30, "戻る", 20, "#cdb4db");

    const descend = () => {
      this.scene.stop();
      data.onDescend();
    };
    const cancel = () => {
      this.scene.stop();
      data.onCancel();
    };

    yesBtn.on("pointerdown", descend);
    noBtn.on("pointerdown", cancel);
    this.input.keyboard?.once("keydown-SPACE", descend);
    this.input.keyboard?.once("keydown-ESC", cancel);
  }
}

class WandCompareScene extends Phaser.Scene {
  constructor() {
    super("WandCompareScene");
  }

  create(data: { current: Wand; found: Wand; pStat: number; sStat: number; onEquip: () => void; onSkip: () => void }): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05050b, 0.6);
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 460, 380, 0x0f1020, 0.94)
      .setStrokeStyle(2, 0x9d4edd);

    const cx = panel.x - 200;
    const cy = panel.y - 160;

    makeText(this, cx, cy, "ワンド比較", 24, "#f8f1ff");

    const calcDps = (wand: Wand): number => {
      const dmg = wand.stats.damage * (1 + data.pStat * 0.08);
      const interval = Math.max(120, wand.stats.fireRate - data.sStat * 12);
      const shots = wand.specialEffects.includes("Multishot") ? 3 : 1;
      return dmg * shots / (interval / 1000);
    };

    const drawWand = (wand: Wand, x: number, y: number, label: string, highlight: boolean) => {
      const color = highlight ? "#f4d35e" : "#cdb4db";
      makeText(this, x, y, label, 16, color);
      makeText(this, x, y + 22, `${wand.name}`, 18, "#f8f1ff");
      makeText(this, x, y + 46, `${wand.rarity}  ${wand.attribute}`, 14, "#cdb4db");
      makeText(this, x, y + 66, `攻撃 ${wand.stats.damage.toFixed(1)}  速度 ${wand.stats.fireRate}  貫通 ${wand.stats.piercing}`, 14, "#9ad1ff");
      const dps = calcDps(wand);
      makeText(this, x, y + 86, `DPS ${dps.toFixed(1)}`, 15, "#ff6b6b");
      const fx = wand.specialEffects.length > 0 ? wand.specialEffects.join(", ") : "-";
      makeText(this, x, y + 104, fx, 13, "#80ed99");
    };

    drawWand(data.current, cx, cy + 36, "装備中", false);
    drawWand(data.found, cx, cy + 170, "発見!", true);

    const equipBtn = this.add.rectangle(panel.x - 70, panel.y + 130, 140, 40, 0x3a254f, 1)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, 0xf4d35e);
    makeText(this, panel.x - 115, panel.y + 118, "装備する", 20, "#f4d35e");

    const skipBtn = this.add.rectangle(panel.x + 80, panel.y + 130, 140, 40, 0x241734, 1)
      .setInteractive({ useHandCursor: true })
      .setStrokeStyle(1, 0x9d4edd);
    makeText(this, panel.x + 35, panel.y + 118, "捨てる", 20, "#cdb4db");

    const equip = () => { this.scene.stop(); data.onEquip(); };
    const skip = () => { this.scene.stop(); data.onSkip(); };

    equipBtn.on("pointerdown", equip);
    skipBtn.on("pointerdown", skip);
    this.input.keyboard?.once("keydown-SPACE", equip);
    this.input.keyboard?.once("keydown-ESC", skip);
  }
}

class LevelUpScene extends Phaser.Scene {
  constructor() {
    super("LevelUpScene");
  }

  create(data: { stats: Record<StatKey, number>; onPick: (key: StatKey) => void; onClose: () => void }): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05050b, 0.72)
      .setInteractive();
    const panelH = 56 + STAT_KEYS.length * 52;
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 460, panelH, 0x0f1020, 0.94)
      .setStrokeStyle(2, 0x9d4edd);
    const topY = bg.y - panelH / 2 + 14;
    makeText(this, bg.x - 190, topY, "Level Up - 1つ選んで強化", 22, "#f8f1ff");

    STAT_KEYS.forEach((key, index) => {
      const x = bg.x - 200;
      const y = topY + 34 + index * 52;
      const button = this.add.rectangle(bg.x, y + 20, 420, 44, 0x241734, 1)
        .setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, 0xf4d35e);
      makeText(this, x + 16, y + 4, `${key} ${STAT_LABELS[key]}`, 18, "#fff2b2");
      makeText(this, x + 16, y + 24, `${STAT_DESCRIPTIONS[key]}  [${data.stats[key]}/20]`, 12, "#cdb4db");
      button.on("pointerdown", () => {
        data.onPick(key);
        data.onClose();
        this.scene.stop();
      });
    });
  }
}

class PauseScene extends Phaser.Scene {
  constructor() {
    super("PauseScene");
  }

  create(): void {
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05050b, 0.7)
      .setInteractive();
    makeText(this, GAME_WIDTH / 2 - 60, GAME_HEIGHT / 2 - 30, "PAUSE", 36, "#f8f1ff");
    makeText(this, GAME_WIDTH / 2 - 120, GAME_HEIGHT / 2 + 15, "Tap / Press P to resume", 20, "#cdb4db");

    const resume = () => {
      this.scene.stop();
      this.scene.resume("DungeonScene");
    };

    bg.on("pointerdown", resume);
    this.input.keyboard?.on("keydown-P", resume);
    this.input.keyboard?.once("keydown-ESC", resume);
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() {
    super("GameOverScene");
  }

  create(data?: { floor?: number; level?: number; cause?: string }): void {
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05050b, 0.92)
      .setInteractive();
    const cy = GAME_HEIGHT / 2;
    makeText(this, GAME_WIDTH / 2 - 120, cy - 80, "Game Over", 42, "#ff6b6b");
    if (data?.cause) {
      makeText(this, GAME_WIDTH / 2 - 180, cy - 25, `死因: ${data.cause}`, 20, "#cdb4db");
    }
    if (data?.floor) {
      makeText(this, GAME_WIDTH / 2 - 180, cy + 10, `到達: F${data.floor}  LV ${data.level ?? 1}`, 20, "#fff2b2");
    }
    makeText(this, GAME_WIDTH / 2 - 180, cy + 50, "Tap / Press R to restart", 22, "#f8f1ff");
    const restart = () => {
      this.scene.stop();
      this.scene.stop("DungeonScene");
      this.scene.start("TitleScene");
    };
    this.input.keyboard?.once("keydown-R", restart);
    bg.once("pointerdown", restart);
  }
}

class EndingScene extends Phaser.Scene {
  constructor() {
    super("EndingScene");
  }

  create(): void {
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x06070d, 0.95);
    makeText(this, 48, 220, "Arcane Descent", 42, "#f4d35e");
    makeText(this, 48, 310, "深淵の王は倒れ、迷宮は静寂を取り戻した。", 24, "#f8f1ff");
    makeText(this, 48, 360, "だが魔力の残響はまだ地下に満ちている。", 24, "#cdb4db");
    makeText(this, 48, 450, "Tap / Press R to descend again", 22, "#f8f1ff");
    const restart = () => {
      this.scene.stop();
      this.scene.stop("DungeonScene");
      this.scene.start("TitleScene");
    };
    this.input.keyboard?.once("keydown-R", restart);
    bg.setInteractive();
    bg.once("pointerdown", restart);
  }
}

class DungeonScene extends Phaser.Scene {
  private run!: RunState;
  private layout!: DungeonLayout;
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<string, Phaser.Input.Keyboard.Key>;
  private floorGraphics!: Phaser.GameObjects.Graphics;
  private fogGraphics!: Phaser.GameObjects.Graphics;
  private minimapGraphics!: Phaser.GameObjects.Graphics;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private enemyProjectiles!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private chests!: Phaser.Physics.Arcade.StaticGroup;
  private lootDrops!: Phaser.Physics.Arcade.Group;
  private bossDoors!: Phaser.Physics.Arcade.StaticGroup;
  private hazards!: Phaser.Physics.Arcade.Group;
  private icePillars!: Phaser.Physics.Arcade.StaticGroup;
  private stairs!: Phaser.Physics.Arcade.Image;
  private fireTimer = 0;
  private fog: FogState[][] = [];
  private hpText!: Phaser.GameObjects.Text;
  private xpText!: Phaser.GameObjects.Text;
  private floorText!: Phaser.GameObjects.Text;
  private wandText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private pauseButton!: Phaser.GameObjects.Text;
  private soundButton!: Phaser.GameObjects.Text;
  private joystickBase?: Phaser.GameObjects.Arc;
  private joystickThumb?: Phaser.GameObjects.Arc;
  private joystickVector = new Phaser.Math.Vector2();
  private joystickPointer?: Phaser.Input.Pointer;
  private knockbackVelocity = new Phaser.Math.Vector2();
  private isDying = false;
  private stairsCooldown = 0;
  private currentRoomId?: number;
  private roomTitleText?: Phaser.GameObjects.Text;
  private roomTitleTimer = 0;
  private passiveTickMs = 0;
  private bossPhase = 1;
  private enemyUpdateFrame = 0;
  private bossDoorLocked = false;
  private readonly usingTouchControls =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches === true);

  constructor() {
    super("DungeonScene");
  }

  create(runState: RunState): void {
    this.run = runState;
    this.cursors = this.input.keyboard?.createCursorKeys() ?? ({} as Phaser.Types.Input.Keyboard.CursorKeys);
    this.wasd = this.input.keyboard?.addKeys("W,A,S,D") as Record<string, Phaser.Input.Keyboard.Key>;

    this.floorGraphics = this.add.graphics();
    this.fogGraphics = this.add.graphics();
    this.minimapGraphics = this.add.graphics().setScrollFactor(0);

    this.enemies = this.physics.add.group();
    this.projectiles = this.physics.add.group();
    this.enemyProjectiles = this.physics.add.group();
    this.chests = this.physics.add.staticGroup();
    this.lootDrops = this.physics.add.group();
    this.bossDoors = this.physics.add.staticGroup();
    this.hazards = this.physics.add.group();
    this.icePillars = this.physics.add.staticGroup();

    this.layout = generateDungeon(this.run.floor);
    this.fog = Array.from({ length: this.layout.height }, () =>
      Array.from({ length: this.layout.width }, () => 0 as FogState)
    );

    this.drawDungeon();

    this.player = this.physics.add.sprite(
      this.layout.start.x * TILE_SIZE,
      this.layout.start.y * TILE_SIZE,
      "player"
    );
    this.player.setCollideWorldBounds(true);
    this.player.setCircle(10);
    this.player.setDepth(3);

    this.run.player.hitInvulnMs = 1500;
    this.spawnEncounters();
    this.stairs = this.physics.add.staticImage(
      this.layout.stairs.x * TILE_SIZE,
      this.layout.stairs.y * TILE_SIZE,
      "stairs"
    );
    this.stairs.setVisible(this.layout.bossRoomId === undefined);

    this.createUi();
    this.createJoystick();

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, this.layout.width * TILE_SIZE, this.layout.height * TILE_SIZE);
    this.cameras.main.setZoom(1.0);
    this.physics.world.setBounds(0, 0, this.layout.width * TILE_SIZE, this.layout.height * TILE_SIZE);

    const safeCallback = (fn: (...args: Phaser.GameObjects.GameObject[]) => void): Phaser.Types.Physics.Arcade.ArcadePhysicsCallback => {
      return ((...args: Phaser.GameObjects.GameObject[]) => {
        try {
          fn.apply(this, args);
        } catch (err) {
          const msg = err instanceof Error ? `${err.message}\n${err.stack?.split("\n").slice(1, 3).join("\n")}` : String(err);
          console.error("Physics callback error:", err);
          this.showMessage(`ERROR: ${msg}`);
        }
      }) as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback;
    };
    this.physics.add.overlap(this.projectiles, this.enemies, safeCallback(this.onProjectileHitsEnemy), undefined, this);
    this.physics.add.overlap(this.enemyProjectiles, this.player, safeCallback(this.onEnemyProjectileHitsPlayer), undefined, this);
    this.physics.add.overlap(this.player, this.enemies, safeCallback(this.onPlayerTouchesEnemy), undefined, this);
    this.physics.add.overlap(this.player, this.chests, safeCallback(this.onLootChest), undefined, this);
    this.physics.add.overlap(this.player, this.lootDrops, safeCallback(this.onCollectLoot), undefined, this);
    this.physics.add.overlap(this.player, this.stairs, safeCallback(this.onReachStairs), undefined, this);
    this.physics.add.overlap(this.player, this.hazards, safeCallback(this.onPlayerTouchesHazard), undefined, this);
    this.physics.add.collider(this.player, this.icePillars);
    this.physics.add.collider(this.enemies, this.icePillars);

    if (this.run.floor % 10 === 0) {
      this.scene.launch("BossIntroScene", { floor: this.run.floor });
    }

    this.input.keyboard?.on("keydown-P", () => {
      if (!this.scene.isPaused()) {
        this.scene.pause();
        this.scene.launch("PauseScene");
      }
    });
  }

  private createUi(): void {
    this.hpText = makeText(this, 16, 12, "", 20).setScrollFactor(0);
    this.xpText = makeText(this, 16, 40, "", 16, "#d9d9ff").setScrollFactor(0);
    this.floorText = makeText(this, GAME_WIDTH - 80, 12, "", 20, "#fff2b2").setScrollFactor(0);
    this.wandText = makeText(this, 16, GAME_HEIGHT - 180, "", 16, "#f8f1ff").setScrollFactor(0);
    this.statusText = makeText(this, 16, 66, "", 16, "#9ad1ff").setScrollFactor(0);
    this.messageText = makeText(this, 24, GAME_HEIGHT - 34, "", 18, "#fff2b2").setScrollFactor(0);
    this.soundButton = makeText(this, GAME_WIDTH - 130, GAME_HEIGHT - 90, sfx.muted ? "[x]" : "[♪]", 24, "#f8f1ff")
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.soundButton.on("pointerdown", () => {
      sfx.toggleMute();
      this.soundButton.setText(sfx.muted ? "[x]" : "[♪]");
    });
    this.pauseButton = makeText(this, GAME_WIDTH - 64, GAME_HEIGHT - 90, "[II]", 24, "#f8f1ff")
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.pauseButton.on("pointerdown", () => {
      this.scene.pause();
      this.scene.launch("PauseScene");
    });
    this.syncUi();
  }

  private joystickOrigin = new Phaser.Math.Vector2();

  private safeSetVelocity(sprite: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image, x: number, y: number): void {
    if (sprite.body) {
      sprite.setVelocity(x, y);
    }
  }

  private createJoystick(): void {
    this.joystickBase = this.add.circle(0, 0, 44, 0x3a254f, 0.4).setScrollFactor(0).setVisible(false).setDepth(20);
    this.joystickThumb = this.add.circle(0, 0, 18, 0xcdb4db, 0.6).setScrollFactor(0).setVisible(false).setDepth(20);
    if (!this.usingTouchControls) {
      return;
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.joystickPointer) {
        return;
      }
      this.joystickPointer = pointer;
      this.joystickOrigin.set(pointer.x, pointer.y);
      this.joystickBase?.setPosition(pointer.x, pointer.y).setVisible(true);
      this.joystickThumb?.setPosition(pointer.x, pointer.y).setVisible(true);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || pointer !== this.joystickPointer) {
        return;
      }
      this.updateJoystick(pointer);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer !== this.joystickPointer) {
        return;
      }
      this.joystickPointer = undefined;
      this.joystickVector.set(0, 0);
      this.joystickBase?.setVisible(false);
      this.joystickThumb?.setVisible(false);
    });
  }

  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const offset = new Phaser.Math.Vector2(pointer.x - this.joystickOrigin.x, pointer.y - this.joystickOrigin.y);
    if (offset.length() > 36) {
      offset.setLength(36);
    }
    this.joystickVector.copy(offset).scale(1 / 36);
    this.joystickThumb?.setPosition(this.joystickOrigin.x + offset.x, this.joystickOrigin.y + offset.y);
  }

  private drawDungeon(): void {
    const colors = {
      [TileType.Floor]: 0x2b2d42,
      [TileType.Wall]: 0x0c0b14,
      [TileType.WallEdge]: 0x3d405b
    };

    this.floorGraphics.clear();
    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
        this.floorGraphics.fillStyle(colors[this.layout.tiles[y][x]], 1);
        this.floorGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  private spawnEncounters(): void {
    this.layout.spawns.forEach((spawn) => {
      const enemy = this.enemies.create(spawn.x * TILE_SIZE, spawn.y * TILE_SIZE, `enemy-${spawn.kind}`) as EnemySprite;
      const bossProfile = spawn.roomId === this.layout.bossRoomId ? BOSS_PROFILES[this.run.floor] : undefined;
      enemy.roomId = spawn.roomId;
      enemy.kind = bossProfile?.kind ?? spawn.kind;
      enemy.elite = spawn.elite;
      enemy.activeRoom = false;
      enemy.fireCooldown = bossProfile?.fireCooldown ?? 0;
      enemy.summonCooldown = Phaser.Math.Between(1800, 3600);
      enemy.attribute = bossProfile?.attribute ?? pick(ATTRIBUTES);
      enemy.weakness = pick(ATTRIBUTES);
      enemy.resistance = pick(ATTRIBUTES);
      enemy.maxHp = (18 + this.run.floor * 2 + (spawn.elite ? 24 : 0)) * (bossProfile?.maxHpMultiplier ?? 1);
      enemy.hp = enemy.maxHp;
      enemy.speed = (40 + this.run.floor * 0.9 + (enemy.kind === "rusher" ? 20 : 0) + (spawn.elite ? 18 : 0)) * (bossProfile?.speedMultiplier ?? 1);
      enemy.burnMs = 0;
      enemy.slowMs = 0;
      enemy.stunMs = 0;
      enemy.defenseBreak = 0;
      enemy.touchCooldown = 0;
      enemy.bossTier = bossProfile ? Math.max(1, Math.floor(this.run.floor / 10)) : 0;
      enemy.splitDepth = enemy.kind === "splitter" ? 1 : 0;
      enemy.bossAbilityCd = 0;
      enemy.bossTag = bossProfile ? `boss-${this.run.floor}` : undefined;
      enemy.isDecoy = false;
      enemy.setDepth(3);
      enemy.setCircle(8);
      if (spawn.elite || bossProfile) {
        enemy.setScale(1.24);
        enemy.setTint(0xf4d35e);
      }
      if (bossProfile) {
        enemy.setScale(1.7);
        enemy.setTint(attributeColor(enemy.attribute));
      }
      if (this.run.floor === 80 && bossProfile) {
        enemy.speed = 0;
      }
      if (this.run.floor === 90 && bossProfile) {
        enemy.bossTag = "shadow-core";
      }
    });

    this.spawnBossVariants();

    this.layout.rooms
      .filter((room) => room.kind === "normal")
      .forEach((room) => {
        if (Math.random() < 0.35) {
          const cx = (room.x + 1 + Math.random() * (room.width - 2)) * TILE_SIZE;
          const cy = (room.y + 1 + Math.random() * (room.height - 2)) * TILE_SIZE;
          this.chests.create(cx, cy, "chest");
        }
      });
  }

  private spawnBossVariants(): void {
    if (this.layout.bossRoomId === undefined) {
      return;
    }
    const boss = (this.enemies.getChildren() as EnemySprite[]).find((enemy) => enemy.roomId === this.layout.bossRoomId);
    if (!boss) {
      return;
    }

    if (this.run.floor === 60) {
      const twin = this.enemies.create(boss.x + 52, boss.y - 22, "enemy-shooter") as EnemySprite;
      twin.roomId = boss.roomId;
      twin.kind = "shooter";
      twin.elite = true;
      twin.activeRoom = false;
      twin.fireCooldown = 700;
      twin.summonCooldown = 999999;
      twin.attribute = "Ice";
      twin.weakness = "Thunder";
      twin.resistance = "Fire";
      twin.maxHp = boss.maxHp * 0.82;
      twin.hp = twin.maxHp;
      twin.speed = boss.speed * 0.9;
      twin.burnMs = 0;
      twin.slowMs = 0;
      twin.stunMs = 0;
      twin.defenseBreak = 0;
      twin.touchCooldown = 0;
      twin.bossTier = boss.bossTier;
      twin.splitDepth = 0;
      twin.bossAbilityCd = 0;
      twin.bossTag = "twin-ice";
      twin.isDecoy = false;
      twin.setDepth(3);
      twin.setCircle(8);
      twin.setScale(1.55);
      twin.setTint(attributeColor("Ice"));

      boss.attribute = "Fire";
      boss.bossTag = "twin-fire";
      boss.setTint(attributeColor("Fire"));
    }

    if (this.run.floor === 90) {
      for (let i = 0; i < 2; i += 1) {
        const decoy = this.enemies.create(
          boss.x + Phaser.Math.Between(-72, 72),
          boss.y + Phaser.Math.Between(-72, 72),
          "enemy-splitter"
        ) as EnemySprite;
        decoy.roomId = boss.roomId;
        decoy.kind = "splitter";
        decoy.elite = true;
        decoy.activeRoom = false;
        decoy.fireCooldown = 0;
        decoy.summonCooldown = 999999;
        decoy.attribute = "None";
        decoy.weakness = "Fire";
        decoy.resistance = "None";
        decoy.maxHp = boss.maxHp * 0.28;
        decoy.hp = decoy.maxHp;
        decoy.speed = boss.speed * 1.1;
        decoy.burnMs = 0;
        decoy.slowMs = 0;
        decoy.stunMs = 0;
        decoy.defenseBreak = 0;
        decoy.touchCooldown = 0;
        decoy.bossTier = boss.bossTier;
        decoy.splitDepth = 0;
        decoy.bossAbilityCd = 0;
        decoy.bossTag = "shadow-decoy";
        decoy.isDecoy = true;
        decoy.setDepth(3);
        decoy.setCircle(8);
        decoy.setScale(1.3);
        decoy.setAlpha(0.65);
      }
    }
  }

  update(_: number, delta: number): void {
    try {
      this.doUpdate(delta);
    } catch (err) {
      const msg = err instanceof Error ? err.message + "\n" + err.stack?.split("\n").slice(0, 3).join("\n") : String(err);
      this.showMessage(`ERROR: ${msg}`);
      console.error("DungeonScene update error:", err);
    }
  }

  private doUpdate(delta: number): void {
    if (this.isDying) {
      return;
    }
    if (this.stairsCooldown > 0) {
      this.stairsCooldown -= delta;
    }
    const room = this.findCurrentRoom();
    if (room?.id !== this.currentRoomId) {
      this.currentRoomId = room?.id;
      this.showRoomTitle(room);
      this.updateBossDoorState(room);
    }

    this.enemies.children.iterate((child) => {
      const enemy = child as EnemySprite | null;
      if (!enemy) return true;
      enemy.activeRoom = this.shouldEnemyEngage(enemy);
      return true;
    });

    this.updatePlayerStatus(delta);
    this.handlePlayerMovement(delta);
    this.handleAutoFire(delta);
    this.updateEnemies(delta);
    this.updateFog();
    this.updatePlayerVisuals();
    this.syncUi();
    this.updateTransientUi(delta);
  }

  private updateBossDoorState(room?: Room): void {
    if (!room || room.kind !== "boss" || this.bossDoorLocked || this.layout.bossRoomId === undefined) {
      return;
    }

    this.bossDoorLocked = true;
    this.showMessage("扉が閉まり、退路が断たれた");
    const bossRoom = room;
    const entranceX = bossRoom.x;
    const entranceY = Math.floor(bossRoom.y + bossRoom.height / 2);
    for (let offset = -1; offset <= 1; offset += 1) {
      const door = this.bossDoors.create((entranceX - 1) * TILE_SIZE, (entranceY + offset) * TILE_SIZE, "door-block");
      door.setDepth(2);
    }
  }

  private shouldEnemyEngage(enemy: EnemySprite): boolean {
    const sameRoom = this.currentRoomId !== undefined && enemy.roomId === this.currentRoomId;
    const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
    const near = distance <= TILE_SIZE * 8;
    const visible = distance <= TILE_SIZE * 14 && this.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y);
    return sameRoom || near || visible;
  }

  private hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const steps = Math.ceil(distance / (TILE_SIZE / 3));

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = fromX + dx * t;
      const y = fromY + dy * t;
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      if (!this.isWalkable(tx, ty)) {
        return false;
      }
    }

    return true;
  }

  private showRoomTitle(room?: Room): void {
    if (!room) {
      return;
    }
    if (room.kind === "boss") {
      this.roomTitleText?.destroy();
      this.roomTitleText = makeText(this, GAME_WIDTH / 2 - 160, 100, `Boss: ${bossName(this.run.floor)}`, 22, "#fff2b2")
        .setScrollFactor(0)
        .setDepth(10);
      this.roomTitleTimer = 1800;
    }
  }

  private handlePlayerMovement(delta: number): void {
    const movement = new Phaser.Math.Vector2(0, 0);
    if (this.cursors.left?.isDown || this.wasd.A?.isDown) movement.x -= 1;
    if (this.cursors.right?.isDown || this.wasd.D?.isDown) movement.x += 1;
    if (this.cursors.up?.isDown || this.wasd.W?.isDown) movement.y -= 1;
    if (this.cursors.down?.isDown || this.wasd.S?.isDown) movement.y += 1;
    if (movement.lengthSq() === 0 && this.joystickVector.lengthSq() > 0) {
      movement.copy(this.joystickVector);
    }

    let speedMultiplier = this.run.player.iceMs > 0 ? 0.58 : 1;
    if (this.run.player.thunderMs > 0) {
      speedMultiplier *= 0.82;
    }
    if (movement.lengthSq() > 0) {
      movement.normalize().scale((BASE_SPEED + this.run.player.stats.S * 10) * speedMultiplier);
    }

    if (this.knockbackVelocity.lengthSq() > 1) {
      movement.add(this.knockbackVelocity);
      this.knockbackVelocity.scale(0.84);
    } else {
      this.knockbackVelocity.set(0, 0);
    }

    const stepX = movement.x * (delta / 1000);
    const stepY = movement.y * (delta / 1000);
    this.moveActorWithCollisions(this.player, stepX, 0);
    this.moveActorWithCollisions(this.player, 0, stepY);
    this.safeSetVelocity(this.player,0, 0);
  }

  private resolveWallCollision(bodyOwner: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image): void {
    if (!bodyOwner.body) {
      return;
    }
    const body = bodyOwner.body as Phaser.Physics.Arcade.Body;
    const left = Math.floor((bodyOwner.x - body.halfWidth) / TILE_SIZE);
    const right = Math.floor((bodyOwner.x + body.halfWidth) / TILE_SIZE);
    const top = Math.floor((bodyOwner.y - body.halfHeight) / TILE_SIZE);
    const bottom = Math.floor((bodyOwner.y + body.halfHeight) / TILE_SIZE);

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        if (!this.isWalkable(x, y)) {
          bodyOwner.x = Phaser.Math.Clamp(bodyOwner.x, TILE_SIZE * 2, this.layout.width * TILE_SIZE - TILE_SIZE * 2);
          bodyOwner.y = Phaser.Math.Clamp(bodyOwner.y, TILE_SIZE * 2, this.layout.height * TILE_SIZE - TILE_SIZE * 2);
          bodyOwner.body.stop();
          return;
        }
      }
    }
  }

  private moveActorWithCollisions(
    actor: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image,
    dx: number,
    dy: number
  ): void {
    if (!actor.body) {
      return;
    }

    const nextX = actor.x + dx;
    const nextY = actor.y + dy;

    if (dx !== 0 && !this.collidesAt(actor, nextX, actor.y)) {
      actor.x = nextX;
    }

    if (dy !== 0 && !this.collidesAt(actor, actor.x, nextY)) {
      actor.y = nextY;
    }
  }

  private isProjectileInWall(projectile: Phaser.Physics.Arcade.Image): boolean {
    const tx = Math.floor(projectile.x / TILE_SIZE);
    const ty = Math.floor(projectile.y / TILE_SIZE);
    return !this.isWalkable(tx, ty);
  }

  private collidesAt(
    actor: Phaser.Physics.Arcade.Sprite | Phaser.Physics.Arcade.Image,
    x: number,
    y: number
  ): boolean {
    if (!actor.body) {
      return false;
    }

    const body = actor.body as Phaser.Physics.Arcade.Body;
    const halfWidth = body.halfWidth;
    const halfHeight = body.halfHeight;
    const left = Math.floor((x - halfWidth) / TILE_SIZE);
    const right = Math.floor((x + halfWidth) / TILE_SIZE);
    const top = Math.floor((y - halfHeight) / TILE_SIZE);
    const bottom = Math.floor((y + halfHeight) / TILE_SIZE);

    for (let ty = top; ty <= bottom; ty += 1) {
      for (let tx = left; tx <= right; tx += 1) {
        if (!this.isWalkable(tx, ty)) {
          return true;
        }
      }
    }

    const doorHit = this.bossDoors.getChildren().some((child) => {
      const door = child as Phaser.Physics.Arcade.Image;
      return Math.abs(door.x - x) < TILE_SIZE * 0.75 && Math.abs(door.y - y) < TILE_SIZE * 0.75;
    });
    if (doorHit) {
      return true;
    }

    return false;
  }

  private handleAutoFire(delta: number): void {
    this.fireTimer -= delta;
    if (this.fireTimer > 0) {
      return;
    }

    const activeEnemies = this.enemies.getChildren().filter((child) => {
      const enemy = child as EnemySprite;
      return enemy.active && enemy.visible && enemy.activeRoom;
    }) as EnemySprite[];

    if (activeEnemies.length === 0) {
      return;
    }

    activeEnemies.sort((a, b) =>
      Phaser.Math.Distance.Between(this.player.x, this.player.y, a.x, a.y) -
      Phaser.Math.Distance.Between(this.player.x, this.player.y, b.x, b.y)
    );
    const target = activeEnemies[0];
    this.spawnPlayerProjectile(target.x, target.y, this.run.player.wand.specialEffects);
    this.fireTimer = Math.max(120, this.run.player.wand.stats.fireRate - this.run.player.stats.S * 12);
  }

  private spawnPlayerProjectile(targetX: number, targetY: number, effects: SpecialEffect[]): void {
    sfx.play("shoot");
    const shots = effects.includes("Multishot") ? 3 : 1;
    const baseAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, targetX, targetY);
    for (let i = 0; i < shots; i += 1) {
      const spread = shots === 1 ? 0 : Phaser.Math.DegToRad((i - 1) * 12);
      const projectile = this.projectiles.create(this.player.x, this.player.y, "projectile") as ProjectileSprite;
      projectile.owner = "player";
      projectile.damage = this.run.player.wand.stats.damage * (1 + this.run.player.stats.P * 0.08);
      projectile.piercing = this.run.player.wand.stats.piercing;
      projectile.attribute = this.run.player.wand.attribute;
      projectile.specialEffects = [...effects];
      projectile.lifetimeMs = 1200;
      projectile.chainHits = 0;
      projectile.setScale(0.9);
      projectile.setTint(attributeColor(projectile.attribute));
      if (projectile.body) {
        this.physics.velocityFromRotation(
          baseAngle + spread,
          this.run.player.wand.stats.projectileSpeed,
          (projectile.body as Phaser.Physics.Arcade.Body).velocity
        );
      }
    }
  }

  private updateEnemies(delta: number): void {
    this.enemyUpdateFrame = (this.enemyUpdateFrame + 1) % 6;
    this.enemies.children.iterate((child) => {
      const enemy = child as EnemySprite | null;
      if (!enemy || !enemy.active) {
        return true;
      }

      enemy.touchCooldown -= delta;
      this.tickEnemyStatus(enemy, delta);
      if (!enemy.active || !enemy.body) {
        return true;
      }

      if (!enemy.activeRoom) {
        this.safeSetVelocity(enemy,0, 0);
        return true;
      }

      const onScreen = this.cameras.main.worldView.contains(enemy.x, enemy.y);
      if (!onScreen && this.enemyUpdateFrame % 3 !== 0) {
        return true;
      }

      if (enemy.stunMs > 0) {
        this.safeSetVelocity(enemy,0, 0);
        return true;
      }

      enemy.fireCooldown -= delta;
      enemy.summonCooldown -= delta;
      enemy.bossAbilityCd -= delta;
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const direction = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();
      const speedMultiplier = enemy.slowMs > 0 ? 0.55 : 1;
      const bossPhaseMultiplier = enemy.bossTier > 0 ? this.getBossPhaseMultiplier(enemy) : 1;

      if (this.run.floor === 80 && enemy.roomId === this.layout.bossRoomId) {
        this.safeSetVelocity(enemy,0, 0);
        if (enemy.fireCooldown <= 0) {
          for (let i = 0; i < 3; i += 1) {
            this.spawnEnemyProjectile(enemy, Phaser.Math.DegToRad(-20 + i * 20));
          }
          enemy.fireCooldown = 900;
        }
      } else if (enemy.kind === "chaser" || enemy.kind === "splitter" || enemy.kind === "summoner") {
        this.safeSetVelocity(enemy,direction.x * enemy.speed * speedMultiplier * bossPhaseMultiplier, direction.y * enemy.speed * speedMultiplier * bossPhaseMultiplier);
      } else if (enemy.kind === "shooter") {
        const desired = distance > 180 ? 1 : distance < 120 ? -1 : 0;
        this.safeSetVelocity(enemy,direction.x * enemy.speed * desired * speedMultiplier, direction.y * enemy.speed * desired * speedMultiplier);
        if (enemy.fireCooldown <= 0) {
          const isF70Boss = this.run.floor === 70 && enemy.roomId === this.layout.bossRoomId;
          const volley = this.run.floor === 100 && enemy.roomId === this.layout.bossRoomId ? 4 : isF70Boss ? 3 : 1;
          for (let i = 0; i < volley; i += 1) {
            const spread = volley === 1 ? 0
              : isF70Boss ? Phaser.Math.DegToRad(-15 + i * 15)
              : Phaser.Math.DegToRad(-18 + i * 12);
            this.spawnEnemyProjectile(enemy, spread);
          }
          const baseCd = enemy.bossTier > 0 ? BOSS_PROFILES[this.run.floor].fireCooldown : 900;
          enemy.fireCooldown = Math.max(260, (isF70Boss ? baseCd * 0.7 : baseCd) - this.bossPhase * 70);
        }
      } else if (enemy.kind === "rusher") {
        const speed = distance < 120 ? enemy.speed * 2.4 : enemy.speed * 0.7;
        this.safeSetVelocity(enemy,direction.x * speed * speedMultiplier * bossPhaseMultiplier, direction.y * speed * speedMultiplier * bossPhaseMultiplier);
      }

      if (enemy.kind === "summoner" && enemy.summonCooldown <= 0) {
        const summonCount = enemy.bossTier >= 4 ? 2 : 1;
        for (let i = 0; i < summonCount; i += 1) {
          this.spawnMinion(enemy);
        }
        enemy.summonCooldown = Math.max(1100, 3200 - enemy.bossTier * 180);
      }

      // Boss-specific abilities
      if (enemy.bossTier > 0 && enemy.roomId === this.layout.bossRoomId && enemy.bossAbilityCd <= 0) {
        this.updateBossAbility(enemy);
      }

      this.resolveWallCollision(enemy);
      return true;
    });

    this.projectiles.children.iterate((child) => {
      const projectile = child as ProjectileSprite | null;
      if (!projectile || !projectile.active) return true;
      if (projectile.specialEffects.includes("Homing")) {
        this.applyProjectileHoming(projectile, 0.08);
      }
      projectile.lifetimeMs -= delta;
      if (projectile.lifetimeMs <= 0 || this.isProjectileInWall(projectile)) {
        projectile.destroy();
      }
      return true;
    });

    this.enemyProjectiles.children.iterate((child) => {
      const projectile = child as ProjectileSprite | null;
      if (!projectile || !projectile.active) return true;
      projectile.lifetimeMs -= delta;
      if (projectile.lifetimeMs <= 0 || this.isProjectileInWall(projectile)) {
        projectile.destroy();
      }
      return true;
    });
  }

  private spawnEnemyProjectile(enemy: EnemySprite, spread = 0): void {
    const projectile = this.enemyProjectiles.create(enemy.x, enemy.y, "projectile") as ProjectileSprite;
    projectile.owner = "enemy";
    projectile.damage = 5 + this.run.floor * 0.4 + enemy.bossTier * 2;
    projectile.piercing = 1;
    projectile.attribute = this.run.floor === 100 && enemy.roomId === this.layout.bossRoomId
      ? ATTRIBUTES[(this.bossPhase + Math.floor(this.time.now / 200)) % ATTRIBUTES.length]
      : enemy.attribute;
    projectile.specialEffects = [];
    projectile.chainHits = 0;
    projectile.lifetimeMs = 1400;
    projectile.setScale(0.75);
    projectile.setTint(attributeColor(enemy.attribute));
    if (!projectile.body) return;
    if (spread === 0) {
      this.physics.moveToObject(projectile, this.player, 220 + this.run.floor + enemy.bossTier * 18);
      return;
    }
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y) + spread;
    this.physics.velocityFromRotation(angle, 220 + this.run.floor + enemy.bossTier * 18, (projectile.body as Phaser.Physics.Arcade.Body).velocity);
  }

  private spawnMinion(enemy: EnemySprite): void {
    const minion = this.enemies.create(enemy.x + Phaser.Math.Between(-12, 12), enemy.y + Phaser.Math.Between(-12, 12), "enemy-chaser") as EnemySprite;
    minion.roomId = enemy.roomId;
    minion.kind = "chaser";
    minion.elite = false;
    minion.activeRoom = true;
    minion.fireCooldown = 0;
    minion.summonCooldown = 999999;
    minion.attribute = "None";
    minion.weakness = "Fire";
    minion.resistance = "Poison";
    minion.maxHp = 10 + this.run.floor;
    minion.hp = minion.maxHp;
    minion.speed = 60 + this.run.floor;
    minion.burnMs = 0;
    minion.slowMs = 0;
    minion.stunMs = 0;
    minion.defenseBreak = 0;
    minion.touchCooldown = 0;
    minion.bossTier = 0;
    minion.splitDepth = 0;
    minion.bossAbilityCd = 0;
    minion.setCircle(8);
  }

  private updateBossAbility(enemy: EnemySprite): void {
    const floor = this.run.floor;

    if (floor === 10) {
      // F10 "炎の魔獣" - fire trail
      this.spawnGroundHazard(enemy.x, enemy.y, "Fire", 3000);
      enemy.bossAbilityCd = 600;
    } else if (floor === 20) {
      // F20 "氷の巨人" - ice pillars near player
      this.spawnIcePillar(
        this.player.x + Phaser.Math.Between(-60, 60),
        this.player.y + Phaser.Math.Between(-60, 60),
        4000
      );
      enemy.bossAbilityCd = 2500;
    } else if (floor === 30) {
      // F30 "雷の鳥" - omni-directional lightning
      const directions = 12;
      for (let i = 0; i < directions; i += 1) {
        this.spawnEnemyProjectile(enemy, Phaser.Math.DegToRad(i * (360 / directions)));
      }
      enemy.bossAbilityCd = 2200;
    } else if (floor === 40) {
      // F40 "毒の蜘蛛" - poison swamp near player
      this.spawnGroundHazard(
        this.player.x + Phaser.Math.Between(-40, 40),
        this.player.y + Phaser.Math.Between(-40, 40),
        "Poison",
        4000
      );
      enemy.bossAbilityCd = 1800;
    } else if (floor === 100 && this.bossPhase >= 3) {
      // F100 "深淵の王" phase 3 - edge projectiles
      this.spawnEdgeProjectiles(enemy);
      enemy.bossAbilityCd = 3000;
    } else {
      // No special ability for this floor; prevent re-checking every frame
      enemy.bossAbilityCd = 5000;
    }
  }

  private spawnGroundHazard(x: number, y: number, attribute: Attribute, duration: number): void {
    const textureKey = attribute === "Fire" ? "hazard-fire" : "hazard-poison";
    const hazard = this.hazards.create(x, y, textureKey) as Phaser.Physics.Arcade.Image & { hazardAttribute: Attribute; hazardCooldown: number };
    hazard.hazardAttribute = attribute;
    hazard.hazardCooldown = 0;
    hazard.setDepth(1);
    hazard.setAlpha(0.8);
    if (hazard.body) {
      (hazard.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
      hazard.setImmovable(true);
      (hazard.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
    this.time.delayedCall(duration, () => {
      if (hazard.active) hazard.destroy();
    });
  }

  private onPlayerTouchesHazard(_playerObj: Phaser.GameObjects.GameObject, hazardObj: Phaser.GameObjects.GameObject): void {
    const hazard = hazardObj as Phaser.Physics.Arcade.Image & { hazardAttribute: Attribute; hazardCooldown: number };
    if (!hazard.active || hazard.hazardCooldown > 0) {
      return;
    }
    hazard.hazardCooldown = 500;
    this.time.delayedCall(500, () => {
      if (hazard.active) hazard.hazardCooldown = 0;
    });
    const damage = 4 + this.run.floor * 0.2;
    this.damagePlayer(damage, hazard.hazardAttribute, false, hazard.hazardAttribute === "Fire" ? "炎の地面" : "毒の沼");
  }

  private spawnIcePillar(x: number, y: number, duration: number): void {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (!this.isWalkable(tx, ty)) return;

    const pillar = this.icePillars.create(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, "ice-pillar") as Phaser.Physics.Arcade.Image;
    pillar.setDepth(2);
    pillar.setTint(0x7bdff2);
    pillar.refreshBody();
    this.time.delayedCall(duration, () => {
      if (pillar.active) pillar.destroy();
    });
  }

  private spawnEdgeProjectiles(enemy: EnemySprite): void {
    const bossRoom = this.layout.rooms.find((r) => r.id === this.layout.bossRoomId);
    if (!bossRoom) return;
    const cx = (bossRoom.x + bossRoom.width / 2) * TILE_SIZE;
    const cy = (bossRoom.y + bossRoom.height / 2) * TILE_SIZE;
    const count = 8;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count;
      const radius = Math.max(bossRoom.width, bossRoom.height) * TILE_SIZE * 0.45;
      const sx = cx + Math.cos(angle) * radius;
      const sy = cy + Math.sin(angle) * radius;
      const projectile = this.enemyProjectiles.create(sx, sy, "projectile") as ProjectileSprite;
      projectile.owner = "enemy";
      projectile.damage = 6 + this.run.floor * 0.3;
      projectile.piercing = 1;
      projectile.attribute = ATTRIBUTES[i % ATTRIBUTES.length];
      projectile.specialEffects = [];
      projectile.chainHits = 0;
      projectile.lifetimeMs = 2400;
      projectile.setScale(0.85);
      projectile.setTint(attributeColor(projectile.attribute));
      if (projectile.body) {
        const toCenter = new Phaser.Math.Vector2(cx - sx, cy - sy).normalize();
        (projectile.body as Phaser.Physics.Arcade.Body).setVelocity(toCenter.x * 180, toCenter.y * 180);
      }
    }
  }

  private onProjectileHitsEnemy(projectileObj: Phaser.GameObjects.GameObject, enemyObj: Phaser.GameObjects.GameObject): void {
    const projectile = projectileObj as ProjectileSprite;
    const enemy = enemyObj as EnemySprite;
    if (!projectile.active || !enemy.active) {
      return;
    }

    let damage = projectile.damage;
    if (projectile.attribute === enemy.weakness) damage *= 1.5;
    if (projectile.attribute === enemy.resistance) damage *= 0.5;
    damage *= 1 + enemy.defenseBreak;
    if (projectile.attribute === "Poison") damage *= 1.05 + this.run.player.stats.A * 0.01;
    if (projectile.attribute === "Fire") damage += 2 + this.run.player.stats.A * 0.2;
    if (projectile.attribute === "Thunder" && Math.random() < 0.15) enemy.stunMs = Math.max(enemy.stunMs, 250 + this.run.player.stats.A * 20);
    if (Math.random() < this.run.player.stats.T * 0.015) damage *= 1.7;

    if (projectile.attribute === "Fire") {
      enemy.burnMs = Math.max(enemy.burnMs, 2800 + this.run.player.stats.A * 70);
    } else if (projectile.attribute === "Ice") {
      enemy.slowMs = Math.max(enemy.slowMs, 2600 + this.run.player.stats.A * 60);
    } else if (projectile.attribute === "Poison") {
      enemy.defenseBreak = Math.min(0.5, enemy.defenseBreak + 0.08);
    }

    enemy.hp -= damage;
    sfx.play("enemyHit");
    projectile.piercing -= 1;

    // F50 "無属性の騎士" - reflect chance
    if (this.run.floor === 50 && enemy.roomId === this.layout.bossRoomId && enemy.bossTier > 0 && Math.random() < 0.3) {
      const reflected = this.enemyProjectiles.create(enemy.x, enemy.y, "projectile") as ProjectileSprite;
      reflected.owner = "enemy";
      reflected.damage = projectile.damage * 0.6;
      reflected.piercing = 1;
      reflected.attribute = "None";
      reflected.specialEffects = [];
      reflected.chainHits = 0;
      reflected.lifetimeMs = 1200;
      reflected.setScale(0.7);
      reflected.setTint(0xf8f1ff);
      if (reflected.body) {
        this.physics.moveToObject(reflected, this.player, 260);
      }
    }

    if (projectile.specialEffects.includes("Explosion")) {
      this.damageNearbyEnemies(enemy.x, enemy.y, damage * 0.35, 42);
    }
    if (projectile.specialEffects.includes("Lifesteal")) {
      this.run.player.hp = Math.min(this.run.player.maxHp, this.run.player.hp + damage * 0.05);
    }
    if (projectile.specialEffects.includes("Chain") && projectile.chainHits < 2) {
      this.chainProjectile(enemy, projectile);
    }

    if (enemy.hp <= 0) {
      this.killEnemy(enemy);
    }
    if (projectile.piercing <= 0) {
      projectile.destroy();
    }
  }

  private chainProjectile(source: EnemySprite, projectile: ProjectileSprite): void {
    const next = (this.enemies.getChildren() as EnemySprite[])
      .filter((enemy) => enemy.active && enemy !== source)
      .sort((a, b) =>
        Phaser.Math.Distance.Between(source.x, source.y, a.x, a.y) -
        Phaser.Math.Distance.Between(source.x, source.y, b.x, b.y)
      )[0];

    if (!next) {
      return;
    }

    projectile.chainHits += 1;
    this.spawnPlayerProjectile(next.x, next.y, []);
  }

  private applyProjectileHoming(projectile: ProjectileSprite, turnRate: number): void {
    const target = (this.enemies.getChildren() as EnemySprite[])
      .filter((enemy) => enemy.active && enemy.activeRoom)
      .sort((a, b) =>
        Phaser.Math.Distance.Between(projectile.x, projectile.y, a.x, a.y) -
        Phaser.Math.Distance.Between(projectile.x, projectile.y, b.x, b.y)
      )[0];
    if (!target || !projectile.body) {
      return;
    }
    const body = projectile.body as Phaser.Physics.Arcade.Body;
    const currentAngle = body.velocity.angle();
    const desiredAngle = Phaser.Math.Angle.Between(projectile.x, projectile.y, target.x, target.y);
    const nextAngle = Phaser.Math.Angle.RotateTo(currentAngle, desiredAngle, turnRate);
    const speed = Math.max(1, body.velocity.length());
    this.physics.velocityFromRotation(nextAngle, speed, body.velocity);
  }

  private damageNearbyEnemies(x: number, y: number, damage: number, radius: number): void {
    (this.enemies.getChildren() as EnemySprite[]).forEach((enemy) => {
      if (!enemy.active) return;
      if (Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y) <= radius) {
        enemy.hp -= damage;
        if (enemy.hp <= 0) {
          this.killEnemy(enemy);
        }
      }
    });
  }

  private killEnemy(enemy: EnemySprite): void {
    sfx.play("enemyDeath");
    const gainedXp = 5 + Math.floor(this.run.floor / 2) + Math.floor(this.run.player.stats.A * 0.6);
    this.run.player.xp += gainedXp;
    if (Math.random() < 0.08 + this.run.player.stats.F * 0.01) {
      this.spawnWandDrop(enemy.x, enemy.y, createRandomWand(this.run.floor + this.run.player.stats.F));
    }
    if (this.run.floor === 60 && (enemy.bossTag === "twin-fire" || enemy.bossTag === "twin-ice")) {
      this.enrageRemainingTwin(enemy);
    }
    if (enemy.roomId === this.layout.bossRoomId && !enemy.isDecoy && !this.hasLivingBosses(enemy)) {
      this.bossDoors.clear(true, true);
      this.stairs.setData("unlocked", true);
      this.stairs.setVisible(true);
      this.spawnWandDrop(enemy.x + 18, enemy.y, createRandomWand(this.run.floor + 8 + this.run.player.stats.F));
      this.showMessage("ボス撃破、階段が現れた");
      if (this.run.floor === 100) {
        deleteSave();
        this.scene.start("EndingScene");
        return;
      }
    }
    if (enemy.kind === "splitter" && enemy.splitDepth < 2) {
      this.spawnMinion(enemy);
      this.spawnMinion(enemy);
    }
    enemy.destroy();
    this.checkLevelUp();
  }

  private hasLivingBosses(ignoring?: EnemySprite): boolean {
    return (this.enemies.getChildren() as EnemySprite[]).some((enemy) =>
      enemy.active &&
      enemy !== ignoring &&
      enemy.roomId === this.layout.bossRoomId &&
      !enemy.isDecoy
    );
  }

  private enrageRemainingTwin(deadTwin: EnemySprite): void {
    const survivor = (this.enemies.getChildren() as EnemySprite[]).find((enemy) =>
      enemy.active &&
      enemy !== deadTwin &&
      (enemy.bossTag === "twin-fire" || enemy.bossTag === "twin-ice")
    );
    if (!survivor) {
      return;
    }
    survivor.hp = Math.min(survivor.maxHp * 1.4, survivor.hp + survivor.maxHp * 0.3);
    survivor.maxHp *= 1.25;
    survivor.speed *= 1.2;
    survivor.setScale(survivor.scaleX * 1.1);
    this.showMessage("片割れが激昂して強化された");
  }

  private checkLevelUp(): void {
    const gained = processLevelUps(this.run.player);
    if (gained > 0) {
      sfx.play("levelUp");
    }

    if (this.run.player.statPoints > 0 && !this.scene.isActive("LevelUpScene")) {
      this.scene.pause();
      this.scene.launch("LevelUpScene", {
        stats: this.run.player.stats,
        onPick: (key: StatKey) => {
          this.run.player.stats[key] = clampStat(this.run.player.stats[key] + 1);
          this.run.player.statPoints -= 1;
          if (key === "V") {
            this.run.player.maxHp += 5;
            this.run.player.hp = Math.min(this.run.player.maxHp, this.run.player.hp + 5);
          }
        },
        onClose: () => {
          this.scene.resume();
        }
      });
    }
  }

  private onEnemyProjectileHitsPlayer(obj1: Phaser.GameObjects.GameObject, obj2: Phaser.GameObjects.GameObject): void {
    // Phaser may pass (player, projectile) or (projectile, player) depending on overlap order
    const projectile = (obj1 === this.player ? obj2 : obj1) as ProjectileSprite;
    if (!projectile.active || (projectile as unknown) === this.player) {
      return;
    }
    this.damagePlayer(projectile.damage, projectile.attribute, false, `${projectile.attribute}の弾`);
    projectile.destroy();
  }

  private onPlayerTouchesEnemy(_: Phaser.GameObjects.GameObject, enemyObj: Phaser.GameObjects.GameObject): void {
    const enemy = enemyObj as EnemySprite;
    if (!enemy.active || enemy.touchCooldown > 0) {
      return;
    }
    enemy.touchCooldown = 700;
    const killerName = enemy.bossTier > 0
      ? (BOSS_PROFILES[this.run.floor]?.name ?? `${enemy.attribute}のボス`)
      : `${enemy.attribute}の${enemy.kind}`;
    this.damagePlayer(6 + this.run.floor * 0.25 + enemy.bossTier * 2, enemy.attribute, false, killerName);
    const knockback = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y);
    if (knockback.lengthSq() < 1) {
      knockback.set(
        Phaser.Math.Between(-100, 100) / 100,
        Phaser.Math.Between(-100, 100) / 100
      );
    }
    this.knockbackVelocity = knockback.normalize().scale(220);
  }

  private damagePlayer(amount: number, attribute: Attribute, bypassInvuln: boolean, cause = "不明"): void {
    const { died, damageDealt } = applyDamage(this.run.player, amount, attribute, bypassInvuln);
    if (damageDealt > 0) {
      sfx.play("playerHit");
      console.log(`HIT: ${damageDealt.toFixed(1)} ${attribute} hp=${this.run.player.hp.toFixed(1)} died=${died}`);
    }
    if (died) {
      this.startDeathSequence(cause);
    }
  }

  private startDeathSequence(cause: string): void {
    if (this.isDying) return;
    this.isDying = true;
    deleteSave();
    sfx.play("gameOver");
    this.player.setVisible(false);
    this.physics.pause();

    const graveX = this.player.x;
    const graveY = this.player.y;
    const g = this.add.graphics();
    g.fillStyle(0x888888, 1);
    g.fillRoundedRect(graveX - 10, graveY - 16, 20, 20, 3);
    g.fillRect(graveX - 6, graveY - 22, 12, 6);
    g.setDepth(5);

    const deathText = this.add.text(graveX, graveY - 40, "†", {
      fontFamily: "Trebuchet MS, sans-serif",
      fontSize: "28px",
      color: "#ff6b6b"
    }).setOrigin(0.5).setDepth(5);

    this.time.delayedCall(800, () => {
      const causeText = this.add.text(graveX, graveY + 16, cause, {
        fontFamily: "Trebuchet MS, sans-serif",
        fontSize: "14px",
        color: "#cdb4db"
      }).setOrigin(0.5).setDepth(5);

      this.tweens.add({ targets: causeText, alpha: { from: 0, to: 1 }, duration: 400 });
    });

    this.time.delayedCall(3000, () => {
      g.destroy();
      deathText.destroy();
      this.scene.launch("GameOverScene", {
        floor: this.run.floor,
        level: this.run.player.level,
        cause
      });
      this.scene.pause();
    });
  }

  private onLootChest(_: Phaser.GameObjects.GameObject, chestObj: Phaser.GameObjects.GameObject): void {
    const chest = chestObj as Phaser.Physics.Arcade.Image;
    sfx.play("pickup");
    this.spawnWandDrop(chest.x, chest.y, createRandomWand(this.run.floor + 4 + this.run.player.stats.F));
    this.run.player.hp = Math.min(this.run.player.maxHp, this.run.player.hp + 8);
    this.showMessage("宝箱からワンドが落ちた");
    chest.destroy();
  }

  private onCollectLoot(_: Phaser.GameObjects.GameObject, lootObject: Phaser.GameObjects.GameObject): void {
    const loot = lootObject as LootSprite;
    if (!loot.active || this.scene.isActive("WandCompareScene")) {
      return;
    }
    loot.disableBody(true, false);
    this.scene.pause();
    this.scene.launch("WandCompareScene", {
      current: this.run.player.wand,
      found: loot.wand,
      pStat: this.run.player.stats.P,
      sStat: this.run.player.stats.S,
      onEquip: () => {
        sfx.play("pickup");
        this.run.player.wand = loot.wand;
        this.showMessage(`${loot.wand.rarity} ${loot.wand.name} を装備した`);
        loot.destroy();
        this.scene.resume();
      },
      onSkip: () => {
        this.showMessage(`${loot.wand.name} を捨てた`);
        loot.destroy();
        this.scene.resume();
      }
    });
  }

  private onReachStairs(): void {
    if (!this.stairs.visible) {
      this.showMessage("ボスを倒すまで階段は開かない");
      return;
    }
    if (this.scene.isActive("StairsConfirmScene") || this.stairsCooldown > 0) {
      return;
    }
    sfx.play("stairs");
    this.scene.pause();
    this.scene.launch("StairsConfirmScene", {
      floor: this.run.floor,
      onDescend: () => {
        this.run.floor += 1;
        saveRun(this.run);
        this.scene.restart(this.run);
      },
      onCancel: () => {
        this.stairsCooldown = 1000;
        this.scene.resume();
      }
    });
  }

  private updatePlayerStatus(delta: number): void {
    updatePlayerTimers(this.run.player, delta);

    this.passiveTickMs += delta;
    if (this.passiveTickMs >= 500) {
      this.passiveTickMs = 0;
      const { died, burnDamage, poisonDamage } = applyPassiveTick(this.run.player);
      if (died) {
        const cause = burnDamage > 0 ? "炎上ダメージ" : poisonDamage > 0 ? "毒ダメージ" : "持続ダメージ";
        this.startDeathSequence(cause);
      }
    }
  }

  private updatePlayerVisuals(): void {
    if (!this.isDying) {
      this.player.setVisible(true);
      this.player.setAlpha(this.run.player.hitInvulnMs > 0 ? 0.5 : 1);
      if (!this.player.active || isNaN(this.player.x) || isNaN(this.player.y)) {
        console.error(`Player broken: active=${this.player.active} x=${this.player.x} y=${this.player.y}`);
        this.player.setPosition(this.layout.start.x * TILE_SIZE, this.layout.start.y * TILE_SIZE);
        this.player.setActive(true);
        this.showMessage("WARN: player reset");
      }
      this.player.setDepth(3);
    }
    if (this.run.player.thunderMs > 0) {
      this.player.setTint(0xffd166);
      this.player.setScale(1.08);
      return;
    }
    if (this.run.player.burnMs > 0) {
      this.player.setTint(0xff6b35);
      this.player.setScale(1.05);
      return;
    }
    if (this.run.player.poisonMs > 0) {
      this.player.setTint(0x80ed99);
      this.player.setScale(1.04);
      return;
    }
    if (this.run.player.iceMs > 0) {
      this.player.setTint(0x7bdff2);
      this.player.setScale(1.04);
      return;
    }

    this.player.clearTint();
    this.player.setScale(1);
  }

  private tickEnemyStatus(enemy: EnemySprite, delta: number): void {
    enemy.burnMs = Math.max(0, enemy.burnMs - delta);
    enemy.slowMs = Math.max(0, enemy.slowMs - delta);
    enemy.stunMs = Math.max(0, enemy.stunMs - delta);
    if (enemy.burnMs > 0 && Phaser.Math.Between(0, 100) < 10) {
      enemy.hp -= 0.6 + this.run.player.stats.A * 0.05;
      if (enemy.hp <= 0) {
        this.killEnemy(enemy);
      }
    }
  }

  private getBossPhaseMultiplier(enemy: EnemySprite): number {
    const ratio = enemy.hp / enemy.maxHp;
    this.bossPhase = ratio > 0.6 ? 1 : ratio > 0.3 ? 2 : 3;
    return this.bossPhase === 1 ? 1 : this.bossPhase === 2 ? 1.18 : 1.35;
  }

  private tileLineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0;
    let cy = y0;
    while (cx !== x1 || cy !== y1) {
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
      if ((cx !== x1 || cy !== y1) && !this.isWalkable(cx, cy)) {
        return false;
      }
    }
    return true;
  }

  private updateFog(): void {
    const radius = 4 + Math.floor(this.run.player.stats.I / 2);
    const px = Math.floor(this.player.x / TILE_SIZE);
    const py = Math.floor(this.player.y / TILE_SIZE);

    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
        if (this.fog[y][x] === 2) {
          this.fog[y][x] = 1;
        }
        if (Phaser.Math.Distance.Between(px, py, x, y) <= radius && this.tileLineOfSight(px, py, x, y)) {
          this.fog[y][x] = 2;
        }
      }
    }

    this.fogGraphics.clear();
    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
        const state = this.fog[y][x];
        if (state === 2) continue;
        const alpha = state === 1 ? 0.42 : 0.9;
        this.fogGraphics.fillStyle(0x000000, alpha);
        this.fogGraphics.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    this.updateObjectVisibility();
    this.drawMinimap();
  }

  private updateObjectVisibility(): void {
    const fogAt = (x: number, y: number): FogState => {
      const tx = Math.floor(x / TILE_SIZE);
      const ty = Math.floor(y / TILE_SIZE);
      return this.fog[ty]?.[tx] ?? 0;
    };

    this.chests.children.iterate((child) => {
      if (child) {
        const img = child as Phaser.Physics.Arcade.Image;
        img.setVisible(fogAt(img.x, img.y) > 0);
      }
      return true;
    });

    this.lootDrops.children.iterate((child) => {
      if (child) {
        const img = child as Phaser.Physics.Arcade.Image;
        img.setVisible(fogAt(img.x, img.y) > 0);
      }
      return true;
    });

    this.enemies.children.iterate((child) => {
      if (child) {
        const enemy = child as EnemySprite;
        enemy.setVisible(fogAt(enemy.x, enemy.y) === 2);
      }
      return true;
    });

    const stairsUnlocked = this.layout.bossRoomId === undefined || this.stairs.getData("unlocked");
    if (stairsUnlocked) {
      this.stairs.setVisible(fogAt(this.stairs.x, this.stairs.y) > 0);
    }
  }

  private drawMinimap(): void {
    const x0 = GAME_WIDTH - 126;
    const y0 = 44;
    const cell = 5;
    const precisionStep = this.run.player.stats.I >= 12 ? 1 : this.run.player.stats.I >= 8 ? 2 : 3;
    this.minimapGraphics.clear();
    this.minimapGraphics.fillStyle(0x0e1320, 0.85);
    this.minimapGraphics.fillRect(x0 - 8, y0 - 8, 118, 140);

    for (let y = 0; y < this.layout.height; y += precisionStep) {
      for (let x = 0; x < this.layout.width; x += precisionStep) {
        if (this.fog[y][x] === 0 || this.layout.tiles[y][x] !== TileType.Floor) continue;
        this.minimapGraphics.fillStyle(this.fog[y][x] === 2 ? 0xcdb4db : 0x6d597a, 1);
        const dotSize = precisionStep === 1 ? 2 : 2.5;
        this.minimapGraphics.fillRect(x0 + x * cell / 2.5, y0 + y * cell / 2.5, dotSize, dotSize);
      }
    }
  }

  private syncUi(): void {
    this.hpText.setText(`HP ${Math.ceil(this.run.player.hp)} / ${this.run.player.maxHp}`);
    this.xpText.setText(`LV ${this.run.player.level}  XP ${Math.floor(this.run.player.xp)} / ${this.run.player.nextXp}  SP ${this.run.player.statPoints}`);
    this.floorText.setText(`F ${this.run.floor}`);
    this.wandText.setText(`${this.run.player.wand.name}  ${this.run.player.wand.rarity}\n${this.run.player.wand.specialEffects.join(", ") || "No Special"}`);
    const statuses: string[] = [];
    if (this.run.player.burnMs > 0) statuses.push("Burn");
    if (this.run.player.iceMs > 0) statuses.push("Slow");
    if (this.run.player.thunderMs > 0) statuses.push("Stun");
    if (this.run.player.poisonMs > 0) statuses.push("Poison");
    if (this.run.player.hitInvulnMs > 0) statuses.push("Guard");
    if (this.layout.bossRoomId !== undefined) {
      const boss = (this.enemies.getChildren() as EnemySprite[]).find((enemy) => enemy.active && enemy.roomId === this.layout.bossRoomId);
      if (boss) {
        statuses.push(`Boss HP ${Math.ceil(boss.hp)}/${Math.ceil(boss.maxHp)} P${this.bossPhase}`);
      }
    }
    if (!this.player.visible) statuses.push("!VIS");
    if (!this.player.active) statuses.push("!ACT");
    if (this.isDying) statuses.push("DYING");
    this.statusText.setText(statuses.join("  ") || "Normal");
    this.statusText.setColor(
      this.run.player.thunderMs > 0 ? "#ffd166" :
      this.run.player.burnMs > 0 ? "#ff8c69" :
      this.run.player.poisonMs > 0 ? "#80ed99" :
      this.run.player.iceMs > 0 ? "#7bdff2" :
      "#9ad1ff"
    );
  }

  private isWalkable(x: number, y: number): boolean {
    return this.layout.tiles[y]?.[x] === TileType.Floor;
  }

  private findCurrentRoom(): Room | undefined {
    const tx = this.player.x / TILE_SIZE;
    const ty = this.player.y / TILE_SIZE;
    return this.layout.rooms.find(
      (room) =>
        tx >= room.x &&
        tx <= room.x + room.width &&
        ty >= room.y &&
        ty <= room.y + room.height
    );
  }

  private updateTransientUi(delta: number): void {
    if (this.roomTitleText) {
      this.roomTitleTimer -= delta;
      this.roomTitleText.setAlpha(Math.min(1, this.roomTitleTimer / 600));
      if (this.roomTitleTimer <= 0) {
        this.roomTitleText.destroy();
        this.roomTitleText = undefined;
      }
    }

    if (this.messageText.text) {
      this.messageText.setAlpha(Math.max(0, this.messageText.alpha - delta / 1800));
      if (this.messageText.alpha <= 0.05) {
        this.messageText.setText("");
        this.messageText.setAlpha(1);
      }
    }
  }

  private showMessage(message: string): void {
    this.messageText.setText(message);
    this.messageText.setAlpha(1);
  }

  private spawnWandDrop(x: number, y: number, wand: Wand): void {
    const loot = this.lootDrops.create(x, y, "wand-drop") as LootSprite;
    loot.lootType = "wand";
    loot.wand = wand;
    loot.setTint(attributeColor(wand.attribute));
    loot.setScale(1 + rarityValue(wand.rarity) * 0.06);
    loot.setDepth(2);
  }
}

function roomCenter(room: Room): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(room.x + room.width / 2, room.y + room.height / 2);
}

function attributeColor(attribute: Attribute): number {
  switch (attribute) {
    case "Fire":
      return 0xff6b35;
    case "Ice":
      return 0x7bdff2;
    case "Thunder":
      return 0xffd166;
    case "Poison":
      return 0x80ed99;
    default:
      return 0xf8f1ff;
  }
}

function bossName(floor: number): string {
  return BOSS_PROFILES[floor]?.name ?? "深層の守護者";
}

export function createGame(container: string): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    backgroundColor: "#09090d",
    physics: {
      default: "arcade",
      arcade: {
        debug: false
      }
    },
    scene: [BootScene, TitleScene, DungeonScene, LevelUpScene, BossIntroScene, StairsConfirmScene, WandCompareScene, PauseScene, GameOverScene, EndingScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    }
  });
}
