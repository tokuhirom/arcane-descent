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

type FogState = 0 | 1 | 2;
type Rarity = "Common" | "Uncommon" | "Rare" | "Epic" | "Legendary";
type SpecialEffect = "Multishot" | "Homing" | "Explosion" | "Chain" | "Lifesteal";
type StatKey = "P" | "I" | "V" | "F" | "A" | "S" | "T";

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

interface PlayerState {
  hp: number;
  maxHp: number;
  xp: number;
  level: number;
  nextXp: number;
  statPoints: number;
  stats: Record<StatKey, number>;
  wand: Wand;
  burnMs: number;
  iceMs: number;
  thunderMs: number;
  poisonMs: number;
  defenseBreak: number;
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
  player: PlayerState;
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
const BASE_SPEED = 180;
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
      nextXp: 16,
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
      defenseBreak: 0
    }
  };
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

    g.fillStyle(0x9d4edd, 1);
    g.fillRect(0, 0, 20, 20);
    g.generateTexture("stairs", 20, 20);
    g.destroy();

    this.scene.start("DungeonScene", createStarterState());
  }
}

class BossIntroScene extends Phaser.Scene {
  constructor() {
    super("BossIntroScene");
  }

  create(data: { floor: number }): void {
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 420, 180, 0x120f1d, 0.92)
      .setStrokeStyle(2, 0xf4d35e);
    makeText(this, panel.x - 150, panel.y - 40, `BOSS FLOOR ${data.floor}`, 22, "#f4d35e");
    makeText(this, panel.x - 150, panel.y + 5, bossName(data.floor), 30, "#ffffff");
    makeText(this, panel.x - 150, panel.y + 55, "Press SPACE / Tap to descend", 18, "#cdb4db");
    this.input.once("pointerdown", () => this.scene.stop());
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.stop());
  }
}

class LevelUpScene extends Phaser.Scene {
  constructor() {
    super("LevelUpScene");
  }

  create(data: { stats: Record<StatKey, number>; onPick: (key: StatKey) => void }): void {
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 470, 560, 0x0f1020, 0.94)
      .setStrokeStyle(2, 0x9d4edd);
    makeText(this, bg.x - 190, bg.y - 230, "Level Up", 34, "#f8f1ff");
    makeText(this, bg.x - 190, bg.y - 190, "1つ選んで強化", 18, "#cdb4db");

    STAT_KEYS.forEach((key, index) => {
      const x = bg.x - 170;
      const y = bg.y - 140 + index * 58;
      const button = this.add.rectangle(x + 160, y + 20, 320, 44, 0x241734, 1)
        .setInteractive({ useHandCursor: true })
        .setStrokeStyle(1, 0xf4d35e);
      makeText(this, x + 16, y + 6, `${key}  ${STAT_LABELS[key]}`, 20, "#fff2b2");
      makeText(this, x + 16, y + 28, `現在値 ${data.stats[key]} / 20`, 15, "#f8f1ff");
      button.on("pointerdown", () => {
        data.onPick(key);
        this.scene.stop();
      });
    });
  }
}

class GameOverScene extends Phaser.Scene {
  constructor() {
    super("GameOverScene");
  }

  create(): void {
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x05050b, 0.92);
    makeText(this, bg.x - 120, bg.y - 30, "Game Over", 42, "#ff6b6b");
    makeText(this, bg.x - 180, bg.y + 24, "Press R to restart", 22, "#f8f1ff");
    this.input.keyboard?.once("keydown-R", () => {
      this.scene.stop();
      this.scene.stop("DungeonScene");
      this.scene.start("BootScene");
    });
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
    makeText(this, 48, 450, "Press R to descend again", 22, "#f8f1ff");
    this.input.keyboard?.once("keydown-R", () => {
      this.scene.stop();
      this.scene.stop("DungeonScene");
      this.scene.start("BootScene");
    });
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
  private joystickBase?: Phaser.GameObjects.Arc;
  private joystickThumb?: Phaser.GameObjects.Arc;
  private joystickVector = new Phaser.Math.Vector2();
  private joystickPointerId?: number;
  private currentRoomId?: number;
  private roomTitleText?: Phaser.GameObjects.Text;
  private roomTitleTimer = 0;
  private passiveTickMs = 0;
  private bossPhase = 1;

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
    this.physics.world.setBounds(0, 0, this.layout.width * TILE_SIZE, this.layout.height * TILE_SIZE);

