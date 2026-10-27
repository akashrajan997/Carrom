export type PieceType = 'WHITE' | 'BLACK' | 'QUEEN' | 'STRIKER';

export type GamePhase =
  | 'TITLE_SCREEN'
  | 'STRIKER_PLACEMENT'
  | 'AIMING'
  | 'SHOT_EXECUTION'
  | 'PIECES_MOVING'
  | 'SHOT_EVALUATION'
  | 'FOUL_RESOLUTION'
  | 'TURN_TRANSITION'
  | 'GAME_OVER';

export type GameMode = 'QUICK_MATCH' | 'VS_AI' | 'LOCAL_2P' | 'PRACTICE';

export type AIDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export type BoardThemeId =
  | 'CLASSIC_WOODEN'
  | 'ROYAL_WALNUT'
  | 'PRO_TOURNAMENT'
  | 'LUXURY_GOLD';

export type CameraPreset =
  | 'PERSPECTIVE_3Q'
  | 'TOP_DOWN'
  | 'PLAYER_POV'
  | 'FREE_ORBIT';

export type QueenStatus =
  | 'ON_BOARD'
  | 'PENDING_COVER_P1'
  | 'PENDING_COVER_P2'
  | 'COVERED_P1'
  | 'COVERED_P2';

export interface PhysicsConfig {
  /** Inner playable board half-width in world units (3.7 = 74cm standard ICF scale) */
  boardHalfSize: number;
  /** Frame width around the playable surface */
  frameWidth: number;
  /** Frame height above the playing surface */
  frameHeight: number;
  /** Radius of standard carrommen (white, black, queen) */
  coinRadius: number;
  /** Height/thickness of carrommen */
  coinHeight: number;
  /** Radius of the striker */
  strikerRadius: number;
  /** Height/thickness of the striker */
  strikerHeight: number;
  /** Radius of the 4 corner pockets */
  pocketRadius: number;
  /** Distance from board center to pocket center along X and Z */
  pocketOffset: number;
  /** Distance from board center to each player's baseline center */
  baselineZ: number;
  /** Half-length of the legal striker placement line */
  baselineHalfLength: number;
  /** Mass of a standard coin */
  coinMass: number;
  /** Mass of the striker (~2.7x coin mass) */
  strikerMass: number;
  /** Coin-to-coin restitution (bounciness) */
  coinRestitution: number;
  /** Striker-to-coin restitution */
  strikerRestitution: number;
  /** Board frame cushion restitution */
  wallRestitution: number;
  /** Sliding kinetic friction deceleration factor */
  surfaceFriction: number;
  /** Exponential velocity damping per second */
  velocityDamping: number;
  /** Minimum velocity threshold below which piece settles to 0 */
  stopVelocityThreshold: number;
  /** Maximum initial shot speed */
  maxShotSpeed: number;
  /** Minimum shot speed required to execute a shot */
  minShotSpeed: number;
  /** Fixed physics timestep in seconds (120Hz) */
  fixedTimeStep: number;
  /** Max physics substeps per frame to prevent spiral of death */
  maxSubSteps: number;
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  boardHalfSize: 3.7,
  frameWidth: 0.68,
  frameHeight: 0.28,
  coinRadius: 0.158,
  coinHeight: 0.082,
  strikerRadius: 0.208,
  strikerHeight: 0.105,
  pocketRadius: 0.248,
  pocketOffset: 3.43,
  baselineZ: 2.68,
  baselineHalfLength: 2.15,
  coinMass: 1.0,
  strikerMass: 2.75,
  coinRestitution: 0.88,
  strikerRestitution: 0.91,
  wallRestitution: 0.83,
  surfaceFriction: 2.15,
  velocityDamping: 0.985,
  stopVelocityThreshold: 0.035,
  maxShotSpeed: 16.5,
  minShotSpeed: 0.8,
  fixedTimeStep: 1 / 120,
  maxSubSteps: 10,
};

export interface BoardThemeSpec {
  id: BoardThemeId;
  name: string;
  subtitle: string;
  surfaceBg: string;
  surfaceGrainTint: string;
  frameColor: number;
  frameRoughness: number;
  frameMetalness: number;
  cornerAccentColor: number;
  cornerMetalness: number;
  cornerRoughness: number;
  markingPrimary: string;
  markingSecondary: string;
  markingAccent: string;
  pocketRimColor: number;
  whiteCoinBase: number;
  whiteCoinTrim: number;
  blackCoinBase: number;
  blackCoinTrim: number;
  queenBase: number;
  queenTrim: number;
  strikerBase: number;
  strikerAccent: number;
  roomFloorColor: number;
  ambientSkyColor: number;
  ambientGroundColor: number;
}

