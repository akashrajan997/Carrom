import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Volume2,
  VolumeX,
  RotateCcw,
  Camera,
  Settings,
  Pause,
  Play,
  Trophy,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Code2,
  Sliders,
  Target,
  Zap,
  Sparkles,
  Check,
  Copy,
  X,
  Crosshair,
} from 'lucide-react';
import {
  AIDifficulty,
  BOARD_THEMES,
  BoardThemeId,
  CameraPreset,
  DEFAULT_PHYSICS_CONFIG,
  DEFAULT_SETTINGS,
  GameMode,
  GamePhase,
  PersistentSettings,
  PieceType,
} from './game/GameConfig';
import {
  CarromPhysicsEngine,
  CollisionEvent,
  PhysicsPiece,
} from './game/CarromPhysics';
import { CarromRulesEngine, MatchState } from './game/CarromRulesEngine';
import { CarromAI } from './game/CarromAI';
import { MeshFactory } from './game/MeshFactory';
import { soundManager } from './game/SoundManager';
import { ANDROID_KOTLIN_SOURCES } from './game/AndroidSourceExport';

const STORAGE_KEY = 'carrom_royale_3d_settings_v1';

// Module-scope reusable math objects to ensure zero GC inside the 60fps loop
const _camTargetPos = new THREE.Vector3();
const _camLookAtTarget = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3(0, 0, 0);
const _rayPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _rayHitPoint = new THREE.Vector3();
const _ndcMouse = new THREE.Vector2();

