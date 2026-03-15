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

const GAME_WIDTH = 960;
const GAME_HEIGHT = 720;
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
      wand: createRandomWand(1, true)
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
    const panel = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 500, 180, 0x120f1d, 0.92)
      .setStrokeStyle(2, 0xf4d35e);
    makeText(this, panel.x - 185, panel.y - 40, `BOSS FLOOR ${data.floor}`, 22, "#f4d35e");
    makeText(this, panel.x - 185, panel.y + 5, bossName(data.floor), 34, "#ffffff");
    makeText(this, panel.x - 185, panel.y + 55, "Press SPACE / Tap to descend", 18, "#cdb4db");
    this.input.once("pointerdown", () => this.scene.stop());
    this.input.keyboard?.once("keydown-SPACE", () => this.scene.stop());
  }
}

class LevelUpScene extends Phaser.Scene {
  constructor() {
    super("LevelUpScene");
  }

  create(data: { stats: Record<StatKey, number>; onPick: (key: StatKey) => void }): void {
    const bg = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, 640, 420, 0x0f1020, 0.94)
      .setStrokeStyle(2, 0x9d4edd);
    makeText(this, bg.x - 250, bg.y - 160, "Level Up", 34, "#f8f1ff");
    makeText(this, bg.x - 250, bg.y - 120, "1つ選んで強化", 18, "#cdb4db");

