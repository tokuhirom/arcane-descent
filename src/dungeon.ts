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

function carveRoom(tiles: TileTypeValue[][], room: Room): void {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      tiles[y][x] = TileType.Floor;
    }
  }
}

function carveCorridor(
  tiles: TileTypeValue[][],
  from: Phaser.Math.Vector2,
  to: Phaser.Math.Vector2
): void {
  const width = 1;
  const x1 = Math.floor(from.x);
  const y1 = Math.floor(from.y);
  const x2 = Math.floor(to.x);
  const y2 = Math.floor(to.y);

  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x += 1) {
    for (let dy = -width; dy <= width; dy += 1) {
      if (tiles[y1 + dy]?.[x] !== undefined) {
        tiles[y1 + dy][x] = TileType.Floor;
      }
    }
  }

  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 1) {
    for (let dx = -width; dx <= width; dx += 1) {
      if (tiles[y]?.[x2 + dx] !== undefined) {
        tiles[y][x2 + dx] = TileType.Floor;
      }
    }
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
    { id: 0, x: 4, y: 14, width: 10, height: 8, kind: "start", neighbors: [1] },
    { id: 1, x: 18, y: 12, width: 11, height: 12, kind: "normal", neighbors: [0, 2] },
    { id: 2, x: 33, y: 10, width: 19, height: 18, kind: "boss", neighbors: [1] }
  ];

  rooms.forEach((room) => carveRoom(tiles, room));
  carveCorridor(tiles, centerOf(rooms[0]), centerOf(rooms[1]));
  carveCorridor(tiles, centerOf(rooms[1]), centerOf(rooms[2]));
  finalizeWalls(tiles);

  const bossCenter = centerOf(rooms[2]);
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
        roomId: 2,
        kind: floor === 100 ? "summoner" : pickEnemyKind(floor),
        elite: true
      }
    ],
    bossRoomId: 2
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
    const width = randomBetween(5, 15);
    const height = randomBetween(5, 12);
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

  rooms.forEach((room) => carveRoom(tiles, room));
  const edges = buildEdges(rooms);
  const mst = buildMst(rooms, edges);
  const extraEdges = edges.filter((edge) => !mst.includes(edge)).slice(0, Math.max(1, Math.floor(edges.length * 0.18)));

  [...mst, ...extraEdges.filter(() => Math.random() < 0.55)].forEach((edge) => {
    rooms[edge.a].neighbors.push(edge.b);
    rooms[edge.b].neighbors.push(edge.a);
    carveCorridor(tiles, centerOf(rooms[edge.a]), centerOf(rooms[edge.b]));
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
