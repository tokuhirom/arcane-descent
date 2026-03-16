export const TILE_SIZE = 24;
export const GRID_WIDTH = 54;
export const GRID_HEIGHT = 40;

export const TileType = {
  Floor: 0,
  Wall: 1,
  WallEdge: 2
} as const;

export type TileTypeValue = (typeof TileType)[keyof typeof TileType];
export type RoomKind = "start" | "normal" | "stairs" | "boss";
export type EnemyKind = "chaser" | "shooter" | "rusher" | "splitter" | "summoner" | "guardian" | "bomber" | "berserker" | "shielder" | "lancer";
export type Attribute = "Fire" | "Ice" | "Thunder" | "Poison" | "None";

export interface Room {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: RoomKind;
  neighbors: number[];
}

export interface EnemySpawn {
  x: number;
  y: number;
  roomId: number;
  kind: EnemyKind;
  elite: boolean;
}

export interface DungeonLayout {
  floor: number;
  width: number;
  height: number;
  tiles: TileTypeValue[][];
  rooms: Room[];
  start: Phaser.Math.Vector2;
  stairs: Phaser.Math.Vector2;
  spawns: EnemySpawn[];
  bossRoomId?: number;
}

interface Edge {
  a: number;
  b: number;
  distance: number;
}

let rngState = 0;

function seedRng(seed: number): void {
  rngState = seed | 0;
}

function nextRng(): number {
  rngState = (rngState * 1664525 + 1013904223) | 0;
  return (rngState >>> 0) / 4294967296;
}

function randomBetween(min: number, max: number): number {
  return min + Math.floor(nextRng() * (max - min + 1));
}

function centerOf(room: Room): Phaser.Math.Vector2 {
  return new Phaser.Math.Vector2(room.x + room.width / 2, room.y + room.height / 2);
}

function overlaps(a: Room, b: Room): boolean {
  return !(
    a.x + a.width + 1 < b.x ||
    b.x + b.width + 1 < a.x ||
    a.y + a.height + 1 < b.y ||
    b.y + b.height + 1 < a.y
  );
}

function carveRect(tiles: TileTypeValue[][], rx: number, ry: number, rw: number, rh: number): void {
  for (let y = ry; y < ry + rh; y += 1) {
    for (let x = rx; x < rx + rw; x += 1) {
      if (tiles[y]?.[x] !== undefined) {
        tiles[y][x] = TileType.Floor;
      }
    }
  }
}

function carveRoom(tiles: TileTypeValue[][], room: Room): void {
  carveRect(tiles, room.x, room.y, room.width, room.height);
}