export const BOARD_THEMES: Record<BoardThemeId, BoardThemeSpec> = {
  CLASSIC_WOODEN: {
    id: 'CLASSIC_WOODEN',
    name: 'Classic Wooden',
    subtitle: 'Indian Rosewood & Birch Ply',
    surfaceBg: '#f3e5c8',
    surfaceGrainTint: '#e5d0a8',
    frameColor: 0x3d1e10,
    frameRoughness: 0.32,
    frameMetalness: 0.06,
    cornerAccentColor: 0xb8860b,
    cornerMetalness: 0.78,
    cornerRoughness: 0.26,
    markingPrimary: '#2a1810',
    markingSecondary: '#b91c1c',
    markingAccent: '#d97706',
    pocketRimColor: 0x9a6e27,
    whiteCoinBase: 0xf7eed7,
    whiteCoinTrim: 0xc9b286,
    blackCoinBase: 0x1e1b18,
    blackCoinTrim: 0x4a423b,
    queenBase: 0xb91c1c,
    queenTrim: 0xf59e0b,
    strikerBase: 0xfffbeb,
    strikerAccent: 0xb45309,
    roomFloorColor: 0x120d0a,
    ambientSkyColor: 0xfff5e6,
    ambientGroundColor: 0x2b1d14,
  },
  ROYAL_WALNUT: {
    id: 'ROYAL_WALNUT',
    name: 'Royal Walnut',
    subtitle: 'Burr Walnut & Aged Ivory',
    surfaceBg: '#ede0c9',
    surfaceGrainTint: '#dcc6a4',
    frameColor: 0x26160c,
    frameRoughness: 0.24,
    frameMetalness: 0.08,
    cornerAccentColor: 0xd4af37,
    cornerMetalness: 0.85,
    cornerRoughness: 0.2,
    markingPrimary: '#3e1f14',
    markingSecondary: '#881337',
    markingAccent: '#b45309',
    pocketRimColor: 0xb8923a,
    whiteCoinBase: 0xf5ebd6,
    whiteCoinTrim: 0xb89c6d,
    blackCoinBase: 0x171412,
    blackCoinTrim: 0x574c43,
    queenBase: 0x9f1239,
    queenTrim: 0xfbbf24,
    strikerBase: 0xfef3c7,
    strikerAccent: 0x9f1239,
    roomFloorColor: 0x0f0b09,
    ambientSkyColor: 0xffedd5,
    ambientGroundColor: 0x1f1610,
  },
  PRO_TOURNAMENT: {
    id: 'PRO_TOURNAMENT',
    name: 'Pro Tournament',
    subtitle: 'ICF Championship Satin Ebony',
    surfaceBg: '#f8eed9',
    surfaceGrainTint: '#ebdcbd',
    frameColor: 0x141416,
    frameRoughness: 0.22,
    frameMetalness: 0.12,
    cornerAccentColor: 0x94a3b8,
    cornerMetalness: 0.88,
    cornerRoughness: 0.2,
    markingPrimary: '#0f172a',
    markingSecondary: '#dc2626',
    markingAccent: '#0284c7',
    pocketRimColor: 0x64748b,
    whiteCoinBase: 0xfaf5e8,
    whiteCoinTrim: 0xd4c5a9,
    blackCoinBase: 0x111317,
    blackCoinTrim: 0x334155,
    queenBase: 0xdc2626,
    queenTrim: 0xfacc15,
    strikerBase: 0xf8fafc,
    strikerAccent: 0x0284c7,
    roomFloorColor: 0x090d14,
    ambientSkyColor: 0xf1f5f9,
    ambientGroundColor: 0x0f172a,
  },
  LUXURY_GOLD: {
    id: 'LUXURY_GOLD',
    name: 'Luxury Gold',
    subtitle: 'Imperial Mahogany & 24K Gold Leaf',
    surfaceBg: '#f6ead4',
    surfaceGrainTint: '#e8d4b0',
    frameColor: 0x421612,
    frameRoughness: 0.18,
    frameMetalness: 0.15,
    cornerAccentColor: 0xffd700,
    cornerMetalness: 0.94,
    cornerRoughness: 0.14,
    markingPrimary: '#451a03',
    markingSecondary: '#991b1b',
    markingAccent: '#d97706',
    pocketRimColor: 0xeab308,
    whiteCoinBase: 0xfdf8ed,
    whiteCoinTrim: 0xd9a036,
    blackCoinBase: 0x181311,
    blackCoinTrim: 0x856224,
    queenBase: 0xb91c1c,
    queenTrim: 0xffe066,
    strikerBase: 0xfffbeb,
    strikerAccent: 0xd97706,
    roomFloorColor: 0x140c08,
    ambientSkyColor: 0xfffbeb,
    ambientGroundColor: 0x29180e,
  },
};

export interface PersistentSettings {
  theme: BoardThemeId;
  cameraPreset: CameraPreset;
  aiDifficulty: AIDifficulty;
  soundVolume: number;
  muted: boolean;
  hapticsEnabled: boolean;
  showTrajectoryGuide: boolean;
  cinematicShots: boolean;
  stats: {
    matchesPlayed: number;
    matchesWon: number;
    coinsPocketed: number;
    queensCovered: number;
    highestScore: number;
  };
}

export const DEFAULT_SETTINGS: PersistentSettings = {
  theme: 'CLASSIC_WOODEN',
  cameraPreset: 'PERSPECTIVE_3Q',
  aiDifficulty: 'MEDIUM',
  soundVolume: 0.8,
  muted: false,
  hapticsEnabled: true,
  showTrajectoryGuide: true,
  cinematicShots: true,
  stats: {
    matchesPlayed: 0,
    matchesWon: 0,
    coinsPocketed: 0,
    queensCovered: 0,
    highestScore: 0,
  },
};