interface ParticleBurst {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

export default function App() {
  // Persistent settings
  const [settings, setSettings] = useState<PersistentSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          stats: { ...DEFAULT_SETTINGS.stats, ...(parsed.stats || {}) },
        };
      }
    } catch {
      // Ignore storage error
    }
    return DEFAULT_SETTINGS;
  });

  // React UI state
  const [phase, setPhase] = useState<GamePhase>('TITLE_SCREEN');
  const [gameMode, setGameMode] = useState<GameMode>('VS_AI');
  const [matchState, setMatchState] = useState<MatchState>(() =>
    CarromRulesEngine.createInitialMatchState('VS_AI')
  );
  const [strikerNormX, setStrikerNormX] = useState<number>(0); // -1 .. +1 along baseline
  const [aimAngleDeg, setAimAngleDeg] = useState<number>(0); // -80 .. +80 relative to forward
  const [powerSettingPct, setPowerSettingPct] = useState<number>(68); // 15 .. 100 persistent controller bar power
  const [pullPowerPct, setPullPowerPct] = useState<number>(0); // >0 when slingshot pulling on board
  const [isPlacementValid, setIsPlacementValid] = useState<boolean>(true);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showKotlinModal, setShowKotlinModal] = useState<boolean>(false);
  const [selectedKotlinIdx, setSelectedKotlinIdx] = useState<number>(0);
  const [copiedKotlin, setCopiedKotlin] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  // Mutable refs accessed by the 60fps Three.js loop without causing re-renders
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const topHeaderRef = useRef<HTMLDivElement | null>(null);
  const bottomDockRef = useRef<HTMLDivElement | null>(null);

  const physicsRef = useRef<CarromPhysicsEngine>(
    new CarromPhysicsEngine(DEFAULT_PHYSICS_CONFIG)
  );
  const piecesRef = useRef<PhysicsPiece[]>(
    physicsRef.current.createInitialRack(1)
  );
  const pocketedThisShotRef = useRef<PieceType[]>([]);
  const phaseRef = useRef<GamePhase>('TITLE_SCREEN');
  const matchStateRef = useRef<MatchState>(matchState);
  const settingsRef = useRef<PersistentSettings>(settings);
  const isPausedRef = useRef<boolean>(false);
  const dockCollapsedRef = useRef<boolean>(false);

  // Aiming & Drag state refs
  const aimStateRef = useRef<{
    dragMode: 'NONE' | 'MOVE_STRIKER' | 'BOARD_AIM' | 'SLINGSHOT_PULL';
    dirX: number;
    dirZ: number;
    powerRatio: number;
  }>({
    dragMode: 'NONE',
    dirX: 0,
    dirZ: -1,
    powerRatio: 0.68,
  });

  // Camera shake & cinematic focus refs
  const cameraShakeRef = useRef<number>(0);
  const cinematicFocusRef = useRef<{
    active: boolean;
    x: number;
    z: number;
    timer: number;
  }>({ active: false, x: 0, z: 0, timer: 0 });

  // Three.js scene object refs for theme rebuilding
  const sceneObjectsRef = useRef<{
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    controls: OrbitControls | null;
    boardGroup: THREE.Group | null;
    pieceMeshes: Map<string, THREE.Group>;
    hemiLight: THREE.HemisphereLight | null;
    maxAnisotropy: number;
    requestRebuildTheme: ((themeId: BoardThemeId) => void) | null;
    updateViewportFraming: (() => void) | null;
  }>({
    scene: null,
    camera: null,
    controls: null,
    boardGroup: null,
    pieceMeshes: new Map(),
    hemiLight: null,
    maxAnisotropy: 4,
    requestRebuildTheme: null,
    updateViewportFraming: null,
  });

  // Sync settings to localStorage & SoundManager
  useEffect(() => {
    settingsRef.current = settings;
    soundManager.setConfig(
      settings.soundVolume,
      settings.muted,
      settings.hapticsEnabled
    );
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore quota errors
    }
  }, [settings]);

  useEffect(() => {
    phaseRef.current = phase;
    sceneObjectsRef.current.updateViewportFraming?.();
  }, [phase]);

  useEffect(() => {
    matchStateRef.current = matchState;
  }, [matchState]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    dockCollapsedRef.current = dockCollapsed;
    window.setTimeout(() => {
      sceneObjectsRef.current.updateViewportFraming?.();
    }, 20);
  }, [dockCollapsed]);

  // Helper to position striker on the active player's baseline and validate
  const placeStrikerForTurn = useCallback(
    (turnPlayer: 1 | 2, preferredNormX = 0) => {
      const physics = physicsRef.current;
      const pieces = piecesRef.current;
      const striker = pieces.find((p) => p.type === 'STRIKER');
      if (!striker) return;

      const baselineZ =
        turnPlayer === 1 ? physics.config.baselineZ : -physics.config.baselineZ;
      const rawX = preferredNormX * physics.config.baselineHalfLength;
      const validX = physics.findValidStrikerX(pieces, rawX, baselineZ);

      striker.active = true;
      striker.pocketingProgress = 0;
      striker.x = validX;
      striker.z = baselineZ;
      striker.vx = 0;
      striker.vz = 0;

      const norm = validX / physics.config.baselineHalfLength;
      setStrikerNormX(norm);
      setIsPlacementValid(
        physics.isStrikerPositionValid(pieces, validX, baselineZ)
      );

      // Default forward aim direction toward center of board
      const forwardZ = turnPlayer === 1 ? -1 : 1;
      aimStateRef.current.dirX = 0;
      aimStateRef.current.dirZ = forwardZ;
      setAimAngleDeg(0);
      setPullPowerPct(0);
    },
    []
  );

  // Start or restart a match in the selected mode
  const startNewMatch = useCallback(
    (mode: GameMode) => {
      const physics = physicsRef.current;
      physics.resetAccumulator();
      const freshPieces = physics.createInitialRack(1);
      piecesRef.current = freshPieces;
      pocketedThisShotRef.current = [];

      const initialMatch = CarromRulesEngine.createInitialMatchState(mode);
      setGameMode(mode);
      setMatchState(initialMatch);
      matchStateRef.current = initialMatch;

      placeStrikerForTurn(1, 0);
      setIsPaused(false);
      setPhase('STRIKER_PLACEMENT');
      phaseRef.current = 'STRIKER_PLACEMENT';
    },
    [placeStrikerForTurn]
  );

  // Execute a shot with current striker direction & speed
  const executeStrike = useCallback((dirX: number, dirZ: number, speed: number) => {
    const physics = physicsRef.current;
    const pieces = piecesRef.current;
    const striker = pieces.find((p) => p.type === 'STRIKER');
    if (!striker || !striker.active) return;

    if (!physics.isStrikerPositionValid(pieces, striker.x, striker.z)) {
      return;
    }

    const len = Math.hypot(dirX, dirZ) || 1;
    const ndx = dirX / len;
    const ndz = dirZ / len;
    const clampedSpeed = Math.max(
      physics.config.minShotSpeed,
      Math.min(physics.config.maxShotSpeed, speed)
    );

    striker.vx = ndx * clampedSpeed;
    striker.vz = ndz * clampedSpeed;
    pocketedThisShotRef.current = [];
    physics.resetAccumulator();

    soundManager.playStrikeRelease(clampedSpeed / physics.config.maxShotSpeed);

    setPullPowerPct(0);
    setPhase('PIECES_MOVING');
    phaseRef.current = 'PIECES_MOVING';
  }, []);

  // Trigger AI turn when it is Player 2's turn in VS_AI or QUICK_MATCH
  useEffect(() => {
    if (
      (phase === 'STRIKER_PLACEMENT' || phase === 'TURN_TRANSITION') &&
      matchState.currentTurn === 2 &&
      (gameMode === 'VS_AI' || gameMode === 'QUICK_MATCH') &&
      !matchState.winner
    ) {
      const timer = window.setTimeout(() => {
        if (
          phaseRef.current !== 'STRIKER_PLACEMENT' &&
          phaseRef.current !== 'TURN_TRANSITION'
        ) {
          return;
        }
        const decision = CarromAI.computeBestShot(
          piecesRef.current,
          physicsRef.current,
          settingsRef.current.aiDifficulty,
          matchStateRef.current.queenStatus
        );

        // Position striker at AI's chosen X on North baseline
        const striker = piecesRef.current.find((p) => p.type === 'STRIKER');
        if (striker) {
          striker.active = true;
          striker.pocketingProgress = 0;
          striker.x = decision.strikerX;
          striker.z = -physicsRef.current.config.baselineZ;
          striker.vx = 0;
          striker.vz = 0;
          setStrikerNormX(
            decision.strikerX / physicsRef.current.config.baselineHalfLength
          );
        }

        aimStateRef.current.dirX = decision.dirX;
        aimStateRef.current.dirZ = decision.dirZ;

        setMatchState((prev) => ({
          ...prev,
          lastBannerText: `AI (${settingsRef.current.aiDifficulty}): ${decision.targetDescription}`,
        }));

        // Brief telegraph pause so player sees AI's aim line before firing
        window.setTimeout(() => {
          if (phaseRef.current === 'TITLE_SCREEN') return;
          executeStrike(decision.dirX, decision.dirZ, decision.speed);
        }, 580);
      }, 600);

      return () => window.clearTimeout(timer);
    }
  }, [phase, matchState.currentTurn, matchState.winner, gameMode, executeStrike]);

  // Update striker X from bottom Move slider/buttons or direct baseline drag
  const handleStrikerSlide = useCallback((normX: number) => {
    if (
      phaseRef.current !== 'STRIKER_PLACEMENT' &&
      phaseRef.current !== 'AIMING'
    ) {
      return;
    }
    const currentTurn = matchStateRef.current.currentTurn;
    const isAITurn =
      currentTurn === 2 &&
      (matchStateRef.current.mode === 'VS_AI' ||
        matchStateRef.current.mode === 'QUICK_MATCH');
    if (isAITurn) return;

    const physics = physicsRef.current;
    const clampedNorm = Math.max(-1, Math.min(1, normX));
    const baselineZ =
      currentTurn === 1 ? physics.config.baselineZ : -physics.config.baselineZ;
    const targetX = clampedNorm * physics.config.baselineHalfLength;

    const striker = piecesRef.current.find((p) => p.type === 'STRIKER');
    if (striker) {
      striker.x = targetX;
      striker.z = baselineZ;
    }

    const valid = physics.isStrikerPositionValid(
      piecesRef.current,
      targetX,
      baselineZ
    );
    setStrikerNormX(clampedNorm);
    setIsPlacementValid(valid);
  }, []);

  // Update aim angle from Aim slider/buttons
  const handleAimAngleChange = useCallback((deg: number) => {
    const clamped = Math.max(-82, Math.min(82, deg));
    setAimAngleDeg(clamped);
    const currentTurn = matchStateRef.current.currentTurn;
    const rad = (clamped * Math.PI) / 180;
    if (currentTurn === 1) {
      // Shooting North (-Z)
      aimStateRef.current.dirX = Math.sin(rad);
      aimStateRef.current.dirZ = -Math.cos(rad);
    } else {
      // Shooting South (+Z)
      aimStateRef.current.dirX = Math.sin(rad);
      aimStateRef.current.dirZ = Math.cos(rad);
    }
  }, []);

  // Update shot power from Power slider/buttons
  const handlePowerChange = useCallback((pct: number) => {
    const clamped = Math.max(15, Math.min(100, Math.round(pct)));
    setPowerSettingPct(clamped);
    aimStateRef.current.powerRatio = clamped / 100;
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'h' || e.key === 'H') {
        setDockCollapsed((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        if (aimStateRef.current.dragMode !== 'NONE') {
          aimStateRef.current.dragMode = 'NONE';
          setPullPowerPct(0);
          setPhase('STRIKER_PLACEMENT');
          return;
        }
        if (phaseRef.current !== 'TITLE_SCREEN') {
          setIsPaused((prev) => !prev);
        }
        return;
      }
      if (phaseRef.current === 'TITLE_SCREEN') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startNewMatch(gameMode);
        }
        return;
      }

      const canControl =
        (phaseRef.current === 'STRIKER_PLACEMENT' ||
          phaseRef.current === 'AIMING') &&
        !(
          matchStateRef.current.currentTurn === 2 &&
          (matchStateRef.current.mode === 'VS_AI' ||
            matchStateRef.current.mode === 'QUICK_MATCH')
        );

      if (!canControl) return;

      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        handleStrikerSlide(strikerNormX - 0.05);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        handleStrikerSlide(strikerNormX + 0.05);
      } else if (e.key === 'q' || e.key === 'Q') {
        handleAimAngleChange(aimAngleDeg - 2);
      } else if (e.key === 'e' || e.key === 'E') {
        handleAimAngleChange(aimAngleDeg + 2);
      } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        handlePowerChange(powerSettingPct + 5);
      } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
        handlePowerChange(powerSettingPct - 5);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const speed =
          aimStateRef.current.powerRatio *
          physicsRef.current.config.maxShotSpeed;
        executeStrike(
          aimStateRef.current.dirX,
          aimStateRef.current.dirZ,
          speed
        );
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    strikerNormX,
    aimAngleDeg,
    powerSettingPct,
    gameMode,
    startNewMatch,
    handleStrikerSlide,
    handleAimAngleChange,
    handlePowerChange,
    executeStrike,
  ]);

  // Rebuild 3D board & piece materials when theme changes
  useEffect(() => {
    sceneObjectsRef.current.requestRebuildTheme?.(settings.theme);
  }, [settings.theme]);

  // Toggle OrbitControls based on cameraPreset
  useEffect(() => {
    const controls = sceneObjectsRef.current.controls;
    if (controls) {
      controls.enabled = settings.cameraPreset === 'FREE_ORBIT';
    }
    sceneObjectsRef.current.updateViewportFraming?.();
  }, [settings.cameraPreset]);

  // Initialize Three.js WebGL scene once on mount
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    // 1. Software WebGL detection guard per Three.js skill
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    // 2. Scene & Studio RoomEnvironment Reflections
    const scene = new THREE.Scene();
    const initialTheme = BOARD_THEMES[settingsRef.current.theme];
    scene.background = new THREE.Color(initialTheme.roomFloorColor);
    scene.fog = new THREE.FogExp2(initialTheme.roomFloorColor, 0.022);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    ).texture;
    pmremGenerator.dispose();

    // 3. Camera & OrbitControls
    const camera = new THREE.PerspectiveCamera(
      38,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      100
    );
    camera.position.set(0, 10, 4);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.46;
    controls.minDistance = 4.2;
    controls.maxDistance = 28;
    controls.enabled = settingsRef.current.cameraPreset === 'FREE_ORBIT';

    // Dynamic viewport framing state so the board fills the maximum possible screen area
    // between the compact top header and the bottom shooting controller bar
    let dynamicCamDist = 11.5;
    let dynamicCamPolarRad = 0.38;

    const updateViewportFraming = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      const aspect = w / h;
      const isPortrait = aspect < 0.95;

      camera.aspect = aspect;

      if (phaseRef.current === 'TITLE_SCREEN') {
        camera.clearViewOffset();
        camera.updateProjectionMatrix();
        return;
      }

      // Measure actual DOM heights of Top Header and Bottom Controller Bar
      const topH = topHeaderRef.current?.offsetHeight ?? (isPortrait ? 58 : 54);
      const botH = dockCollapsedRef.current
        ? 32
        : bottomDockRef.current?.offsetHeight ?? (isPortrait ? 168 : 112);

      // Shift optical center vertically so (0,0,0) sits exactly in the center of the open stage
      // between `topH` and `h - botH`
      const stageOffsetPx = (botH - topH) * 0.5;
      camera.setViewOffset(w, h, 0, stageOffsetPx, w, h);
      camera.updateProjectionMatrix();

      // Calculate exact distance required so outer board (8.76 x 8.76 world units)
      // fills ~96% of available stage width and ~94% of available stage height without cropping
      const vFovRad = (camera.fov * Math.PI) / 180;
      const tanV = Math.tan(vFovRad * 0.5);
      const tanH = tanV * aspect;

      const preset = settingsRef.current.cameraPreset;
      // On portrait mobile, use a crisper overhead/elevated angle so the square board
      // isn't foreshortened into a thin horizontal strip
      if (preset === 'TOP_DOWN') {
        dynamicCamPolarRad = 0.03;
      } else if (preset === 'PLAYER_POV') {
        dynamicCamPolarRad = isPortrait ? 0.48 : 0.56;
      } else {
        // PERSPECTIVE_3Q: ~15° tilt on mobile portrait for maximum square board coverage, ~27° on wide desktop
        dynamicCamPolarRad = isPortrait ? 0.26 : 0.46;
      }

      // Outer Carrom board width = 2 * (3.7 + 0.68) = 8.76 units.
      // Use 8.92 units on mobile so the board hugs the screen edges cleanly with all 4 corners inside.
      const boardSpanW = isPortrait ? 8.92 : 9.25;
      const distForWidth = (boardSpanW * 0.5) / Math.max(0.05, tanH);

      const availableStageH = Math.max(180, h - topH - botH - (isPortrait ? 8 : 20));
      const stageHeightFraction = availableStageH / h;

      // Account for perspective depth foreshortening & frame height
      const effectiveBoardSpanH =
        boardSpanW * Math.cos(dynamicCamPolarRad * 0.55) +
        Math.sin(dynamicCamPolarRad) * 0.85;
      const distForHeight =
        (effectiveBoardSpanH * 0.5) /
        Math.max(0.05, tanV * stageHeightFraction);

      dynamicCamDist = Math.max(distForWidth, distForHeight);
    };

    // 4. Balanced 3-Point Studio Lighting Rig
    const hemiLight = new THREE.HemisphereLight(
      initialTheme.ambientSkyColor,
      initialTheme.ambientGroundColor,
      0.68
    );
    hemiLight.position.set(0, 15, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff6e5, 1.55);
    keyLight.position.set(4.5, 11.5, 5.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    const d = 5.4;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 26;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.48);
    fillLight.position.set(-6, 7, -4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfef3c7, 0.38);
    rimLight.position.set(0, 6, -8);
    scene.add(rimLight);

    // 5. Build 3D Board & Pieces for the active theme
    const pieceMeshes = new Map<string, THREE.Group>();
    let boardGroup: THREE.Group | null = null;

    const buildThemeVisuals = (themeId: BoardThemeId) => {
      const themeSpec = BOARD_THEMES[themeId];
      scene.background = new THREE.Color(themeSpec.roomFloorColor);
      scene.fog = new THREE.FogExp2(themeSpec.roomFloorColor, 0.022);
      hemiLight.color.setHex(themeSpec.ambientSkyColor);
      hemiLight.groundColor.setHex(themeSpec.ambientGroundColor);

      if (boardGroup) {
        scene.remove(boardGroup);
      }
      boardGroup = MeshFactory.createCarromBoardGroup(
        themeId,
        physicsRef.current.config,
        maxAnisotropy
      );
      scene.add(boardGroup);

      // Rebuild piece meshes
      pieceMeshes.forEach((grp) => scene.remove(grp));
      pieceMeshes.clear();

      for (const p of piecesRef.current) {
        const meshGrp =
          p.type === 'STRIKER'
            ? MeshFactory.createStrikerGroup(themeId, physicsRef.current.config)
            : MeshFactory.createCoinGroup(
                p.type,
                themeId,
                physicsRef.current.config
              );
        meshGrp.position.set(p.x, 0, p.z);
        scene.add(meshGrp);
        pieceMeshes.set(p.id, meshGrp);
      }
    };

    buildThemeVisuals(settingsRef.current.theme);
    updateViewportFraming();

    // 6. Build 3D Aiming & Trajectory Guide Visuals
    const aimGroup = new THREE.Group();
    scene.add(aimGroup);

    const primaryLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(0, 0.06, -2),
    ]);
    const primaryLineMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95,
    });
    const primaryAimLine = new THREE.Line(primaryLineGeo, primaryLineMat);
    aimGroup.add(primaryAimLine);

    const deflectLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(0, 0.06, -1),
    ]);
    const deflectLineMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.9,
    });
    const deflectAimLine = new THREE.Line(deflectLineGeo, deflectLineMat);
    aimGroup.add(deflectAimLine);

    const reboundLineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.06, 0),
      new THREE.Vector3(0, 0.06, -1),
    ]);
    const reboundLineMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
    });
    const reboundAimLine = new THREE.Line(reboundLineGeo, reboundLineMat);
    aimGroup.add(reboundAimLine);

    const ghostRingGeo = new THREE.RingGeometry(
      physicsRef.current.config.strikerRadius * 0.84,
      physicsRef.current.config.strikerRadius * 1.06,
      32
    );
    ghostRingGeo.rotateX(-Math.PI / 2);
    const ghostRingMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    });
    const ghostRingMesh = new THREE.Mesh(ghostRingGeo, ghostRingMat);
    ghostRingMesh.position.y = 0.035;
    aimGroup.add(ghostRingMesh);

    const strikerHaloGeo = new THREE.RingGeometry(
      physicsRef.current.config.strikerRadius * 1.15,
      physicsRef.current.config.strikerRadius * 1.38,
      36
    );
    strikerHaloGeo.rotateX(-Math.PI / 2);
    const strikerHaloMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const strikerHaloMesh = new THREE.Mesh(strikerHaloGeo, strikerHaloMat);
    strikerHaloMesh.position.y = 0.025;
    scene.add(strikerHaloMesh);

    // 7. Pooled 3D Particle System for collisions & pocket celebrations
    const particlePool: ParticleBurst[] = [];
    const partGeo = new THREE.OctahedronGeometry(0.038, 0);
    for (let i = 0; i < 28; i++) {
      const partMat = new THREE.MeshBasicMaterial({
        color: 0xfbbf24,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(partGeo, partMat);
      mesh.visible = false;
      scene.add(mesh);
      particlePool.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 0.4,
      });
    }

    const spawnParticles = (
      x: number,
      z: number,
      colorHex: number,
      count: number,
      speedScale = 1
    ) => {
      let spawned = 0;
      for (let i = 0; i < particlePool.length && spawned < count; i++) {
        const p = particlePool[i];
        if (p.life <= 0) {
          p.mesh.visible = true;
          p.mesh.position.set(x, 0.08, z);
          (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
          const angle = Math.random() * Math.PI * 2;
          const spd = (0.8 + Math.random() * 2.2) * speedScale;
          p.vx = Math.cos(angle) * spd;
          p.vy = 1.4 + Math.random() * 2.0;
          p.vz = Math.sin(angle) * spd;
          p.maxLife = 0.32 + Math.random() * 0.25;
          p.life = p.maxLife;
          spawned++;
        }
      }
    };

    sceneObjectsRef.current = {
      scene,
      camera,
      controls,
      boardGroup,
      pieceMeshes,
      hemiLight,
      maxAnisotropy,
      requestRebuildTheme: buildThemeVisuals,
      updateViewportFraming,
    };

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // 8. Touch & Pointer Raycasting on the 3D Board:
    // - Dragging along the baseline moves the striker horizontally.
    // - Dragging anywhere on the board aims the shot line toward your touch point without firing accidentally!
    // - Pulling backward directly from the striker behind the baseline allows optional slingshot pull-and-release.
    const getBoardPointFromEvent = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _ndcMouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _ndcMouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(_ndcMouse, camera);
      const hit = raycaster.ray.intersectPlane(_rayPlane, _rayHitPoint);
      return hit ? { x: _rayHitPoint.x, z: _rayHitPoint.z } : null;
    };

    const updateAimTowardsBoardPoint = (
      strikerX: number,
      strikerZ: number,
      targetX: number,
      targetZ: number,
      currentTurn: 1 | 2
    ) => {
      const forwardSignZ = currentTurn === 1 ? -1 : 1;
      let dx = targetX - strikerX;
      let dz = targetZ - strikerZ;

      // If the user touches behind the baseline, invert vector so aim always points into the board
      if ((currentTurn === 1 && dz > 0.05) || (currentTurn === 2 && dz < -0.05)) {
        dx = -dx;
        dz = -dz;
      }

      const len = Math.hypot(dx, dz);
      if (len < 0.05) return;

      const ndx = dx / len;
      const ndz = dz / len;
      const rawAngleRad = Math.atan2(ndx, ndz * forwardSignZ);
      const clampedDeg = Math.max(
        -82,
        Math.min(82, Math.round((rawAngleRad * 180) / Math.PI))
      );
      const clampedRad = (clampedDeg * Math.PI) / 180;

      aimStateRef.current.dirX = Math.sin(clampedRad);
      aimStateRef.current.dirZ =
        currentTurn === 1 ? -Math.cos(clampedRad) : Math.cos(clampedRad);
      setAimAngleDeg(clampedDeg);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (settingsRef.current.cameraPreset === 'FREE_ORBIT') return;
      if (isPausedRef.current) return;
      if (
        phaseRef.current !== 'STRIKER_PLACEMENT' &&
        phaseRef.current !== 'AIMING'
      ) {
        return;
      }

      const mState = matchStateRef.current;
      const isAITurn =
        mState.currentTurn === 2 &&
        (mState.mode === 'VS_AI' || mState.mode === 'QUICK_MATCH');
      if (isAITurn) return;

      const pt = getBoardPointFromEvent(e.clientX, e.clientY);
      if (!pt) return;

      const striker = piecesRef.current.find((p) => p.type === 'STRIKER');
      if (!striker) return;

      const distToStriker = Math.hypot(pt.x - striker.x, pt.z - striker.z);
      const baselineZ =
        mState.currentTurn === 1
          ? physicsRef.current.config.baselineZ
          : -physicsRef.current.config.baselineZ;

      // 1. Touching directly on the striker: start slingshot pull or slide
      if (distToStriker < physicsRef.current.config.strikerRadius * 2.2) {
        aimStateRef.current.dragMode = 'SLINGSHOT_PULL';
        setPhase('AIMING');
        phaseRef.current = 'AIMING';
      } else if (
        Math.abs(pt.z - baselineZ) < 0.45 &&
        Math.abs(pt.x) <= physicsRef.current.config.baselineHalfLength + 0.35
      ) {
        // 2. Touching along the player's baseline: slide striker horizontally
        aimStateRef.current.dragMode = 'MOVE_STRIKER';
        const normX = pt.x / physicsRef.current.config.baselineHalfLength;
        handleStrikerSlide(normX);
      } else if (
        Math.abs(pt.x) <= physicsRef.current.config.boardHalfSize + 0.4 &&
        Math.abs(pt.z) <= physicsRef.current.config.boardHalfSize + 0.4
      ) {
        // 3. Touching/dragging on the playing surface: aim toward touch point (no accidental shot on release!)
        aimStateRef.current.dragMode = 'BOARD_AIM';
        updateAimTowardsBoardPoint(
          striker.x,
          striker.z,
          pt.x,
          pt.z,
          mState.currentTurn
        );
        setPhase('AIMING');
        phaseRef.current = 'AIMING';
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (aimStateRef.current.dragMode === 'NONE') return;

      const pt = getBoardPointFromEvent(e.clientX, e.clientY);
      if (!pt) return;

      const striker = piecesRef.current.find((p) => p.type === 'STRIKER');
      if (!striker) return;
      const currentTurn = matchStateRef.current.currentTurn;

      if (aimStateRef.current.dragMode === 'MOVE_STRIKER') {
        const normX = pt.x / physicsRef.current.config.baselineHalfLength;
        handleStrikerSlide(normX);
        return;
      }

      if (aimStateRef.current.dragMode === 'BOARD_AIM') {
        updateAimTowardsBoardPoint(
          striker.x,
          striker.z,
          pt.x,
          pt.z,
          currentTurn
        );
        return;
      }

      if (aimStateRef.current.dragMode === 'SLINGSHOT_PULL') {
        const dx = pt.x - striker.x;
        const dz = pt.z - striker.z;
        const pullDist = Math.hypot(dx, dz);

        // If user slides horizontally along the baseline near the striker, reposition striker
        const isBehindBaseline =
          (currentTurn === 1 && dz > 0.16) || (currentTurn === 2 && dz < -0.16);

        if (!isBehindBaseline && Math.abs(dz) < 0.32) {
          const normX = pt.x / physicsRef.current.config.baselineHalfLength;
          handleStrikerSlide(normX);
          setPullPowerPct(0);
          return;
        }

        if (pullDist < 0.16) {
          setPullPowerPct(0);
          return;
        }

        updateAimTowardsBoardPoint(
          striker.x,
          striker.z,
          pt.x,
          pt.z,
          currentTurn
        );

        if (isBehindBaseline) {
          const ratio = Math.min(1, Math.max(0.15, pullDist / 1.65));
          aimStateRef.current.powerRatio = ratio;
          const pct = Math.round(ratio * 100);
          setPullPowerPct(pct);
          setPowerSettingPct(pct);
        } else {
          // Dragged forward onto the board -> switch to non-firing precision board aim!
          aimStateRef.current.dragMode = 'BOARD_AIM';
          setPullPowerPct(0);
        }
      }
    };

    const onPointerUp = () => {
      const mode = aimStateRef.current.dragMode;
      aimStateRef.current.dragMode = 'NONE';

      if (mode === 'SLINGSHOT_PULL') {
        setPullPowerPct((currentPull) => {
          if (currentPull >= 18) {
            const speed =
              (currentPull / 100) * physicsRef.current.config.maxShotSpeed;
            executeStrike(
              aimStateRef.current.dirX,
              aimStateRef.current.dirZ,
              speed
            );
          }
          return 0;
        });
      }
    };

    const canvasEl = renderer.domElement;
    canvasEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // 9. Main 60FPS Animation & Physics Loop with Software-WebGL Guard
    let frameId = 0;
    let lastTime = performance.now();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      const now = performance.now();
      const rawDt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      const elapsedSec = now * 0.001;

      if (!isPausedRef.current) {
        // Step physics when pieces are moving
        if (phaseRef.current === 'PIECES_MOVING') {
          const physics = physicsRef.current;
          const pieces = piecesRef.current;

          physics.update(pieces, rawDt, (ev: CollisionEvent) => {
            if (ev.type === 'PIECE_PIECE') {
              soundManager.playCollision(ev.speed, ev.involvesStriker);
              if (ev.speed > 5.5) {
                cameraShakeRef.current = Math.min(
                  0.14,
                  (ev.speed / 16) * 0.1
                );
                spawnParticles(
                  ev.x,
                  ev.z,
                  ev.involvesStriker ? 0xfbbf24 : 0xfef3c7,
                  6,
                  0.85
                );
              }
            } else if (ev.type === 'CUSHION') {
              soundManager.playCushionHit(ev.speed);
            } else if (ev.type === 'POCKET' && ev.pieceType) {
              pocketedThisShotRef.current.push(ev.pieceType);
              const isQueen = ev.pieceType === 'QUEEN';
              const isFoul = ev.pieceType === 'STRIKER';
              soundManager.playPocketDrop(isQueen, isFoul);
              spawnParticles(
                ev.x,
                ev.z,
                isQueen ? 0xef4444 : isFoul ? 0xf97316 : 0x34d399,
                14,
                1.25
              );

              if (isQueen && settingsRef.current.cinematicShots) {
                cinematicFocusRef.current = {
                  active: true,
                  x: ev.x * 0.35,
                  z: ev.z * 0.35,
                  timer: 0.95,
                };
              }
            }
          });

          // Check if all pieces have come to rest
          if (!physics.arePiecesMoving(pieces)) {
            const evalRes = CarromRulesEngine.evaluateShot(
              matchStateRef.current,
              pocketedThisShotRef.current,
              pieces,
              physics
            );
            setMatchState(evalRes.nextState);
            matchStateRef.current = evalRes.nextState;

            if (evalRes.nextState.winner) {
              soundManager.playVictory();
              setPhase('GAME_OVER');
              phaseRef.current = 'GAME_OVER';

              setSettings((prev) => ({
                ...prev,
                stats: {
                  matchesPlayed: prev.stats.matchesPlayed + 1,
                  matchesWon:
                    evalRes.nextState.winner === 1
                      ? prev.stats.matchesWon + 1
                      : prev.stats.matchesWon,
                  coinsPocketed:
                    prev.stats.coinsPocketed + evalRes.nextState.whitePocketed,
                  queensCovered:
                    evalRes.nextState.queenStatus === 'COVERED_P1'
                      ? prev.stats.queensCovered + 1
                      : prev.stats.queensCovered,
                  highestScore: Math.max(
                    prev.stats.highestScore,
                    evalRes.nextState.p1Score
                  ),
                },
              }));
            } else {
              placeStrikerForTurn(evalRes.nextState.currentTurn, 0);
              setPhase('STRIKER_PLACEMENT');
              phaseRef.current = 'STRIKER_PLACEMENT';
            }
          }
        }

        // Sync 3D piece meshes with 2D physics board coordinates
        for (const p of piecesRef.current) {
          let meshGrp = pieceMeshes.get(p.id);
          if (!meshGrp) {
            meshGrp =
              p.type === 'STRIKER'
                ? MeshFactory.createStrikerGroup(
                    settingsRef.current.theme,
                    physicsRef.current.config
                  )
                : MeshFactory.createCoinGroup(
                    p.type,
                    settingsRef.current.theme,
                    physicsRef.current.config
                  );
            scene.add(meshGrp);
            pieceMeshes.set(p.id, meshGrp);
          }

          if (!p.active && p.pocketingProgress >= 1) {
            meshGrp.visible = false;
          } else {
            meshGrp.visible = true;
            const yDrop =
              p.pocketingProgress > 0 ? -p.pocketingProgress * 0.24 : 0;
            const scaleShrink =
              p.pocketingProgress > 0 ? 1 - p.pocketingProgress * 0.25 : 1;
            meshGrp.position.set(p.x, yDrop, p.z);
            meshGrp.rotation.y = p.rotation;
            meshGrp.scale.setScalar(scaleShrink);
          }
        }

        // Update 3D Aiming & Trajectory Guide visibility and geometry
        const striker = piecesRef.current.find((p) => p.type === 'STRIKER');
        const showAim =
          striker &&
          striker.active &&
          (phaseRef.current === 'STRIKER_PLACEMENT' ||
            phaseRef.current === 'AIMING');

        if (showAim && striker) {
          const validPos = physicsRef.current.isStrikerPositionValid(
            piecesRef.current,
            striker.x,
            striker.z
          );
          strikerHaloMesh.visible = true;
          strikerHaloMesh.position.set(striker.x, 0.02, striker.z);
          strikerHaloMat.color.setHex(validPos ? 0x34d399 : 0xef4444);

          if (settingsRef.current.showTrajectoryGuide && validPos) {
            aimGroup.visible = true;
            const pred = physicsRef.current.predictTrajectory(
              piecesRef.current,
              striker.x,
              striker.z,
              aimStateRef.current.dirX,
              aimStateRef.current.dirZ
            );

            const pArr = primaryAimLine.geometry.attributes.position
              .array as Float32Array;
            pArr[0] = pred.startX;
            pArr[1] = 0.055;
            pArr[2] = pred.startZ;
            pArr[3] = pred.endX;
            pArr[4] = 0.055;
            pArr[5] = pred.endZ;
            primaryAimLine.geometry.attributes.position.needsUpdate = true;

            ghostRingMesh.position.set(pred.endX, 0.035, pred.endZ);

            if (
              pred.targetDeflectX !== null &&
              pred.targetDeflectZ !== null &&
              pred.hitPieceId
            ) {
              const hitCoin = piecesRef.current.find(
                (c) => c.id === pred.hitPieceId
              );
              if (hitCoin) {
                deflectAimLine.visible = true;
                const dArr = deflectAimLine.geometry.attributes.position
                  .array as Float32Array;
                dArr[0] = hitCoin.x;
                dArr[1] = 0.06;
                dArr[2] = hitCoin.z;
                dArr[3] = pred.targetDeflectX;
                dArr[4] = 0.06;
                dArr[5] = pred.targetDeflectZ;
                deflectAimLine.geometry.attributes.position.needsUpdate = true;
              }
            } else {
              deflectAimLine.visible = false;
            }

            if (pred.strikerReboundX !== null && pred.strikerReboundZ !== null) {
              reboundAimLine.visible = true;
              const rArr = reboundAimLine.geometry.attributes.position
                .array as Float32Array;
              rArr[0] = pred.endX;
              rArr[1] = 0.05;
              rArr[2] = pred.endZ;
              rArr[3] = pred.strikerReboundX;
              rArr[4] = 0.05;
              rArr[5] = pred.strikerReboundZ;
              reboundAimLine.geometry.attributes.position.needsUpdate = true;
            } else {
              reboundAimLine.visible = false;
            }
          } else {
            aimGroup.visible = false;
          }
        } else {
          aimGroup.visible = false;
          strikerHaloMesh.visible = false;
        }

        // Update pooled 3D particles
        for (let i = 0; i < particlePool.length; i++) {
          const pt = particlePool[i];
          if (pt.life > 0) {
            pt.life -= rawDt;
            if (pt.life <= 0) {
              pt.mesh.visible = false;
            } else {
              pt.mesh.position.x += pt.vx * rawDt;
              pt.mesh.position.y += pt.vy * rawDt;
              pt.mesh.position.z += pt.vz * rawDt;
              pt.vy -= 5.8 * rawDt;
              if (pt.mesh.position.y < 0.02) {
                pt.mesh.position.y = 0.02;
                pt.vy *= -0.45;
              }
              const alpha = pt.life / pt.maxLife;
              (pt.mesh.material as THREE.MeshBasicMaterial).opacity = alpha;
              pt.mesh.rotation.x += 6 * rawDt;
              pt.mesh.rotation.y += 6 * rawDt;
            }
          }
        }
      }

      // Update Camera Choreography with dynamic viewport-maximizing distance & smooth damping
      const preset = settingsRef.current.cameraPreset;
      const dampAlpha = 1 - Math.exp(-6.5 * rawDt);

      if (phaseRef.current === 'TITLE_SCREEN') {
        const orbitAngle = elapsedSec * 0.24;
        const radius = camera.aspect < 1 ? 11.2 : 7.2;
        const height = camera.aspect < 1 ? 10.5 : 5.8;
        _camTargetPos.set(
          Math.sin(orbitAngle) * radius,
          height + Math.sin(elapsedSec * 0.5) * 0.35,
          Math.cos(orbitAngle) * radius
        );
        _camLookAtTarget.set(0, 0, 0);
        camera.position.lerp(_camTargetPos, dampAlpha);
        _currentLookAt.lerp(_camLookAtTarget, dampAlpha);
        camera.lookAt(_currentLookAt);
      } else if (preset === 'FREE_ORBIT') {
        controls.update();
      } else {
        const mState = matchStateRef.current;
        const zSign =
          mState.mode === 'LOCAL_2P' && mState.currentTurn === 2 ? -1 : 1;

        if (cinematicFocusRef.current.active) {
          cinematicFocusRef.current.timer -= rawDt;
          if (cinematicFocusRef.current.timer <= 0) {
            cinematicFocusRef.current.active = false;
          }
          const cDist = dynamicCamDist * 0.72;
          _camTargetPos.set(
            cinematicFocusRef.current.x * 0.8,
            Math.cos(dynamicCamPolarRad) * cDist,
            cinematicFocusRef.current.z +
              zSign * Math.sin(dynamicCamPolarRad) * cDist
          );
          _camLookAtTarget.set(
            cinematicFocusRef.current.x,
            0,
            cinematicFocusRef.current.z
          );
        } else {
          // Position camera at exact dynamically computed distance & polar angle so board fills the viewport
          const camY = Math.cos(dynamicCamPolarRad) * dynamicCamDist;
          const camZ = zSign * Math.sin(dynamicCamPolarRad) * dynamicCamDist;

          const striker = piecesRef.current.find((p) => p.type === 'STRIKER');
          const xTrack =
            preset === 'PLAYER_POV' && striker ? striker.x * 0.35 : 0;

          _camTargetPos.set(xTrack, camY, camZ);
          _camLookAtTarget.set(xTrack * 0.15, 0, 0);
        }

        // Apply decaying impact camera shake
        if (cameraShakeRef.current > 0.001) {
          const shake = cameraShakeRef.current;
          _camTargetPos.x += (Math.random() - 0.5) * shake;
          _camTargetPos.y += (Math.random() - 0.5) * shake;
          cameraShakeRef.current *= Math.exp(-14 * rawDt);
        } else {
          cameraShakeRef.current = 0;
        }

        camera.position.lerp(_camTargetPos, dampAlpha);
        _currentLookAt.lerp(_camLookAtTarget, dampAlpha);
        camera.lookAt(_currentLookAt);
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    const onResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h);
      updateViewportFraming();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', onResize);
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [executeStrike, handleStrikerSlide, placeStrikerForTurn]);

  const isPlayerTurnInteractive =
    (phase === 'STRIKER_PLACEMENT' || phase === 'AIMING') &&
    !(
      matchState.currentTurn === 2 &&
      (gameMode === 'VS_AI' || gameMode === 'QUICK_MATCH')
    );

  const cycleCameraPreset = () => {
    const order: CameraPreset[] = [
      'PERSPECTIVE_3Q',
      'TOP_DOWN',
      'PLAYER_POV',
      'FREE_ORBIT',
    ];
    const nextIdx =
      (order.indexOf(settings.cameraPreset) + 1) % order.length;
    setSettings((prev) => ({ ...prev, cameraPreset: order[nextIdx] }));
  };

  const cameraLabel: Record<CameraPreset, string> = {
    PERSPECTIVE_3Q: '3/4 View',
    TOP_DOWN: 'Top-Down',
    PLAYER_POV: 'Low POV',
    FREE_ORBIT: 'Orbit',
  };

  const queenCompactLabel: Record<MatchState['queenStatus'], string> = {
    ON_BOARD: 'Queen: On Board',
    PENDING_COVER_P1: 'P1: Cover Queen!',
    PENDING_COVER_P2: 'P2: Cover Queen!',
    COVERED_P1: 'Queen: P1 (+30)',
    COVERED_P2: 'Queen: P2 (+30)',
  };

  const activePowerDisplay = pullPowerPct > 0 ? pullPowerPct : powerSettingPct;

  return (
    <div className="relative w-screen h-dvh overflow-hidden bg-[#0c0a08] select-none">
      {/* 100% Full-Viewport Isolated Three.js WebGL Container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full cursor-crosshair"
      />

      {/* ==================== TITLE SCREEN OVERLAY ==================== */}
      {phase === 'TITLE_SCREEN' && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between p-4 sm:p-8 pointer-events-none bg-gradient-to-t from-[#090705]/95 via-[#090705]/50 to-[#090705]/80">
          {/* Top Bar on Title Screen */}
          <div className="flex items-center justify-between gap-4 pointer-events-auto">
            <div className="flex items-center gap-2.5">
              <svg
                className="w-8 h-8 text-amber-400 shrink-0"
                viewBox="0 0 64 64"
                fill="none"
              >
                <rect
                  x="6"
                  y="6"
                  width="52"
                  height="52"
                  rx="8"
                  stroke="currentColor"
                  strokeWidth="3.5"
                />
                <circle cx="14" cy="14" r="3.5" fill="currentColor" />
                <circle cx="50" cy="14" r="3.5" fill="currentColor" />
                <circle cx="14" cy="50" r="3.5" fill="currentColor" />
                <circle cx="50" cy="50" r="3.5" fill="currentColor" />
                <circle
                  cx="32"
                  cy="32"
                  r="14"
                  stroke="currentColor"
                  strokeWidth="2.5"
                />
                <circle cx="32" cy="32" r="5" fill="#dc2626" />
              </svg>
              <span className="font-display text-base sm:text-xl font-bold tracking-wider text-amber-100 whitespace-nowrap">
                CARROM ROYALE 3D
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowKotlinModal(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1c1612] hover:bg-[#2a211b] border border-amber-500/25 text-xs font-medium text-amber-200 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Code2 className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">Android Kotlin Source</span>
                <span className="sm:hidden">Kotlin</span>
              </button>
              <button
                onClick={() =>
                  setSettings((prev) => ({ ...prev, muted: !prev.muted }))
                }
                aria-label="Toggle Mute"
                className="p-2 rounded-lg bg-[#1c1612] hover:bg-[#2a211b] border border-amber-500/20 text-amber-200 transition-colors cursor-pointer"
              >
                {settings.muted ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-amber-400" />
                )}
              </button>
            </div>
          </div>

          {/* Center Hero Lockup */}
          <div className="my-auto max-w-xl mx-auto text-center pointer-events-auto px-1">
            <p className="text-[11px] font-medium tracking-widest uppercase text-amber-400/90 mb-1.5">
              ICF Rules · 120Hz Physics · Touch & Controller Bar
            </p>
            <h1
              className="font-display text-3xl sm:text-5xl font-bold text-[#fdf8f0] tracking-tight mb-3"
              style={{ textWrap: 'balance' }}
            >
              Championship 3D Carrom
            </h1>
            <p className="text-xs sm:text-sm text-stone-300 max-w-md mx-auto mb-5 leading-relaxed">
              Position your striker, drag on the board or dial the controller bar to aim, set shot power, and cover the Red Queen.
            </p>

            {/* Game Mode Selector */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {(
                [
                  {
                    id: 'QUICK_MATCH',
                    label: 'Quick Match',
                    sub: 'Instant Table',
                  },
                  {
                    id: 'VS_AI',
                    label: 'Play vs AI',
                    sub: `AI: ${settings.aiDifficulty}`,
                  },
                  {
                    id: 'LOCAL_2P',
                    label: 'Local 2P',
                    sub: 'Pass & Play',
                  },
                  {
                    id: 'PRACTICE',
                    label: 'Practice',
                    sub: 'Free Shots',
                  },
                ] as const
              ).map((m) => {
                const active = gameMode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setGameMode(m.id)}
                    className={`px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      active
                        ? 'bg-amber-500/20 border-amber-400 text-amber-100 shadow-lg'
                        : 'bg-[#17120e]/90 border-white/10 text-stone-300 hover:border-amber-500/40'
                    }`}
                  >
                    <div className="text-xs font-semibold whitespace-nowrap">
                      {m.label}
                    </div>
                    <div className="text-[10px] text-stone-400 truncate mt-0.5">
                      {m.sub}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* AI Difficulty & Board Theme Quick Selectors */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#17120e] border border-white/10">
                <span className="px-2 text-[11px] text-stone-400">AI:</span>
                {(['EASY', 'MEDIUM', 'HARD'] as AIDifficulty[]).map((diff) => (
                  <button
                    key={diff}
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, aiDifficulty: diff }))
                    }
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      settings.aiDifficulty === diff
                        ? 'bg-amber-500 text-[#0c0a08] font-semibold'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    {diff}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 rounded-lg bg-[#17120e] border border-white/10">
                <span className="px-2 text-[11px] text-stone-400">Theme:</span>
                {(Object.keys(BOARD_THEMES) as BoardThemeId[]).map((tId) => (
                  <button
                    key={tId}
                    onClick={() =>
                      setSettings((prev) => ({ ...prev, theme: tId }))
                    }
                    className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      settings.theme === tId
                        ? 'bg-amber-500 text-[#0c0a08] font-semibold'
                        : 'text-stone-300 hover:text-white'
                    }`}
                  >
                    {BOARD_THEMES[tId].name.split(' ')[1]}
                  </button>
                ))}
              </div>
            </div>

            {/* Primary Start CTA */}
            <button
              onClick={() => startNewMatch(gameMode)}
              className="inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-[#0c0a08] font-bold text-sm sm:text-base tracking-wide shadow-xl transition-all cursor-pointer whitespace-nowrap"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Start Match</span>
            </button>
          </div>

          {/* Single Flat Control-Hint Line */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 text-[11px] text-stone-400 border-t border-white/10 pt-3 pointer-events-auto">
            <div>
              Drag Board to Aim · Use Bottom Controller Bar for Move, Aim, Power & Shoot
            </div>
            <div className="font-mono-tabular">
              Won: {settings.stats.matchesWon}/{settings.stats.matchesPlayed} · Coins: {settings.stats.coinsPocketed} · Queens: {settings.stats.queensCovered}
            </div>
          </div>
        </div>
      )}

      {/* ==================== ACTIVE GAMEPLAY PERIMETER HUD ==================== */}
      {phase !== 'TITLE_SCREEN' && (
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between">
          {/* 1. COMPACT TOP HEADER (Avatars, Scores, Coin Counters & Quick Tools) */}
          <div
            ref={topHeaderRef}
            className="w-full max-w-4xl mx-auto px-2 pt-1.5 pb-1 pointer-events-auto"
          >
            <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#14100d]/95 border border-amber-500/25 shadow-lg">
              {/* Player 1 (White) Compact Avatar & Counter */}
              <div
                className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors min-w-0 ${
                  matchState.currentTurn === 1
                    ? 'bg-amber-500/20 border border-amber-400/60'
                    : 'opacity-75'
                }`}
              >
                <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-amber-200 to-amber-600 flex items-center justify-center text-[#0c0a08] font-bold text-xs shrink-0 shadow">
                  P1
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#f7eed7] border border-[#2a1810]"
                    title="White Carrommen"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-amber-100 truncate">
                      You
                    </span>
                    <span className="font-mono-tabular text-xs font-bold text-amber-400">
                      {matchState.p1Score}
                    </span>
                  </div>
                  <div className="text-[10px] text-stone-300 font-mono-tabular whitespace-nowrap">
                    W: {matchState.whitePocketed}/9 · Left {matchState.whiteRemaining}
                  </div>
                </div>
              </div>

              {/* Center Status: Queen Status + Turn Banner */}
              <div className="flex flex-col items-center justify-center text-center min-w-0 px-1">
                <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold text-amber-300 whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                  <span>{queenCompactLabel[matchState.queenStatus]}</span>
                </div>
                <div
                  className={`text-[10px] sm:text-xs font-medium truncate max-w-[155px] sm:max-w-xs ${
                    matchState.lastBannerType === 'FOUL'
                      ? 'text-rose-400'
                      : matchState.lastBannerType === 'QUEEN'
                      ? 'text-amber-300'
                      : matchState.lastBannerType === 'GOOD'
                      ? 'text-emerald-400'
                      : 'text-stone-300'
                  }`}
                >
                  {matchState.lastBannerText}
                </div>
              </div>

              {/* Player 2 / AI (Black) Compact Avatar & Utility Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                <div
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg transition-colors min-w-0 ${
                    matchState.currentTurn === 2
                      ? 'bg-amber-500/20 border border-amber-400/60'
                      : 'opacity-75'
                  }`}
                >
                  <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-stone-600 to-stone-900 border border-white/20 flex items-center justify-center text-stone-100 font-bold text-xs shrink-0 shadow">
                    {gameMode === 'LOCAL_2P' ? 'P2' : 'AI'}
                    <span
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#181512] border border-amber-400/60"
                      title="Black Carrommen"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-stone-100 truncate">
                        {gameMode === 'LOCAL_2P'
                          ? 'P2'
                          : gameMode === 'PRACTICE'
                          ? 'Rack'
                          : settings.aiDifficulty.slice(0, 3)}
                      </span>
                      <span className="font-mono-tabular text-xs font-bold text-amber-400">
                        {matchState.p2Score}
                      </span>
                    </div>
                    <div className="text-[10px] text-stone-300 font-mono-tabular whitespace-nowrap">
                      B: {matchState.blackPocketed}/9 · Left {matchState.blackRemaining}
                    </div>
                  </div>
                </div>

                {/* Compact Action Buttons */}
                <button
                  onClick={cycleCameraPreset}
                  title={`Camera: ${cameraLabel[settings.cameraPreset]}`}
                  className="p-2 rounded-lg bg-[#211b16] hover:bg-[#2e251e] text-amber-300 transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowSettingsModal(true)}
                  aria-label="Settings"
                  className="p-2 rounded-lg bg-[#211b16] hover:bg-[#2e251e] text-stone-200 transition-colors cursor-pointer"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Slingshot Pull-Back Floating Indicator (only shown when actively pulling back on board) */}
          {pullPowerPct > 0 && (
            <div className="mx-auto my-auto pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#14100d]/95 border border-amber-400/50 shadow-xl">
              <span className="text-xs font-bold text-amber-300 font-mono-tabular">
                Pull Power: {pullPowerPct}% · Angle: {aimAngleDeg > 0 ? `+${aimAngleDeg}°` : `${aimAngleDeg}°`}
              </span>
            </div>
          )}

          {/* 2. DEDICATED SHOOTING CONTROLLER BAR BELOW THE BOARD */}
          <div
            ref={bottomDockRef}
            className="w-full max-w-3xl mx-auto px-2 pb-2 pt-0.5 flex flex-col items-center pointer-events-auto"
          >
            {/* Minimize / Expand Handle */}
            <button
              onClick={() => setDockCollapsed((prev) => !prev)}
              className="flex items-center gap-1 px-3 py-0.5 rounded-t-lg bg-[#14100d]/95 border-t border-x border-amber-500/25 text-[10px] font-medium text-stone-300 hover:text-amber-200 transition-colors cursor-pointer"
            >
              {dockCollapsed ? (
                <>
                  <ChevronUp className="w-3 h-3 text-amber-400" />
                  <span>Show Shooting Controller</span>
                </>
              ) : (
                <>
                  <ChevronDown className="w-3 h-3 text-amber-400" />
                  <span>Minimize Bar</span>
                </>
              )}
            </button>

            {!dockCollapsed && (
              <div className="w-full p-2.5 sm:p-3 rounded-2xl bg-[#14100d]/95 border border-amber-500/30 shadow-2xl flex flex-col gap-2">
                {/* ROW 1: MOVE (Baseline Striker Track) & AIM (Directional Angle Control) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* MOVE CONTROL: Authentic Carrom Baseline Track + Step Buttons */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#1e1813] border border-white/10">
                    <div className="flex items-center gap-1 shrink-0 min-w-[62px]">
                      <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-wider uppercase text-stone-200">
                          Move
                        </span>
                        <span
                          className={`text-[9px] font-mono-tabular ${
                            isPlacementValid
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {isPlacementValid ? 'Legal' : 'Blocked'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!isPlayerTurnInteractive}
                      onClick={() => handleStrikerSlide(strikerNormX - 0.08)}
                      aria-label="Move Striker Left"
                      className="w-8 h-8 rounded-lg bg-[#2a221b] hover:bg-[#382d24] active:scale-95 disabled:opacity-40 flex items-center justify-center text-amber-200 cursor-pointer shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    {/* Decorative Carrom Baseline Slider Track */}
                    <div className="relative flex-1 flex items-center px-2 py-1 rounded-full bg-[#f3e5c8]/15 border border-amber-500/30">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-600 border border-amber-400 shrink-0 mr-1" />
                      <input
                        type="range"
                        min={-1}
                        max={1}
                        step={0.01}
                        disabled={!isPlayerTurnInteractive}
                        value={strikerNormX}
                        onChange={(e) =>
                          handleStrikerSlide(parseFloat(e.target.value))
                        }
                        aria-label="Move Striker Along Baseline"
                        className="w-full h-5 accent-amber-400 cursor-pointer disabled:opacity-40"
                      />
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-600 border border-amber-400 shrink-0 ml-1" />
                    </div>

                    <button
                      type="button"
                      disabled={!isPlayerTurnInteractive}
                      onClick={() => handleStrikerSlide(strikerNormX + 0.08)}
                      aria-label="Move Striker Right"
                      className="w-8 h-8 rounded-lg bg-[#2a221b] hover:bg-[#382d24] active:scale-95 disabled:opacity-40 flex items-center justify-center text-amber-200 cursor-pointer shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  {/* AIM CONTROL: Directional Shot Angle Slider + Fine Step Buttons */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#1e1813] border border-white/10">
                    <div className="flex items-center gap-1 shrink-0 min-w-[62px]">
                      <Target className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-wider uppercase text-stone-200">
                          Aim
                        </span>
                        <span className="text-[10px] font-mono-tabular text-amber-300">
                          {aimAngleDeg > 0 ? `+${aimAngleDeg}°` : `${aimAngleDeg}°`}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={!isPlayerTurnInteractive}
                      onClick={() => handleAimAngleChange(aimAngleDeg - 2)}
                      aria-label="Aim Left 2 Degrees"
                      className="w-8 h-8 rounded-lg bg-[#2a221b] hover:bg-[#382d24] active:scale-95 disabled:opacity-40 flex items-center justify-center text-amber-200 cursor-pointer shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <div className="flex-1 flex items-center px-1">
                      <input
                        type="range"
                        min={-80}
                        max={80}
                        step={1}
                        disabled={!isPlayerTurnInteractive}
                        value={aimAngleDeg}
                        onChange={(e) =>
                          handleAimAngleChange(parseFloat(e.target.value))
                        }
                        aria-label="Directional Aim Angle"
                        className="w-full h-5 accent-amber-400 cursor-pointer disabled:opacity-40"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={!isPlayerTurnInteractive}
                      onClick={() => handleAimAngleChange(aimAngleDeg + 2)}
                      aria-label="Aim Right 2 Degrees"
                      className="w-8 h-8 rounded-lg bg-[#2a221b] hover:bg-[#382d24] active:scale-95 disabled:opacity-40 flex items-center justify-center text-amber-200 cursor-pointer shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* ROW 2: POWER (Drag-Sensitive Power Meter) & HIT / SHOOT CTA BUTTON */}
                <div className="flex items-center gap-2">
                  {/* Drag-Sensitive Power Meter */}
                  <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#1e1813] border border-white/10">
                    <div className="flex items-center gap-1 shrink-0 min-w-[62px]">
                      <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold tracking-wider uppercase text-stone-200">
                          Power
                        </span>
                        <span className="text-[10px] font-mono-tabular font-semibold text-amber-300">
                          {activePowerDisplay}%
                        </span>
                      </div>
                    </div>

                    <div className="relative flex-1 flex items-center h-7">
                      {/* Visual Gradient Power Track Background */}
                      <div className="absolute inset-x-0 h-2.5 rounded-full bg-stone-800 overflow-hidden pointer-events-none">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-500 transition-all duration-75"
                          style={{ width: `${activePowerDisplay}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        min={15}
                        max={100}
                        step={1}
                        disabled={!isPlayerTurnInteractive}
                        value={activePowerDisplay}
                        onChange={(e) =>
                          handlePowerChange(parseFloat(e.target.value))
                        }
                        aria-label="Shot Power Meter"
                        className="relative z-10 w-full h-7 opacity-0 cursor-pointer disabled:cursor-not-allowed"
                      />
                      {/* Custom Thumb Indicator */}
                      <div
                        className="pointer-events-none absolute w-4 h-4 rounded-full bg-white border-2 border-amber-500 shadow-md -translate-x-1/2"
                        style={{ left: `${activePowerDisplay}%` }}
                      />
                    </div>
                  </div>

                  {/* HIT / SHOOT Primary Button */}
                  <button
                    type="button"
                    disabled={!isPlayerTurnInteractive || !isPlacementValid}
                    onClick={() => {
                      const speed =
                        (powerSettingPct / 100) *
                        physicsRef.current.config.maxShotSpeed;
                      executeStrike(
                        aimStateRef.current.dirX,
                        aimStateRef.current.dirZ,
                        speed
                      );
                    }}
                    className="min-h-[44px] px-5 sm:px-6 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 active:scale-95 disabled:from-stone-800 disabled:to-stone-800 disabled:text-stone-500 text-[#0c0a08] font-extrabold text-xs sm:text-sm tracking-wide shadow-lg flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 whitespace-nowrap"
                  >
                    <Crosshair className="w-4 h-4 stroke-[2.5]" />
                    <span>
                      {phase === 'PIECES_MOVING'
                        ? 'MOVING...'
                        : !isPlayerTurnInteractive
                        ? 'AI TURN'
                        : 'SHOOT'}
                    </span>
                  </button>

                  {/* Reset Board Quick Button */}
                  <button
                    type="button"
                    onClick={() => startNewMatch(gameMode)}
                    title="Reset Match"
                    aria-label="Reset Match"
                    className="min-h-[44px] px-2.5 rounded-xl bg-[#211b16] hover:bg-[#2e251e] border border-white/10 text-stone-300 flex items-center justify-center transition-colors cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-4 h-4 text-amber-400" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==================== PAUSE / SETTINGS MODAL ==================== */}
      {(isPaused || showSettingsModal) && phase !== 'TITLE_SCREEN' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-md rounded-2xl bg-[#16120e] border border-amber-500/30 p-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h2 className="font-display text-lg font-bold text-amber-100">
                Table & Match Settings
              </h2>
              <button
                onClick={() => {
                  setIsPaused(false);
                  setShowSettingsModal(false);
                }}
                className="p-1.5 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 my-4 text-xs">
              {/* Board Theme Selection */}
              <div>
                <label className="block text-stone-300 font-semibold mb-1.5">
                  3D Carrom Board Theme
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(BOARD_THEMES) as BoardThemeId[]).map((tId) => {
                    const spec = BOARD_THEMES[tId];
                    const active = settings.theme === tId;
                    return (
                      <button
                        key={tId}
                        onClick={() =>
                          setSettings((prev) => ({ ...prev, theme: tId }))
                        }
                        className={`p-2 rounded-lg border text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-amber-500/20 border-amber-400 text-amber-100'
                            : 'bg-[#1f1914] border-white/10 text-stone-300 hover:border-white/25'
                        }`}
                      >
                        <div className="font-semibold whitespace-nowrap">
                          {spec.name}
                        </div>
                        <div className="text-[10px] text-stone-400 truncate">
                          {spec.subtitle}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Camera Mode */}
              <div>
                <label className="block text-stone-300 font-semibold mb-1.5">
                  Camera Perspective
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      'PERSPECTIVE_3Q',
                      'TOP_DOWN',
                      'PLAYER_POV',
                      'FREE_ORBIT',
                    ] as CameraPreset[]
                  ).map((cam) => (
                    <button
                      key={cam}
                      onClick={() =>
                        setSettings((prev) => ({ ...prev, cameraPreset: cam }))
                      }
                      className={`px-3 py-2 rounded-lg border text-left font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        settings.cameraPreset === cam
                          ? 'bg-amber-500/20 border-amber-400 text-amber-100'
                          : 'bg-[#1f1914] border-white/10 text-stone-300'
                      }`}
                    >
                      {cameraLabel[cam]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Audio Volume & Toggles */}
              <div className="space-y-3 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-stone-300 font-medium">
                    Sound Effects Volume
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings.soundVolume}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        soundVolume: parseFloat(e.target.value),
                        muted: false,
                      }))
                    }
                    className="w-36 accent-amber-400 cursor-pointer"
                  />
                </div>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-stone-300 font-medium">
                    Trajectory & Deflection Aim Guide
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.showTrajectoryGuide}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        showTrajectoryGuide: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-amber-400"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-stone-300 font-medium">
                    Cinematic Queen Camera Focus
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.cinematicShots}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        cinematicShots: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-amber-400"
                  />
                </label>

                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-stone-300 font-medium">
                    Haptic Vibration Feedback
                  </span>
                  <input
                    type="checkbox"
                    checked={settings.hapticsEnabled}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        hapticsEnabled: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 accent-amber-400"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10">
              <button
                onClick={() => {
                  setIsPaused(false);
                  setShowSettingsModal(false);
                  setShowKotlinModal(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#241d17] hover:bg-[#30271f] text-xs font-medium text-amber-300 cursor-pointer whitespace-nowrap"
              >
                <Code2 className="w-4 h-4" />
                <span>Kotlin Code</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsPaused(false);
                    setShowSettingsModal(false);
                    setPhase('TITLE_SCREEN');
                  }}
                  className="px-3.5 py-2 rounded-lg bg-[#241d17] hover:bg-[#30271f] text-xs font-medium text-stone-200 cursor-pointer whitespace-nowrap"
                >
                  Main Menu
                </button>
                <button
                  onClick={() => {
                    setIsPaused(false);
                    setShowSettingsModal(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0c0a08] text-xs font-bold cursor-pointer whitespace-nowrap"
                >
                  Resume
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== GAME OVER / VICTORY MODAL ==================== */}
      {phase === 'GAME_OVER' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center p-4 bg-black/80">
          <div className="w-full max-w-md rounded-2xl bg-[#16120e] border border-amber-400/40 p-6 text-center shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-400/50 flex items-center justify-center mx-auto mb-3">
              <Trophy className="w-6 h-6 text-amber-400" />
            </div>
            <h2 className="font-display text-2xl font-bold text-amber-100 mb-1">
              {matchState.winner === 1
                ? 'Player 1 Wins the Board!'
                : gameMode === 'LOCAL_2P'
                ? 'Player 2 Wins the Board!'
                : 'AI Opponent Wins the Board!'}
            </h2>
            <p className="text-xs text-stone-300 mb-5">{matchState.winReason}</p>

            <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-[#1f1914] border border-white/10 mb-5 font-mono-tabular">
              <div>
                <div className="text-[11px] text-stone-400">
                  Player 1 (White)
                </div>
                <div className="text-xl font-bold text-amber-300">
                  {matchState.p1Score} pts
                </div>
                <div className="text-[11px] text-stone-400">
                  {matchState.whitePocketed}/9 Coins
                  {matchState.queenStatus === 'COVERED_P1' ? ' + Queen' : ''}
                </div>
              </div>
              <div className="border-l border-white/10">
                <div className="text-[11px] text-stone-400">
                  {gameMode === 'LOCAL_2P' ? 'Player 2 (Black)' : 'AI (Black)'}
                </div>
                <div className="text-xl font-bold text-stone-200">
                  {matchState.p2Score} pts
                </div>
                <div className="text-[11px] text-stone-400">
                  {matchState.blackPocketed}/9 Coins
                  {matchState.queenStatus === 'COVERED_P2' ? ' + Queen' : ''}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setPhase('TITLE_SCREEN')}
                className="px-4 py-2.5 rounded-lg bg-[#241d17] hover:bg-[#30271f] text-xs font-medium text-stone-200 cursor-pointer whitespace-nowrap"
              >
                Main Menu
              </button>
              <button
                onClick={() => startNewMatch(gameMode)}
                className="flex items-center gap-2 px-6 py-2.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-[#0c0a08] text-xs font-bold cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" />
                <span>Play Again</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== ANDROID KOTLIN + OPENGL ES 3.0 ARCHITECTURE MODAL ==================== */}
      {showKotlinModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/85">
          <div className="w-full max-w-4xl h-[82vh] rounded-2xl bg-[#14110e] border border-amber-500/30 flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <div>
                <h2 className="font-display text-base sm:text-lg font-bold text-amber-100">
                  Native Android Kotlin + OpenGL ES 3.0 + Jetpack Compose Source
                </h2>
                <p className="text-xs text-stone-400">
                  Complete modular Android architecture matching the live 3D simulation
                </p>
              </div>
              <button
                onClick={() => setShowKotlinModal(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-stone-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* File Tabs */}
            <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[#1c1713] border-b border-white/10 overflow-x-auto">
              <div className="flex items-center gap-1.5">
                {ANDROID_KOTLIN_SOURCES.map((file, idx) => (
                  <button
                    key={file.filename}
                    onClick={() => {
                      setSelectedKotlinIdx(idx);
                      setCopiedKotlin(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono-tabular transition-colors cursor-pointer whitespace-nowrap ${
                      selectedKotlinIdx === idx
                        ? 'bg-amber-500 text-[#0c0a08] font-semibold'
                        : 'bg-[#26201a] text-stone-300 hover:text-white'
                    }`}
                  >
                    {file.filename}
                  </button>
                ))}
              </div>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(
                    ANDROID_KOTLIN_SOURCES[selectedKotlinIdx].code
                  );
                  setCopiedKotlin(true);
                  setTimeout(() => setCopiedKotlin(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-xs font-medium text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedKotlin ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Kotlin File</span>
                  </>
                )}
              </button>
            </div>

            {/* Code Content */}
            <div className="p-4 flex-1 overflow-y-auto bg-[#0d0b09] font-mono-tabular text-xs text-stone-200 leading-relaxed">
              <div className="text-amber-400/90 mb-2">
                {ANDROID_KOTLIN_SOURCES[selectedKotlinIdx].packagePath} —{' '}
                {ANDROID_KOTLIN_SOURCES[selectedKotlinIdx].description}
              </div>
              <pre className="whitespace-pre-wrap break-words">
                {ANDROID_KOTLIN_SOURCES[selectedKotlinIdx].code}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