function carveRoomVariant(tiles: TileTypeValue[][], room: Room): void {
  const roll = nextRng();

  if (roll < 0.4) {
    // Rectangle (40%)
    carveRect(tiles, room.x, room.y, room.width, room.height);
  } else if (roll < 0.6) {
    // L-shape (20%): main rect + smaller rect on one side
    const halfW = Math.floor(room.width / 2);
    const halfH = Math.floor(room.height / 2);
    const side = Math.floor(nextRng() * 4);
    if (side === 0) {
      // Main top-left, extension bottom-right
      carveRect(tiles, room.x, room.y, room.width, halfH);
      carveRect(tiles, room.x + halfW, room.y + halfH, room.width - halfW, room.height - halfH);
    } else if (side === 1) {
      // Main top-right, extension bottom-left
      carveRect(tiles, room.x, room.y, room.width, halfH);
      carveRect(tiles, room.x, room.y + halfH, halfW, room.height - halfH);
    } else if (side === 2) {
      // Main left, extension right-bottom
      carveRect(tiles, room.x, room.y, halfW, room.height);
      carveRect(tiles, room.x + halfW, room.y + halfH, room.width - halfW, room.height - halfH);
    } else {
      // Main right, extension left-top
      carveRect(tiles, room.x + halfW, room.y, room.width - halfW, room.height);
      carveRect(tiles, room.x, room.y, halfW, halfH);
    }
  } else if (roll < 0.75) {
    // Cross/Plus (15%): horizontal + vertical bars
    const barH = Math.max(2, Math.floor(room.height * 0.4));
    const barW = Math.max(2, Math.floor(room.width * 0.4));
    const offsetY = Math.floor((room.height - barH) / 2);
    const offsetX = Math.floor((room.width - barW) / 2);
    // Horizontal bar (full width, partial height)
    carveRect(tiles, room.x, room.y + offsetY, room.width, barH);
    // Vertical bar (partial width, full height)
    carveRect(tiles, room.x + offsetX, room.y, barW, room.height);
  } else if (roll < 0.9) {
    // Round/Ellipse (15%)
    const cx = room.x + room.width / 2;
    const cy = room.y + room.height / 2;
    const rx = room.width / 2;
    const ry = room.height / 2;
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1.0 && tiles[y]?.[x] !== undefined) {
          tiles[y][x] = TileType.Floor;
        }
      }
    }
  } else {
    // Irregular (10%): rectangle with 1-3 corners removed
    carveRect(tiles, room.x, room.y, room.width, room.height);
    const cornersToRemove = randomBetween(1, 3);
    const cornerSize = Math.max(2, Math.floor(Math.min(room.width, room.height) / 3));
    const corners = [0, 1, 2, 3];
    // Fisher-Yates partial shuffle
    for (let i = 0; i < cornersToRemove; i += 1) {
      const j = i + Math.floor(nextRng() * (corners.length - i));
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
    for (let i = 0; i < cornersToRemove; i += 1) {
      let cx: number, cy: number;
      if (corners[i] === 0) { cx = room.x; cy = room.y; }
      else if (corners[i] === 1) { cx = room.x + room.width - cornerSize; cy = room.y; }
      else if (corners[i] === 2) { cx = room.x; cy = room.y + room.height - cornerSize; }
      else { cx = room.x + room.width - cornerSize; cy = room.y + room.height - cornerSize; }
      for (let y = cy; y < cy + cornerSize; y += 1) {
        for (let x = cx; x < cx + cornerSize; x += 1) {
          if (tiles[y]?.[x] !== undefined) {
            tiles[y][x] = TileType.Wall;
          }
        }
      }
    }
  }
}

function addRoomPillars(tiles: TileTypeValue[][], room: Room): void {
  const area = room.width * room.height;
  if (area <= 80) return;
  const pillarCount = randomBetween(1, 3);
  const cx = Math.floor(room.x + room.width / 2);
  const cy = Math.floor(room.y + room.height / 2);
  for (let i = 0; i < pillarCount; i += 1) {
    // Pick a random interior position (not edge, not center)
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const px = randomBetween(room.x + 2, room.x + room.width - 3);
      const py = randomBetween(room.y + 2, room.y + room.height - 3);
      if (px === cx && py === cy) continue;
      if (tiles[py]?.[px] === TileType.Floor) {
        tiles[py][px] = TileType.Wall;
        break;
      }
    }
  }
}

function carveHLine(tiles: TileTypeValue[][], xFrom: number, xTo: number, y: number, halfWidth: number): void {
  for (let x = Math.min(xFrom, xTo); x <= Math.max(xFrom, xTo); x += 1) {
    for (let dy = -halfWidth; dy <= halfWidth; dy += 1) {
      if (tiles[y + dy]?.[x] !== undefined) {
        tiles[y + dy][x] = TileType.Floor;
      }
    }
  }
}

function carveVLine(tiles: TileTypeValue[][], yFrom: number, yTo: number, x: number, halfWidth: number): void {
  for (let y = Math.min(yFrom, yTo); y <= Math.max(yFrom, yTo); y += 1) {
    for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
      if (tiles[y]?.[x + dx] !== undefined) {
        tiles[y][x + dx] = TileType.Floor;
      }
    }
  }
}