    STAT_KEYS.forEach((key, index) => {
      const x = bg.x - 240 + (index % 2) * 280;
      const y = bg.y - 70 + Math.floor(index / 2) * 72;
      const button = this.add.rectangle(x + 110, y + 20, 220, 52, 0x241734, 1)
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
    makeText(this, 160, 180, "Arcane Descent", 42, "#f4d35e");
    makeText(this, 160, 250, "深淵の王は倒れ、迷宮は静寂を取り戻した。", 24, "#f8f1ff");
    makeText(this, 160, 300, "だが魔力の残響はまだ地下に満ちている。", 24, "#cdb4db");
    makeText(this, 160, 400, "Press R to descend again", 22, "#f8f1ff");
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
  private pauseButton!: Phaser.GameObjects.Text;
  private joystickBase?: Phaser.GameObjects.Arc;
  private joystickThumb?: Phaser.GameObjects.Arc;
  private joystickVector = new Phaser.Math.Vector2();
  private currentRoomId?: number;

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
    this.floorText = makeText(this, GAME_WIDTH - 170, 12, "", 20, "#fff2b2").setScrollFactor(0);
    this.wandText = makeText(this, 16, GAME_HEIGHT - 80, "", 16, "#f8f1ff").setScrollFactor(0);
    this.pauseButton = makeText(this, GAME_WIDTH - 70, GAME_HEIGHT - 60, "[II]", 24, "#f8f1ff")
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.pauseButton.on("pointerdown", () => {
      this.scene.isPaused() ? this.scene.resume() : this.scene.pause();
    });
    this.syncUi();
  }

  private createJoystick(): void {
    this.joystickBase = this.add.circle(92, GAME_HEIGHT - 88, 44, 0x3a254f, 0.4).setScrollFactor(0);
    this.joystickThumb = this.add.circle(92, GAME_HEIGHT - 88, 18, 0xcdb4db, 0.6).setScrollFactor(0);

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.x > 200 || pointer.y < GAME_HEIGHT - 200) {
        return;
      }
      this.updateJoystick(pointer);
    });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.isDown) {
        return;
      }
      this.updateJoystick(pointer);
    });
    this.input.on("pointerup", () => {
      this.joystickVector.set(0, 0);
      this.joystickThumb?.setPosition(92, GAME_HEIGHT - 88);
    });
  }

  private updateJoystick(pointer: Phaser.Input.Pointer): void {
    const center = new Phaser.Math.Vector2(92, GAME_HEIGHT - 88);
    const v = new Phaser.Math.Vector2(pointer.x - center.x, pointer.y - center.y);
    if (v.length() > 36) {
      v.setLength(36);
    }
    this.joystickVector.copy(v.scale(1 / 36));
    this.joystickThumb?.setPosition(center.x + v.x, center.y + v.y);
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
      enemy.roomId = spawn.roomId;
      enemy.kind = spawn.kind;
      enemy.elite = spawn.elite;
      enemy.activeRoom = false;
      enemy.fireCooldown = 0;
      enemy.summonCooldown = Phaser.Math.Between(1800, 3600);
      enemy.attribute = pick(ATTRIBUTES);
      enemy.weakness = pick(ATTRIBUTES);
      enemy.resistance = pick(ATTRIBUTES);
      enemy.maxHp = 18 + this.run.floor * 2 + (spawn.elite ? 24 : 0);
      enemy.hp = enemy.maxHp;
      enemy.speed = 40 + this.run.floor * 0.9 + (spawn.kind === "rusher" ? 20 : 0) + (spawn.elite ? 18 : 0);
      enemy.setDepth(3);
      enemy.setCircle(8);
      if (spawn.elite) {
        enemy.setScale(1.24);
        enemy.setTint(0xf4d35e);
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
      this.enemies.children.iterate((child) => {
        const enemy = child as EnemySprite | null;
        if (!enemy) return true;
        enemy.activeRoom = room !== undefined && enemy.roomId === room.id;
        return true;
      });
    }

    this.handlePlayerMovement();
    this.handleAutoFire(delta);
    this.updateEnemies(delta);
    this.updateFog();
    this.syncUi();
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

      if (!enemy.activeRoom) {
        enemy.setVelocity(0, 0);
        return true;
      }

      enemy.fireCooldown -= delta;
      enemy.summonCooldown -= delta;
      const distance = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.player.x, this.player.y);
      const direction = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y).normalize();

      if (enemy.kind === "chaser" || enemy.kind === "splitter" || enemy.kind === "summoner") {
        enemy.setVelocity(direction.x * enemy.speed, direction.y * enemy.speed);
      } else if (enemy.kind === "shooter") {
        const desired = distance > 180 ? 1 : distance < 120 ? -1 : 0;
        enemy.setVelocity(direction.x * enemy.speed * desired, direction.y * enemy.speed * desired);
        if (enemy.fireCooldown <= 0) {
          this.spawnEnemyProjectile(enemy);
          enemy.fireCooldown = 900;
        }
      } else if (enemy.kind === "rusher") {
        const speed = distance < 120 ? enemy.speed * 2.4 : enemy.speed * 0.7;
        enemy.setVelocity(direction.x * speed, direction.y * speed);
      }

      if (enemy.kind === "summoner" && enemy.summonCooldown <= 0) {
        this.spawnMinion(enemy);
        enemy.summonCooldown = 3200;
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
    projectile.damage = 5 + this.run.floor * 0.4;
    projectile.piercing = 1;
    projectile.attribute = enemy.attribute;
    projectile.specialEffects = [];
    projectile.chainHits = 0;
    projectile.lifetimeMs = 1400;
    projectile.setScale(0.75);
    projectile.setTint(attributeColor(enemy.attribute));
    this.physics.moveToObject(projectile, this.player, 220 + this.run.floor);
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
    if (projectile.attribute === "Poison") damage *= 1.05 + this.run.player.stats.A * 0.01;
    if (projectile.attribute === "Fire") damage += 2 + this.run.player.stats.A * 0.2;
    if (projectile.attribute === "Thunder" && Math.random() < 0.15) enemy.fireCooldown += 250;
    if (Math.random() < this.run.player.stats.T * 0.015) damage *= 1.7;

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
    if (enemy.kind === "splitter" && enemy.scaleX >= 1) {
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
    this.run.player.hp -= projectile.damage * (1 - this.run.player.stats.V * 0.01);
    projectile.destroy();
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
      return;
    }
    this.run.floor += 1;
    this.scene.restart(this.run);
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
    const x0 = GAME_WIDTH - 166;
    const y0 = 48;
    const cell = 5;
    this.minimapGraphics.clear();
    this.minimapGraphics.fillStyle(0x0e1320, 0.85);
    this.minimapGraphics.fillRect(x0 - 8, y0 - 8, 160, 120);

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
  const names: Record<number, string> = {
    10: "炎の魔獣",
    20: "氷の巨人",
    30: "雷の鳥",
    40: "毒の蜘蛛",
    50: "無属性の騎士",
    60: "炎氷の双子",
    70: "雷の魔導士",
    80: "毒の樹",
    90: "虚無の影",
    100: "深淵の王"
  };
  return names[floor] ?? "深層の守護者";
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