    this.physics.add.overlap(this.projectiles, this.enemies, this.onProjectileHitsEnemy as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback, undefined, this);
    this.physics.add.overlap(this.enemyProjectiles, this.player, this.onEnemyProjectileHitsPlayer as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.onPlayerTouchesEnemy as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback, undefined, this);
    this.physics.add.overlap(this.player, this.chests, this.onLootChest as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback, undefined, this);
    this.physics.add.overlap(this.player, this.stairs, this.onReachStairs as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback, undefined, this);

    if (this.run.floor % 10 === 0) {
      this.scene.launch("BossIntroScene", { floor: this.run.floor });
    }

    this.input.keyboard?.on("keydown-P", () => {
      this.scene.isPaused() ? this.scene.resume() : this.scene.pause();
    });
  }

  private createUi(): void {
    this.hpText = makeText(this, 16, 12, "", 20).setScrollFactor(0);
    this.xpText = makeText(this, 16, 40, "", 16, "#d9d9ff").setScrollFactor(0);
    this.floorText = makeText(this, GAME_WIDTH - 80, 12, "", 20, "#fff2b2").setScrollFactor(0);
    this.wandText = makeText(this, 16, GAME_HEIGHT - 180, "", 16, "#f8f1ff").setScrollFactor(0);
    this.statusText = makeText(this, 16, 66, "", 16, "#9ad1ff").setScrollFactor(0);
    this.messageText = makeText(this, 24, GAME_HEIGHT - 34, "", 18, "#fff2b2").setScrollFactor(0);
    this.pauseButton = makeText(this, GAME_WIDTH - 64, GAME_HEIGHT - 90, "[II]", 24, "#f8f1ff")
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.pauseButton.on("pointerdown", () => {
      this.scene.isPaused() ? this.scene.resume() : this.scene.pause();
    });
    this.syncUi();
  }

  private createJoystick(): void {
    this.joystickBase = this.add.circle(92, GAME_HEIGHT - 110, 44, 0x3a254f, 0.4).setScrollFactor(0);
    this.joystickThumb = this.add.circle(92, GAME_HEIGHT - 110, 18, 0xcdb4db, 0.6).setScrollFactor(0);
    const center = new Phaser.Math.Vector2(92, GAME_HEIGHT - 110);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.joystickPointerId !== undefined) {
        return;
      }
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, center.x, center.y) > 88) {
        return;
      }
      this.joystickPointerId = pointer.id;
      this.updateJoystick(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown || pointer.id !== this.joystickPointerId) {
        return;
      }
      this.updateJoystick(pointer);
    });
    this.input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.id !== this.joystickPointerId) {
        return;
      }
      this.joystickPointerId = undefined;
      this.joystickVector.set(0, 0);
      this.joystickThumb?.setPosition(center.x, center.y);
    });
  }

  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const center = new Phaser.Math.Vector2(92, GAME_HEIGHT - 110);
    const offset = new Phaser.Math.Vector2(pointer.x - center.x, pointer.y - center.y);
    if (offset.length() > 36) {
      offset.setLength(36);
    }
    this.joystickVector.copy(offset).scale(1 / 36);
    this.joystickThumb?.setPosition(center.x + offset.x, center.y + offset.y);
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
    });

    this.layout.rooms
      .filter((room) => room.kind === "treasure")
      .forEach((room) => {
        const center = roomCenter(room);
        this.chests.create(center.x * TILE_SIZE, center.y * TILE_SIZE, "chest");
      });
  }

  update(_: number, delta: number): void {
    const room = this.findCurrentRoom();
    if (room?.id !== this.currentRoomId) {
      this.currentRoomId = room?.id;
      this.showRoomTitle(room);
      this.enemies.children.iterate((child) => {
        const enemy = child as EnemySprite | null;
        if (!enemy) return true;
        enemy.activeRoom = room !== undefined && enemy.roomId === room.id;
        return true;
      });
    }

    this.handlePlayerMovement();
    this.handleAutoFire(delta);
    this.updatePlayerStatus(delta);
    this.updateEnemies(delta);
    this.updateFog();
    this.syncUi();
    this.updateTransientUi(delta);
  }

  private showRoomTitle(room?: Room): void {
    if (!room) {
      return;
    }
    const labels: Record<Room["kind"], string> = {
      start: "Start Room",
      normal: "Normal Room",
      treasure: "Treasure Room",
      stairs: "Stairs Room",
      boss: `Boss Room: ${bossName(this.run.floor)}`
    };
    this.roomTitleText?.destroy();
    this.roomTitleText = makeText(this, GAME_WIDTH / 2 - 160, 100, labels[room.kind], 22, "#fff2b2")
      .setScrollFactor(0)
      .setDepth(10);
    this.roomTitleTimer = 1800;
  }

  private handlePlayerMovement(): void {
    const movement = new Phaser.Math.Vector2(0, 0);
    if (this.cursors.left?.isDown || this.wasd.A?.isDown) movement.x -= 1;
    if (this.cursors.right?.isDown || this.wasd.D?.isDown) movement.x += 1;
    if (this.cursors.up?.isDown || this.wasd.W?.isDown) movement.y -= 1;
    if (this.cursors.down?.isDown || this.wasd.S?.isDown) movement.y += 1;
    if (movement.lengthSq() === 0 && this.joystickVector.lengthSq() > 0) {
      movement.copy(this.joystickVector);
    }
    if (movement.lengthSq() > 0) {
      movement.normalize().scale(BASE_SPEED + this.run.player.stats.S * 6);
    }
    this.player.setVelocity(movement.x, movement.y);
    this.resolveWallCollision(this.player);
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
    this.fireTimer = Math.max(120, this.run.player.wand.stats.fireRate - this.run.player.stats.S * 6);
  }

  private spawnPlayerProjectile(targetX: number, targetY: number, effects: SpecialEffect[]): void {
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
      this.physics.velocityFromRotation(
        baseAngle + spread,
        this.run.player.wand.stats.projectileSpeed,
        (projectile.body as Phaser.Physics.Arcade.Body).velocity
      );
    }
  }

  private updateEnemies(delta: number): void {
    this.enemies.children.iterate((child) => {
      const enemy = child as EnemySprite | null;
      if (!enemy || !enemy.active) {
        return true;
      }

      enemy.touchCooldown -= delta;
      this.tickEnemyStatus(enemy, delta);

      if (!enemy.activeRoom) {
        enemy.setVelocity(0, 0);
        return true;
      }

      if (enemy.stunMs > 0) {
        enemy.setVelocity(0, 0);
        return true;
      }

      enemy.fireCooldown -= delta;
      enemy.summonCooldown -= delta;
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const direction = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();
      const speedMultiplier = enemy.slowMs > 0 ? 0.55 : 1;
      const bossPhaseMultiplier = enemy.bossTier > 0 ? this.getBossPhaseMultiplier(enemy) : 1;

      if (enemy.kind === "chaser" || enemy.kind === "splitter" || enemy.kind === "summoner") {
        enemy.setVelocity(direction.x * enemy.speed * speedMultiplier * bossPhaseMultiplier, direction.y * enemy.speed * speedMultiplier * bossPhaseMultiplier);
      } else if (enemy.kind === "shooter") {
        const desired = distance > 180 ? 1 : distance < 120 ? -1 : 0;
        enemy.setVelocity(direction.x * enemy.speed * desired * speedMultiplier, direction.y * enemy.speed * desired * speedMultiplier);
        if (enemy.fireCooldown <= 0) {
          this.spawnEnemyProjectile(enemy);
          enemy.fireCooldown = Math.max(260, (enemy.bossTier > 0 ? BOSS_PROFILES[this.run.floor].fireCooldown : 900) - this.bossPhase * 70);
        }
      } else if (enemy.kind === "rusher") {
        const speed = distance < 120 ? enemy.speed * 2.4 : enemy.speed * 0.7;
        enemy.setVelocity(direction.x * speed * speedMultiplier * bossPhaseMultiplier, direction.y * speed * speedMultiplier * bossPhaseMultiplier);
      }

      if (enemy.kind === "summoner" && enemy.summonCooldown <= 0) {
        const summonCount = enemy.bossTier >= 4 ? 2 : 1;
        for (let i = 0; i < summonCount; i += 1) {
          this.spawnMinion(enemy);
        }
        enemy.summonCooldown = Math.max(1100, 3200 - enemy.bossTier * 180);
      }

      this.resolveWallCollision(enemy);
      return true;
    });

    this.projectiles.children.iterate((child) => {
      const projectile = child as ProjectileSprite | null;
      if (!projectile || !projectile.active) return true;
      projectile.lifetimeMs -= delta;
      if (projectile.lifetimeMs <= 0) {
        projectile.destroy();
      }
      return true;
    });

    this.enemyProjectiles.children.iterate((child) => {
      const projectile = child as ProjectileSprite | null;
      if (!projectile || !projectile.active) return true;
      projectile.lifetimeMs -= delta;
      if (projectile.lifetimeMs <= 0) {
        projectile.destroy();
      }
      return true;
    });
  }

  private spawnEnemyProjectile(enemy: EnemySprite): void {
    const projectile = this.enemyProjectiles.create(enemy.x, enemy.y, "projectile") as ProjectileSprite;
    projectile.owner = "enemy";
    projectile.damage = 5 + this.run.floor * 0.4 + enemy.bossTier * 2;
    projectile.piercing = 1;
    projectile.attribute = enemy.attribute;
    projectile.specialEffects = [];
    projectile.chainHits = 0;
    projectile.lifetimeMs = 1400;
    projectile.setScale(0.75);
    projectile.setTint(attributeColor(enemy.attribute));
    this.physics.moveToObject(projectile, this.player, 220 + this.run.floor + enemy.bossTier * 18);
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
    minion.setCircle(8);
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
    projectile.piercing -= 1;

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
    const gainedXp = 5 + Math.floor(this.run.floor / 2) + Math.floor(this.run.player.stats.A * 0.6);
    this.run.player.xp += gainedXp;
    if (Math.random() < 0.08 + this.run.player.stats.F * 0.01) {
      this.run.player.wand = createRandomWand(this.run.floor + this.run.player.stats.F);
    }
    if (enemy.roomId === this.layout.bossRoomId) {
      this.stairs.setVisible(true);
      if (this.run.floor === 100) {
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

  private checkLevelUp(): void {
    while (this.run.player.xp >= this.run.player.nextXp) {
      this.run.player.xp -= this.run.player.nextXp;
      this.run.player.level += 1;
      this.run.player.nextXp = Math.floor(this.run.player.nextXp * 1.25);
      this.run.player.statPoints += 1;
    }

    if (this.run.player.statPoints > 0 && !this.scene.isActive("LevelUpScene")) {
      this.scene.launch("LevelUpScene", {
        stats: this.run.player.stats,
        onPick: (key: StatKey) => {
          this.run.player.stats[key] = clampStat(this.run.player.stats[key] + 1);
          this.run.player.statPoints -= 1;
          if (key === "V") {
            this.run.player.maxHp += 5;
            this.run.player.hp = Math.min(this.run.player.maxHp, this.run.player.hp + 5);
          }
        }
      });
    }
  }

  private onEnemyProjectileHitsPlayer(projectileObj: Phaser.GameObjects.GameObject): void {
    const projectile = projectileObj as ProjectileSprite;
    if (!projectile.active) {
      return;
    }
    this.damagePlayer(projectile.damage, projectile.attribute);
    projectile.destroy();
  }

  private onPlayerTouchesEnemy(_: Phaser.GameObjects.GameObject, enemyObj: Phaser.GameObjects.GameObject): void {
    const enemy = enemyObj as EnemySprite;
    if (!enemy.active || enemy.touchCooldown > 0) {
      return;
    }
    enemy.touchCooldown = 700;
    this.damagePlayer(6 + this.run.floor * 0.25 + enemy.bossTier * 2, enemy.attribute);
    const knockback = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize().scale(200);
    this.player.setVelocity(knockback.x, knockback.y);
  }

  private damagePlayer(amount: number, attribute: Attribute): void {
    const vitalityReduction = 1 - this.run.player.stats.V * 0.01;
    const poisonPenalty = 1 + this.run.player.defenseBreak;
    this.run.player.hp -= amount * vitalityReduction * poisonPenalty;
    if (attribute === "Fire") {
      this.run.player.burnMs = Math.max(this.run.player.burnMs, 2500);
    } else if (attribute === "Ice") {
      this.run.player.iceMs = Math.max(this.run.player.iceMs, 2000);
    } else if (attribute === "Thunder") {
      this.run.player.thunderMs = Math.max(this.run.player.thunderMs, 240);
    } else if (attribute === "Poison") {
      this.run.player.poisonMs = Math.max(this.run.player.poisonMs, 3200);
      this.run.player.defenseBreak = Math.min(0.35, this.run.player.defenseBreak + 0.07);
    }
    if (this.run.player.hp <= 0) {
      this.scene.launch("GameOverScene");
      this.scene.pause();
    }
  }

  private onLootChest(_: Phaser.GameObjects.GameObject, chestObj: Phaser.GameObjects.GameObject): void {
    const chest = chestObj as Phaser.Physics.Arcade.Image;
    this.run.player.wand = createRandomWand(this.run.floor + 4 + this.run.player.stats.F);
    this.run.player.hp = Math.min(this.run.player.maxHp, this.run.player.hp + 8);
    chest.destroy();
  }

  private onReachStairs(): void {
    if (!this.stairs.visible) {
      this.showMessage("ボスを倒すまで階段は開かない");
      return;
    }
    this.run.floor += 1;
    this.scene.restart(this.run);
  }

  private updatePlayerStatus(delta: number): void {
    if (this.run.player.thunderMs > 0) {
      this.run.player.thunderMs -= delta;
      this.player.setVelocity(0, 0);
      return;
    }

    this.passiveTickMs += delta;
    this.run.player.burnMs = Math.max(0, this.run.player.burnMs - delta);
    this.run.player.iceMs = Math.max(0, this.run.player.iceMs - delta);
    this.run.player.poisonMs = Math.max(0, this.run.player.poisonMs - delta);

    if (this.run.player.poisonMs <= 0) {
      this.run.player.defenseBreak = Math.max(0, this.run.player.defenseBreak - 0.005);
    }

    if (this.passiveTickMs >= 500) {
      this.passiveTickMs = 0;
      if (this.run.player.burnMs > 0) {
        this.run.player.hp -= 2.5;
      }
      if (this.run.player.poisonMs > 0) {
        this.run.player.hp -= 1.2;
      }
      const regen = 0.18 + this.run.player.stats.V * 0.03;
      if (this.run.player.burnMs <= 0) {
        this.run.player.hp = Math.min(this.run.player.maxHp, this.run.player.hp + regen);
      }
      if (this.run.player.hp <= 0) {
        this.scene.launch("GameOverScene");
        this.scene.pause();
      }
    }
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

  private updateFog(): void {
    const radius = 4 + Math.floor(this.run.player.stats.I / 2);
    const px = Math.floor(this.player.x / TILE_SIZE);
    const py = Math.floor(this.player.y / TILE_SIZE);

    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
        if (this.fog[y][x] === 2) {
          this.fog[y][x] = 1;
        }
        if (Phaser.Math.Distance.Between(px, py, x, y) <= radius) {
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

    this.drawMinimap();
  }

  private drawMinimap(): void {
    const x0 = GAME_WIDTH - 126;
    const y0 = 44;
    const cell = 5;
    this.minimapGraphics.clear();
    this.minimapGraphics.fillStyle(0x0e1320, 0.85);
    this.minimapGraphics.fillRect(x0 - 8, y0 - 8, 118, 140);

    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
        if (this.fog[y][x] === 0 || this.layout.tiles[y][x] !== TileType.Floor) continue;
        this.minimapGraphics.fillStyle(this.fog[y][x] === 2 ? 0xcdb4db : 0x6d597a, 1);
        this.minimapGraphics.fillRect(x0 + x * cell / 2.5, y0 + y * cell / 2.5, 2, 2);
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
    if (this.layout.bossRoomId !== undefined) {
      const boss = (this.enemies.getChildren() as EnemySprite[]).find((enemy) => enemy.active && enemy.roomId === this.layout.bossRoomId);
      if (boss) {
        statuses.push(`Boss HP ${Math.ceil(boss.hp)}/${Math.ceil(boss.maxHp)} P${this.bossPhase}`);
      }
    }
    this.statusText.setText(statuses.join("  ") || "Status: Normal");
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
    scene: [BootScene, DungeonScene, LevelUpScene, BossIntroScene, GameOverScene, EndingScene],
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    }
  });
}