function carveCorridor(
  tiles: TileTypeValue[][],
  from: Phaser.Math.Vector2,
  to: Phaser.Math.Vector2,
  wide = false
): void {
  const halfWidth = wide ? 1 : 0;
  const x1 = Math.floor(from.x);
  const y1 = Math.floor(from.y);
  const x2 = Math.floor(to.x);
  const y2 = Math.floor(to.y);

  // Random bend offset (±2 tiles)
  const bendOffsetX = randomBetween(-2, 2);
  const bendOffsetY = randomBetween(-2, 2);
  const verticalFirst = nextRng() < 0.5;

  if (verticalFirst) {
    const bendY = Phaser.Math.Clamp(Math.floor((y1 + y2) / 2) + bendOffsetY, 1, GRID_HEIGHT - 2);
    carveVLine(tiles, y1, bendY, x1, halfWidth);
    carveHLine(tiles, x1, x2, bendY, halfWidth);
    carveVLine(tiles, bendY, y2, x2, halfWidth);
  } else {
    const bendX = Phaser.Math.Clamp(Math.floor((x1 + x2) / 2) + bendOffsetX, 1, GRID_WIDTH - 2);
    carveHLine(tiles, x1, bendX, y1, halfWidth);
    carveVLine(tiles, y1, y2, bendX, halfWidth);
    carveHLine(tiles, bendX, x2, y2, halfWidth);
  }
}

function finalizeWalls(tiles: TileTypeValue[][]): void {
  for (let y = 1; y < tiles.length - 1; y += 1) {
    for (let x = 1; x < tiles[0].length - 1; x += 1) {
      if (tiles[y][x] !== TileType.Wall) {
        continue;
      }
      const touchingFloor =
        tiles[y - 1][x] === TileType.Floor ||
        tiles[y + 1][x] === TileType.Floor ||
        tiles[y][x - 1] === TileType.Floor ||
        tiles[y][x + 1] === TileType.Floor;
      if (touchingFloor) {
        tiles[y][x] = TileType.WallEdge;
      }
    }
  }
}

function buildEdges(rooms: Room[]): Edge[] {
  const edges: Edge[] = [];
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const distance = centerOf(rooms[i]).distance(centerOf(rooms[j]));
      edges.push({ a: rooms[i].id, b: rooms[j].id, distance });
    }
  }
  return edges.sort((a, b) => a.distance - b.distance);
}

function buildMst(rooms: Room[], edges: Edge[]): Edge[] {
  const connected = new Set<number>([rooms[0].id]);
  const mst: Edge[] = [];

  while (connected.size < rooms.length) {
    const next = edges.find((edge) => {
      const a = connected.has(edge.a);
      const b = connected.has(edge.b);
      return (a || b) && a !== b;
    });

    if (!next) {
      break;
    }

    mst.push(next);
    connected.add(next.a);
    connected.add(next.b);
  }

  return mst;
}

function pickEnemyKind(floor: number): EnemyKind {
  const pool: EnemyKind[] = ["chaser", "chaser", "shooter"];
  if (floor >= 11) pool.push("bomber", "bomber", "lancer");
  if (floor >= 21) pool.push("rusher", "guardian", "guardian", "berserker", "berserker", "guardian");
  if (floor >= 31) pool.push("shielder", "shielder", "lancer");
  if (floor >= 41) pool.push("splitter", "guardian");
  if (floor >= 61) pool.push("summoner", "bomber");
  return pool[randomBetween(0, pool.length - 1)];
}

function pickLeafRoom(roomIds: number[], rooms: Room[], exclude: Set<number>): number | undefined {
  const leaf = roomIds.find((id) => rooms[id].neighbors.length === 1 && !exclude.has(id));
  return leaf ?? roomIds.find((id) => !exclude.has(id));
}

function createBossFloor(tiles: TileTypeValue[][], floor: number): DungeonLayout {
  const rooms: Room[] = [
    { id: 0, x: 4, y: 12, width: 10, height: 10, kind: "start", neighbors: [1] },
    { id: 1, x: 22, y: 6, width: 24, height: 24, kind: "boss", neighbors: [0] }
  ];

  rooms.forEach((room) => carveRoom(tiles, room));
  carveCorridor(tiles, centerOf(rooms[0]), centerOf(rooms[1]));
  finalizeWalls(tiles);

  const bossCenter = centerOf(rooms[1]);
  return {
    floor,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    tiles,
    rooms,
    start: centerOf(rooms[0]),
    stairs: bossCenter,
    spawns: [
      {
        x: bossCenter.x,
        y: bossCenter.y,
        roomId: 1,
        kind: floor === 100 ? "summoner" : pickEnemyKind(floor),
        elite: true
      }
    ],
    bossRoomId: 1
  };
}

