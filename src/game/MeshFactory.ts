import * as THREE from 'three';
import {
  BOARD_THEMES,
  BoardThemeId,
  BoardThemeSpec,
  DEFAULT_PHYSICS_CONFIG,
  PhysicsConfig,
  PieceType,
} from './GameConfig';
import { POCKET_COORDS } from './CarromPhysics';

export class MeshFactory {
  private static contactShadowTexture: THREE.CanvasTexture | null = null;

  /**
   * Generates a soft radial contact shadow texture once and reuses it across pieces
   */
  public static getContactShadowTexture(): THREE.CanvasTexture {
    if (this.contactShadowTexture) return this.contactShadowTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const tex = new THREE.CanvasTexture(canvas);
    this.contactShadowTexture = tex;
    return tex;
  }

  /**
   * Generates a high-resolution (2048x2048) procedural Carrom board playing surface texture
   * with authentic ICF markings, wood grain, baselines, diagonal foul arrows, and center lotus rose.
   */
  public static createBoardSurfaceTexture(
    theme: BoardThemeSpec,
    config: PhysicsConfig,
    maxAnisotropy: number
  ): THREE.CanvasTexture {
    const size = 2048;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const half = size / 2;
    // Scale factor from world units (-boardHalfSize..+boardHalfSize) to canvas pixels
    const scale = half / config.boardHalfSize;

    // 1. Base Cream Birch / Maple Lacquer Fill
    ctx.fillStyle = theme.surfaceBg;
    ctx.fillRect(0, 0, size, size);

    // 2. Subtle Organic Wood Grain Fibers
    ctx.save();
    ctx.strokeStyle = theme.surfaceGrainTint;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.28;
    for (let i = 0; i < 420; i++) {
      const y = (i / 420) * size;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 64) {
        const wave = Math.sin(x * 0.004 + i * 0.17) * 5;
        ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Subtle vignette warm polish near frame borders
    const vig = ctx.createRadialGradient(half, half, half * 0.55, half, half, half * 1.38);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(45, 22, 8, 0.12)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, size, size);

    // 3. Outer Border Hairline Framing
    const borderInset = 0.28 * scale;
    ctx.strokeStyle = theme.markingPrimary;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.45;
    ctx.strokeRect(
      borderInset,
      borderInset,
      size - borderInset * 2,
      size - borderInset * 2
    );
    ctx.globalAlpha = 1.0;

    // 4. Center Lotus Rose & Concentric Rack Circles
    const outerRackRadius = (config.coinRadius * 5.05) * scale;
    const queenCircleRadius = (config.coinRadius * 1.12) * scale;

    // Outer decorative double ring
    ctx.beginPath();
    ctx.arc(half, half, outerRackRadius + 10, 0, Math.PI * 2);
    ctx.strokeStyle = theme.markingPrimary;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(half, half, outerRackRadius, 0, Math.PI * 2);
    ctx.strokeStyle = theme.markingSecondary;
    ctx.lineWidth = 6;
    ctx.stroke();

    // 16-Petal Traditional Compass / Lotus Star inside the center circle
    const petals = 16;
    for (let i = 0; i < petals; i++) {
      const angle = (i * Math.PI * 2) / petals;
      const nextAngle = ((i + 0.5) * Math.PI * 2) / petals;
      const prevAngle = ((i - 0.5) * Math.PI * 2) / petals;

      const tipR = outerRackRadius * 0.92;
      const midR = outerRackRadius * 0.36;

      ctx.beginPath();
      ctx.moveTo(
        half + Math.cos( prevAngle ) * queenCircleRadius,
        half + Math.sin( prevAngle ) * queenCircleRadius
      );
      ctx.quadraticCurveTo(
        half + Math.cos(prevAngle) * midR,
        half + Math.sin(prevAngle) * midR,
        half + Math.cos(angle) * tipR,
        half + Math.sin(angle) * tipR
      );
      ctx.quadraticCurveTo(
        half + Math.cos(nextAngle) * midR,
        half + Math.sin(nextAngle) * midR,
        half + Math.cos(nextAngle) * queenCircleRadius,
        half + Math.sin(nextAngle) * queenCircleRadius
      );
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? theme.markingSecondary : theme.markingPrimary;
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // Inner ring around Queen spot
    ctx.beginPath();
    ctx.arc(half, half, queenCircleRadius * 1.35, 0, Math.PI * 2);
    ctx.fillStyle = theme.surfaceBg;
    ctx.fill();
    ctx.strokeStyle = theme.markingPrimary;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Center Queen Spot (Solid Crimson with Gold Ring)
    ctx.beginPath();
    ctx.arc(half, half, queenCircleRadius, 0, Math.PI * 2);
    ctx.fillStyle = theme.markingSecondary;
    ctx.fill();
    ctx.strokeStyle = theme.markingAccent;
    ctx.lineWidth = 4;
    ctx.stroke();

    // 5. Four Player Baselines (North, South, East, West)
    const baseDist = config.baselineZ * scale;
    const baseHalfLen = config.baselineHalfLength * scale;
    const baseCircleR = config.strikerRadius * 0.95 * scale;
    const lineGap = baseCircleR;

    for (let rot = 0; rot < 4; rot++) {
      ctx.save();
      ctx.translate(half, half);
      ctx.rotate((rot * Math.PI) / 2);

      // Outer thick baseline & inner thin baseline
      ctx.beginPath();
      ctx.moveTo(-baseHalfLen, baseDist - lineGap);
      ctx.lineTo(baseHalfLen, baseDist - lineGap);
      ctx.strokeStyle = theme.markingPrimary;
      ctx.lineWidth = 6.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(-baseHalfLen, baseDist + lineGap);
      ctx.lineTo(baseHalfLen, baseDist + lineGap);
      ctx.strokeStyle = theme.markingPrimary;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // End circles on both ends of the baseline
      for (const sign of [-1, 1]) {
        const cx = sign * baseHalfLen;
        const cy = baseDist;

        ctx.beginPath();
        ctx.arc(cx, cy, baseCircleR, 0, Math.PI * 2);
        ctx.fillStyle = theme.markingSecondary;
        ctx.fill();
        ctx.lineWidth = 5;
        ctx.strokeStyle = theme.markingPrimary;
        ctx.stroke();

        // Inner gold dot inside baseline circle
        ctx.beginPath();
        ctx.arc(cx, cy, baseCircleR * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = theme.markingAccent;
        ctx.fill();
      }

      // 6. Diagonal Foul Lines with Curved Hook Arrows toward Pockets
      const diagStart = outerRackRadius * 1.18;
      const diagEnd = config.pocketOffset * scale * 0.76;

      ctx.strokeStyle = theme.markingPrimary;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(diagStart * 0.707, diagStart * 0.707);
      ctx.lineTo(diagEnd, diagEnd);
      ctx.stroke();

      // Decorative inward curved hook arc at end of diagonal arrow
      const hookCenter = diagEnd * 0.85;
      ctx.beginPath();
      ctx.arc(hookCenter, hookCenter, baseCircleR * 1.35, -Math.PI * 0.15, Math.PI * 0.65);
      ctx.strokeStyle = theme.markingPrimary;
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // Arrowhead pointing to pocket
      ctx.beginPath();
      ctx.moveTo(diagEnd + 10, diagEnd + 10);
      ctx.lineTo(diagEnd - 18, diagEnd - 4);
      ctx.lineTo(diagEnd - 4, diagEnd - 18);
      ctx.closePath();
      ctx.fillStyle = theme.markingPrimary;
      ctx.fill();

      ctx.restore();
    }

    // 7. Four Corner Pocket Cutout Dark Wells on the Surface Texture
    const pocketR = config.pocketRadius * scale;
    for (const pk of POCKET_COORDS) {
      const px = half + pk.x * scale;
      const pz = half + pk.z * scale;

      // Outer wood bevel lip
      ctx.beginPath();
      ctx.arc(px, pz, pocketR * 1.12, 0, Math.PI * 2);
      ctx.fillStyle = '#26150b';
      ctx.fill();

      // Deep dark well center
      const wellGrad = ctx.createRadialGradient(px, pz, pocketR * 0.1, px, pz, pocketR);
      wellGrad.addColorStop(0, '#030202');
      wellGrad.addColorStop(0.8, '#0c0806');
      wellGrad.addColorStop(1, '#1c110a');
      ctx.beginPath();
      ctx.arc(px, pz, pocketR, 0, Math.PI * 2);
      ctx.fillStyle = wellGrad;
      ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Builds a multi-part 3D Carrom Board (`THREE.Group` with 10+ distinct geometric sub-parts):
   * - Playable Birch Surface Deck
   * - 4 Bevelled Hardwood Frame Rails (`ExtrudeGeometry`)
   * - 4 Sculpted Metallic Corner Bumper Brackets
   * - 4 Recessed 3D Corner Pocket Bezels & Woven Net Cups (`LatheGeometry`)
   * - Under-board Cabinet Cradle & Table Felt Mat
   */
  public static createCarromBoardGroup(
    themeId: BoardThemeId,
    config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG,
    maxAnisotropy = 8
  ): THREE.Group {
    const theme = BOARD_THEMES[themeId];
    const boardGroup = new THREE.Group();
    boardGroup.name = 'CarromBoardGroup';

    const half = config.boardHalfSize;
    const fw = config.frameWidth;
    const fh = config.frameHeight;
    const outerHalf = half + fw;

    // 1. Playable Surface Deck (Top flush at Y = 0)
    const surfaceTex = this.createBoardSurfaceTexture(theme, config, maxAnisotropy);
    const deckGeo = new THREE.BoxGeometry(half * 2, 0.16, half * 2);
    const deckTopMat = new THREE.MeshStandardMaterial({
      map: surfaceTex,
      roughness: 0.24,
      metalness: 0.02,
    });
    const deckSideMat = new THREE.MeshStandardMaterial({
      color: theme.frameColor,
      roughness: 0.5,
    });
    const deckMesh = new THREE.Mesh(deckGeo, [
      deckSideMat,
      deckSideMat,
      deckTopMat,
      deckSideMat,
      deckSideMat,
      deckSideMat,
    ]);
    deckMesh.position.y = -0.08;
    deckMesh.receiveShadow = true;
    boardGroup.add(deckMesh);

    // 2. Hardwood Outer Frame Rails (4 bevelled rails around the board)
    const frameMat = new THREE.MeshPhysicalMaterial({
      color: theme.frameColor,
      roughness: theme.frameRoughness,
      metalness: theme.frameMetalness,
      clearcoat: 0.65,
      clearcoatRoughness: 0.18,
    });

    const railLength = half * 2 + fw * 0.6;
    const railShape = new THREE.Shape();
    railShape.moveTo(-railLength / 2, -fw / 2);
    railShape.lineTo(railLength / 2, -fw / 2);
    railShape.lineTo(railLength / 2, fw / 2);
    railShape.lineTo(-railLength / 2, fw / 2);
    railShape.closePath();

    const railGeo = new THREE.ExtrudeGeometry(railShape, {
      depth: fh,
      bevelEnabled: true,
      bevelThickness: 0.045,
      bevelSize: 0.04,
      bevelSegments: 4,
    });
    railGeo.rotateX(-Math.PI / 2);
    railGeo.center();

    const railPositions: Array<{ x: number; z: number; rotY: number }> = [
      { x: 0, z: -(half + fw / 2), rotY: 0 }, // North
      { x: 0, z: half + fw / 2, rotY: 0 }, // South
      { x: -(half + fw / 2), z: 0, rotY: Math.PI / 2 }, // West
      { x: half + fw / 2, z: 0, rotY: Math.PI / 2 }, // East
    ];

    railPositions.forEach((rp) => {
      const rail = new THREE.Mesh(railGeo, frameMat);
      rail.position.set(rp.x, fh * 0.36, rp.z);
      rail.rotation.y = rp.rotY;
      rail.castShadow = true;
      rail.receiveShadow = true;
      boardGroup.add(rail);
    });

    // 3. Four Sculpted Metallic Corner Bumper Brackets + Gold/Brass Trim Strips
    const cornerMat = new THREE.MeshStandardMaterial({
      color: theme.cornerAccentColor,
      metalness: theme.cornerMetalness,
      roughness: theme.cornerRoughness,
    });

    const cornerBlockGeo = new THREE.CylinderGeometry(
      fw * 0.78,
      fw * 0.82,
      fh + 0.1,
      24
    );
    const cornerSigns = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];

    cornerSigns.forEach(([sx, sz]) => {
      const cx = sx * (half + fw * 0.46);
      const cz = sz * (half + fw * 0.46);

      const cornerCap = new THREE.Mesh(cornerBlockGeo, cornerMat);
      cornerCap.position.set(cx, fh * 0.36, cz);
      cornerCap.castShadow = true;
      cornerCap.receiveShadow = true;
      boardGroup.add(cornerCap);

      // Decorative recessed bolt head on top of each corner bracket
      const rivetGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.03, 16);
      const rivet = new THREE.Mesh(rivetGeo, frameMat);
      rivet.position.set(cx + sx * 0.08, fh * 0.88, cz + sz * 0.08);
      boardGroup.add(rivet);
    });

    // 4. Four Recessed 3D Corner Pockets (Metallic Rim Bezel + Lathe Woven Net Basket)
    const rimMat = new THREE.MeshStandardMaterial({
      color: theme.pocketRimColor,
      metalness: 0.78,
      roughness: 0.25,
    });
    const netMat = new THREE.MeshStandardMaterial({
      color: 0x090706,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    const pocketR = config.pocketRadius;
    const rimTorusGeo = new THREE.TorusGeometry(pocketR * 1.03, 0.026, 12, 36);
    rimTorusGeo.rotateX(Math.PI / 2);

    // Lathe profile for deep pocket basket beneath the corner
    const cupPoints = [
      new THREE.Vector2(0, -0.34),
      new THREE.Vector2(pocketR * 0.72, -0.32),
      new THREE.Vector2(pocketR * 0.96, -0.15),
      new THREE.Vector2(pocketR * 1.02, 0.005),
    ];
    const cupGeo = new THREE.LatheGeometry(cupPoints, 24);

    for (const pk of POCKET_COORDS) {
      const rim = new THREE.Mesh(rimTorusGeo, rimMat);
      rim.position.set(pk.x, 0.012, pk.z);
      rim.receiveShadow = true;
      boardGroup.add(rim);

      const cup = new THREE.Mesh(cupGeo, netMat);
      cup.position.set(pk.x, -0.005, pk.z);
      boardGroup.add(cup);
    }

    // 5. Under-Board Cabinet Base & Grounding Pedestal
    const cabinetGeo = new THREE.BoxGeometry(outerHalf * 2.04, 0.28, outerHalf * 2.04);
    const cabinetMat = new THREE.MeshStandardMaterial({
      color: 0x120a06,
      roughness: 0.75,
      metalness: 0.1,
    });
    const cabinet = new THREE.Mesh(cabinetGeo, cabinetMat);
    cabinet.position.y = -0.28;
    cabinet.receiveShadow = true;
    boardGroup.add(cabinet);

    // Surrounding Studio Table / Floor Plane so board sits naturally in 3D space
    const tableGeo = new THREE.CylinderGeometry(18, 18, 0.1, 48);
    const tableMat = new THREE.MeshStandardMaterial({
      color: theme.roomFloorColor,
      roughness: 0.85,
      metalness: 0.05,
    });
    const tableMesh = new THREE.Mesh(tableGeo, tableMat);
    tableMesh.position.y = -0.47;
    tableMesh.receiveShadow = true;
    boardGroup.add(tableMesh);

    return boardGroup;
  }

  /**
   * Generates a top medallion emblem texture for Carrommen or the Striker
   */
  private static createPieceMedallionTexture(
    type: PieceType,
    theme: BoardThemeSpec
  ): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const c = size / 2;

    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

    const baseHex =
      type === 'WHITE'
        ? hex(theme.whiteCoinBase)
        : type === 'BLACK'
        ? hex(theme.blackCoinBase)
        : type === 'QUEEN'
        ? hex(theme.queenBase)
        : hex(theme.strikerBase);

    const trimHex =
      type === 'WHITE'
        ? hex(theme.whiteCoinTrim)
        : type === 'BLACK'
        ? hex(theme.blackCoinTrim)
        : type === 'QUEEN'
        ? hex(theme.queenTrim)
        : hex(theme.strikerAccent);

    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, size, size);

    // Concentric lathe-turned rings
    ctx.strokeStyle = trimHex;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(c, c, 98, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, 74, 0, Math.PI * 2);
    ctx.stroke();

    // Radial star filigree on Queen & Striker
    const spikes = type === 'STRIKER' ? 12 : type === 'QUEEN' ? 8 : 6;
    ctx.save();
    ctx.translate(c, c);
    for (let i = 0; i < spikes; i++) {
      ctx.rotate((Math.PI * 2) / spikes);
      ctx.beginPath();
      ctx.moveTo(0, 18);
      ctx.lineTo(10, 44);
      ctx.lineTo(0, 68);
      ctx.lineTo(-10, 44);
      ctx.closePath();
      ctx.fillStyle = trimHex;
      ctx.globalAlpha = type === 'STRIKER' || type === 'QUEEN' ? 0.85 : 0.45;
      ctx.fill();
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /**
   * Builds a composite 5-part 3D Carrom Coin (`WHITE`, `BLACK`, or `QUEEN`)
   * pivoted at bottom-center (`y = 0`) so it sits flush on the board surface.
   */
  public static createCoinGroup(
    type: 'WHITE' | 'BLACK' | 'QUEEN',
    themeId: BoardThemeId,
    config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG
  ): THREE.Group {
    const theme = BOARD_THEMES[themeId];
    const group = new THREE.Group();
    const r = config.coinRadius;
    const h = config.coinHeight;

    const baseColor =
      type === 'WHITE'
        ? theme.whiteCoinBase
        : type === 'BLACK'
        ? theme.blackCoinBase
        : theme.queenBase;

    const trimColor =
      type === 'WHITE'
        ? theme.whiteCoinTrim
        : type === 'BLACK'
        ? theme.blackCoinTrim
        : theme.queenTrim;

    // Part 1: Lathe-turned bevelled wooden body with side grip grooves
    const lathePoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r * 0.92, 0),
      new THREE.Vector2(r, h * 0.16),
      new THREE.Vector2(r * 0.98, h * 0.5),
      new THREE.Vector2(r, h * 0.84),
      new THREE.Vector2(r * 0.9, h),
      new THREE.Vector2(r * 0.72, h),
      new THREE.Vector2(r * 0.68, h * 0.88),
      new THREE.Vector2(0, h * 0.88),
    ];
    const bodyGeo = new THREE.LatheGeometry(lathePoints, 32);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: type === 'BLACK' ? 0.34 : 0.26,
      metalness: 0.05,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Part 2: Contrasting metallic/satiny rim ring around upper chamfer
    const rimGeo = new THREE.TorusGeometry(r * 0.81, h * 0.06, 10, 32);
    rimGeo.rotateX(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({
      color: trimColor,
      roughness: type === 'QUEEN' ? 0.2 : 0.52,
      metalness: type === 'QUEEN' ? 0.82 : 0.25,
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = h * 0.96;
    group.add(rimMesh);

    // Part 3: Top Medallion Inlay Disc
    const medallionTex = this.createPieceMedallionTexture(type, theme);
    const discGeo = new THREE.CircleGeometry(r * 0.74, 32);
    discGeo.rotateX(-Math.PI / 2);
    const discMat = new THREE.MeshStandardMaterial({
      map: medallionTex,
      roughness: 0.3,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.position.y = h * 0.9;
    group.add(discMesh);

    // Part 4: Center Raised Ornamental Boss (Golden Crown Stud on Queen)
    const bossGeo = new THREE.CylinderGeometry(r * 0.2, r * 0.24, h * 0.16, 20);
    const bossMesh = new THREE.Mesh(bossGeo, rimMat);
    bossMesh.position.y = h * 0.94;
    group.add(bossMesh);

    // Part 5: Soft Radial Contact Shadow Plane grounded at Y = 0.002
    const shadowGeo = new THREE.PlaneGeometry(r * 2.55, r * 2.55);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.getContactShadowTexture(),
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.y = 0.002;
    group.add(shadowMesh);

    return group;
  }

  /**
   * Builds a composite 5-part 3D Tournament Striker (`THREE.Group`)
   * with high-gloss acrylic body, inset brass weighting ring, mandala inlay, and contact shadow.
   */
  public static createStrikerGroup(
    themeId: BoardThemeId,
    config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG
  ): THREE.Group {
    const theme = BOARD_THEMES[themeId];
    const group = new THREE.Group();
    const r = config.strikerRadius;
    const h = config.strikerHeight;

    // Part 1: Lathe-turned heavy acrylic/ivory body
    const points = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(r * 0.92, 0),
      new THREE.Vector2(r, h * 0.22),
      new THREE.Vector2(r, h * 0.78),
      new THREE.Vector2(r * 0.88, h),
      new THREE.Vector2(0, h),
    ];
    const bodyGeo = new THREE.LatheGeometry(points, 36);
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: theme.strikerBase,
      roughness: 0.14,
      metalness: 0.05,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    group.add(bodyMesh);

    // Part 2: Inset Brushed Brass Weighting Ring
    const brassRingGeo = new THREE.TorusGeometry(r * 0.84, h * 0.075, 12, 36);
    brassRingGeo.rotateX(Math.PI / 2);
    const brassMat = new THREE.MeshStandardMaterial({
      color: theme.cornerAccentColor,
      metalness: 0.88,
      roughness: 0.18,
    });
    const brassRing = new THREE.Mesh(brassRingGeo, brassMat);
    brassRing.position.y = h * 0.97;
    group.add(brassRing);

    // Part 3: Compass Mandala Top Medallion
    const medallionTex = this.createPieceMedallionTexture('STRIKER', theme);
    const topGeo = new THREE.CircleGeometry(r * 0.78, 36);
    topGeo.rotateX(-Math.PI / 2);
    const topMat = new THREE.MeshStandardMaterial({
      map: medallionTex,
      roughness: 0.2,
      metalness: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const topMesh = new THREE.Mesh(topGeo, topMat);
    topMesh.position.y = h + 0.002;
    group.add(topMesh);

    // Part 4: Center Jewel Dome Cap
    const domeGeo = new THREE.SphereGeometry(
      r * 0.18,
      20,
      12,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2
    );
    const domeMat = new THREE.MeshPhysicalMaterial({
      color: theme.strikerAccent,
      roughness: 0.12,
      metalness: 0.3,
      clearcoat: 1.0,
    });
    const domeMesh = new THREE.Mesh(domeGeo, domeMat);
    domeMesh.position.y = h;
    group.add(domeMesh);

    // Part 5: Grounded Contact Shadow
    const shadowGeo = new THREE.PlaneGeometry(r * 2.65, r * 2.65);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.getContactShadowTexture(),
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.y = 0.002;
    group.add(shadowMesh);

    return group;
  }
}