export function generateDungeon(floor: number, seed = 0): DungeonLayout {
  seedRng(seed + floor * 7919);
  const tiles = Array.from({ length: GRID_HEIGHT }, () =>
    Array.from({ length: GRID_WIDTH }, () => TileType.Wall)
  );

  if (floor % 10 === 0) {
    return createBossFloor(tiles, floor);
  }

  const roomCount = Phaser.Math.Clamp(5 + Math.floor(floor / 12), 5, 10);
  const rooms: Room[] = [];
  let attempts = 0;

  while (rooms.length < roomCount && attempts < 400) {
    attempts += 1;
    // Room size categories: small (30%), medium (50%), large (20%)
    const sizeRoll = nextRng();
    let width: number, height: number;
    if (sizeRoll < 0.3) {
      width = randomBetween(4, 6);
      height = randomBetween(4, 6);
    } else if (sizeRoll < 0.8) {
      width = randomBetween(7, 12);
      height = randomBetween(7, 10);
    } else {
      width = randomBetween(13, 18);
      height = randomBetween(10, 14);
    }
    const room: Room = {
      id: rooms.length,
      x: randomBetween(2, GRID_WIDTH - width - 3),
      y: randomBetween(2, GRID_HEIGHT - height - 3),
      width,
      height,
      kind: "normal",
      neighbors: []
    };

    if (rooms.some((candidate) => overlaps(room, candidate))) {
      continue;
    }

    rooms.push(room);
  }

  rooms.forEach((room) => carveRoomVariant(tiles, room));
  rooms.forEach((room) => addRoomPillars(tiles, room));
  const edges = buildEdges(rooms);
  const mst = buildMst(rooms, edges);
  const mstSet = new Set(mst);
  const extraEdges = edges.filter((edge) => !mstSet.has(edge)).slice(0, Math.max(1, Math.floor(edges.length * 0.18)));

  // MST edges get wide corridors, extra edges get narrow corridors
  mst.forEach((edge) => {
    rooms[edge.a].neighbors.push(edge.b);
    rooms[edge.b].neighbors.push(edge.a);
    carveCorridor(tiles, centerOf(rooms[edge.a]), centerOf(rooms[edge.b]), true);
  });
  extraEdges.filter(() => nextRng() < 0.55).forEach((edge) => {
    rooms[edge.a].neighbors.push(edge.b);
    rooms[edge.b].neighbors.push(edge.a);
    carveCorridor(tiles, centerOf(rooms[edge.a]), centerOf(rooms[edge.b]), false);
  });

  const startRoom = rooms[0];
  const startCenter = centerOf(startRoom);
  const stairsRoom = rooms
    .slice()
    .sort((a, b) => centerOf(b).distance(startCenter) - centerOf(a).distance(startCenter))[0];

  startRoom.kind = "start";
  stairsRoom.kind = floor % 10 === 0 ? "boss" : "stairs";

  const excluded = new Set<number>([startRoom.id, stairsRoom.id]);

  finalizeWalls(tiles);

  const spawns: EnemySpawn[] = [];
  let bossRoomId: number | undefined;

  rooms.forEach((room) => {
    if (room.kind === "start") {
      return;
    }

    if (room.kind === "boss") {
      bossRoomId = room.id;
      const center = centerOf(room);
      spawns.push({
        x: center.x,
        y: center.y,
        roomId: room.id,
        kind: floor === 100 ? "summoner" : pickEnemyKind(floor),
        elite: true
      });
      return;
    }

    const area = room.width * room.height;
    const floorScale = Math.min(1.3, 0.5 + floor * 0.05);
    const baseCount = Math.max(1, Math.floor(area / 22 * floorScale) + randomBetween(-1, 1));
    const count = room.kind === "stairs" ? Math.max(1, baseCount - 1) : baseCount;
    for (let i = 0; i < count; i += 1) {
      const margin = room.kind === "stairs" ? 2 : 1;
      spawns.push({
        x: randomBetween(room.x + margin, room.x + room.width - 1 - margin) + 0.5,
        y: randomBetween(room.y + margin, room.y + room.height - 1 - margin) + 0.5,
        roomId: room.id,
        kind: pickEnemyKind(floor),
        elite: floor >= 81 && Math.random() < 0.3
      });
    }
  });

  return {
    floor,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    tiles,
    rooms,
    start: startCenter,
    stairs: centerOf(stairsRoom),
    spawns,
    bossRoomId
  };
}
