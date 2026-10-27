import { DEFAULT_PHYSICS_CONFIG, PhysicsConfig, PieceType } from './GameConfig';

export interface PhysicsPiece {
  id: string;
  type: PieceType;
  /** Board X coordinate (-boardHalfSize to +boardHalfSize) */
  x: number;
  /** Board Z coordinate (-boardHalfSize to +boardHalfSize) */
  z: number;
  /** Velocity X */
  vx: number;
  /** Velocity Z */
  vz: number;
  /** Radius in board units */
  radius: number;
  /** Mass in relative units */
  mass: number;
  /** Restitution coefficient */
  restitution: number;
  /** Y-axis visual rotation angle in radians */
  rotation: number;
  /** Angular spin velocity */
  angularVel: number;
  /** True when piece is active on the playing surface */
  active: boolean;
  /** When > 0, piece is animating its drop into a corner pocket (0..1) */
  pocketingProgress: number;
  /** Target pocket coordinates if falling in */
  pocketX: number;
  pocketZ: number;
}

export interface CollisionEvent {
  type: 'PIECE_PIECE' | 'CUSHION' | 'POCKET';
  speed: number;
  involvesStriker: boolean;
  pieceType?: PieceType;
  pieceId?: string;
  x: number;
  z: number;
}

export interface TrajectoryPrediction {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  hitPieceId: string | null;
  hitX: number | null;
  hitZ: number | null;
  targetDeflectX: number | null;
  targetDeflectZ: number | null;
  strikerReboundX: number | null;
  strikerReboundZ: number | null;
}

export const POCKET_COORDS: ReadonlyArray<{ x: number; z: number; id: string }> = [
  { x: -DEFAULT_PHYSICS_CONFIG.pocketOffset, z: -DEFAULT_PHYSICS_CONFIG.pocketOffset, id: 'NW' },
  { x: DEFAULT_PHYSICS_CONFIG.pocketOffset, z: -DEFAULT_PHYSICS_CONFIG.pocketOffset, id: 'NE' },
  { x: -DEFAULT_PHYSICS_CONFIG.pocketOffset, z: DEFAULT_PHYSICS_CONFIG.pocketOffset, id: 'SW' },
  { x: DEFAULT_PHYSICS_CONFIG.pocketOffset, z: DEFAULT_PHYSICS_CONFIG.pocketOffset, id: 'SE' },
];

export class CarromPhysicsEngine {
  public config: PhysicsConfig;
  private accumulator = 0;

  constructor(config: PhysicsConfig = DEFAULT_PHYSICS_CONFIG) {
    this.config = { ...config };
  }

  /**
   * Creates the regulation 19 carrom pieces (9 White, 9 Black, 1 Red Queen)
   * packed in a tight hexagonal tournament rack at the center of the board,
   * plus the Striker placed on the active player's baseline.
   */
  public createInitialRack(startingPlayer: 1 | 2 = 1): PhysicsPiece[] {
    const pieces: PhysicsPiece[] = [];
    const r = this.config.coinRadius;
    const spacing = r * 2.03; // Slight clearance to avoid initial overlap impulse

    // 1. Center Red Queen
    pieces.push({
      id: 'queen',
      type: 'QUEEN',
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      radius: r,
      mass: this.config.coinMass,
      restitution: this.config.coinRestitution,
      rotation: 0,
      angularVel: 0,
      active: true,
      pocketingProgress: 0,
      pocketX: 0,
      pocketZ: 0,
    });

    // 2. Inner ring of 6 coins alternating White and Black
    let whiteCount = 0;
    let blackCount = 0;

    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - Math.PI / 2;
      const isWhite = i % 2 === 0;
      const type: PieceType = isWhite ? 'WHITE' : 'BLACK';
      if (isWhite) whiteCount++;
      else blackCount++;

      pieces.push({
        id: `${type.toLowerCase()}_${isWhite ? whiteCount : blackCount}`,
        type,
        x: Math.cos(angle) * spacing,
        z: Math.sin(angle) * spacing,
        vx: 0,
        vz: 0,
        radius: r,
        mass: this.config.coinMass,
        restitution: this.config.coinRestitution,
        rotation: angle,
        angularVel: 0,
        active: true,
        pocketingProgress: 0,
        pocketX: 0,
        pocketZ: 0,
      });
    }

    // 3. Outer ring of 12 coins (6 White, 6 Black in standard ICF pattern)
    const outerRadiusEven = spacing * 2;
    const outerRadiusOdd = spacing * Math.sqrt(3);

    for (let i = 0; i < 12; i++) {
      const angle = (i * Math.PI) / 6 - Math.PI / 2;
      const dist = i % 2 === 0 ? outerRadiusEven : outerRadiusOdd;
      // In ICF rack, corner points (even indices) are White/Black alternating so 9 total each
      let isWhite: boolean;
      if (i % 2 === 0) {
        isWhite = (i / 2) % 2 === 0;
      } else {
        isWhite = ((i - 1) / 2) % 2 === 1;
      }
      // Adjust if count exceeds 9
      if (isWhite && whiteCount >= 9) isWhite = false;
      else if (!isWhite && blackCount >= 9) isWhite = true;

      const type: PieceType = isWhite ? 'WHITE' : 'BLACK';
      if (isWhite) whiteCount++;
      else blackCount++;

      pieces.push({
        id: `${type.toLowerCase()}_${isWhite ? whiteCount : blackCount}`,
        type,
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        vx: 0,
        vz: 0,
        radius: r,
        mass: this.config.coinMass,
        restitution: this.config.coinRestitution,
        rotation: angle * 1.5,
        angularVel: 0,
        active: true,
        pocketingProgress: 0,
        pocketX: 0,
        pocketZ: 0,
      });
    }

    // 4. Striker on starting player's baseline
    const baselineZ = startingPlayer === 1 ? this.config.baselineZ : -this.config.baselineZ;
    pieces.push({
      id: 'striker',
      type: 'STRIKER',
      x: 0,
      z: baselineZ,
      vx: 0,
      vz: 0,
      radius: this.config.strikerRadius,
      mass: this.config.strikerMass,
      restitution: this.config.strikerRestitution,
      rotation: 0,
      angularVel: 0,
      active: true,
      pocketingProgress: 0,
      pocketX: 0,
      pocketZ: 0,
    });

    return pieces;
  }

  /**
   * Resets accumulator when starting a new turn or shot
   */
  public resetAccumulator() {
    this.accumulator = 0;
  }

  /**
   * Checks if any piece is still moving or falling into a pocket
   */
  public arePiecesMoving(pieces: PhysicsPiece[]): boolean {
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (p.pocketingProgress > 0 && p.pocketingProgress < 1) {
        return true;
      }
      if (p.active && (Math.abs(p.vx) > 0 || Math.abs(p.vz) > 0)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks whether placing the striker at (x, baselineZ) overlaps any active coin
   */
  public isStrikerPositionValid(pieces: PhysicsPiece[], x: number, z: number): boolean {
    const halfLen = this.config.baselineHalfLength;
    if (x < -halfLen - 0.001 || x > halfLen + 0.001) return false;

    const strikerR = this.config.strikerRadius;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.active || p.type === 'STRIKER') continue;
      const dx = p.x - x;
      const dz = p.z - z;
      const minDist = strikerR + p.radius + 0.015;
      if (dx * dx + dz * dz < minDist * minDist) {
        return false;
      }
    }
    return true;
  }

  /**
   * Finds the nearest valid non-overlapping X coordinate on the player's baseline
   */
  public findValidStrikerX(pieces: PhysicsPiece[], preferredX: number, baselineZ: number): number {
    const clamped = Math.max(
      -this.config.baselineHalfLength,
      Math.min(this.config.baselineHalfLength, preferredX)
    );
    if (this.isStrikerPositionValid(pieces, clamped, baselineZ)) {
      return clamped;
    }

    const step = 0.05;
    for (let offset = step; offset <= this.config.baselineHalfLength * 2; offset += step) {
      const right = clamped + offset;
      if (
        right <= this.config.baselineHalfLength &&
        this.isStrikerPositionValid(pieces, right, baselineZ)
      ) {
        return right;
      }
      const left = clamped - offset;
      if (
        left >= -this.config.baselineHalfLength &&
        this.isStrikerPositionValid(pieces, left, baselineZ)
      ) {
        return left;
      }
    }
    return clamped;
  }

  /**
   * Finds a safe non-overlapping coordinate near the center circle to return penalty/Queen coins
   */
  public findSafeReturnSpot(pieces: PhysicsPiece[], excludeId?: string): { x: number; z: number } {
    const coinR = this.config.coinRadius;
    const isSpotFree = (tx: number, tz: number) => {
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (!p.active || p.id === excludeId) continue;
        const dx = p.x - tx;
        const dz = p.z - tz;
        const minD = p.radius + coinR + 0.02;
        if (dx * dx + dz * dz < minD * minD) return false;
      }
      return true;
    };

    if (isSpotFree(0, 0)) {
      return { x: 0, z: 0 };
    }

    // Spiral outward from center (0,0)
    for (let ring = 1; ring <= 20; ring++) {
      const radius = ring * (coinR * 1.15);
      const steps = Math.max(8, ring * 6);
      for (let s = 0; s < steps; s++) {
        const angle = (s / steps) * Math.PI * 2;
        const tx = Math.cos(angle) * radius;
        const tz = Math.sin(angle) * radius;
        if (Math.abs(tx) < 2.2 && Math.abs(tz) < 2.2 && isSpotFree(tx, tz)) {
          return { x: tx, z: tz };
        }
      }
    }

    return { x: 0, z: 0 };
  }

  /**
   * Advances the physics simulation by frame delta time using fixed timesteps
   */
  public update(
    pieces: PhysicsPiece[],
    deltaSeconds: number,
    onEvent?: (ev: CollisionEvent) => void
  ): PhysicsPiece[] {
    const clampedDt = Math.min(deltaSeconds, 0.05);
    this.accumulator += clampedDt;

    const dt = this.config.fixedTimeStep;
    let steps = 0;

    while (this.accumulator >= dt && steps < this.config.maxSubSteps) {
      this.stepSimulation(pieces, dt, onEvent);
      this.accumulator -= dt;
      steps++;
    }

    return pieces;
  }

  private stepSimulation(
    pieces: PhysicsPiece[],
    dt: number,
    onEvent?: (ev: CollisionEvent) => void
  ) {
    const halfBoard = this.config.boardHalfSize;
    const pocketR = this.config.pocketRadius;
    const friction = this.config.surfaceFriction;
    const damping = Math.pow(this.config.velocityDamping, dt * 60);

    // 1. Update pocketing animations and positions
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];

      if (p.pocketingProgress > 0 && p.pocketingProgress < 1) {
        p.pocketingProgress = Math.min(1, p.pocketingProgress + dt * 4.5);
        p.x += (p.pocketX - p.x) * Math.min(1, dt * 14);
        p.z += (p.pocketZ - p.z) * Math.min(1, dt * 14);
        p.rotation += dt * 8;
        continue;
      }

      if (!p.active) continue;

      const speedSq = p.vx * p.vx + p.vz * p.vz;
      if (speedSq > 0) {
        const speed = Math.sqrt(speedSq);

        // Integrate position
        p.x += p.vx * dt;
        p.z += p.vz * dt;

        // Visual spin proportional to travel
        p.rotation += p.angularVel * dt;
        p.angularVel *= 0.98;

        // Apply surface kinetic friction + air damping
        const decel = friction * dt;
        const newSpeed = Math.max(0, speed * damping - decel);

        if (newSpeed < this.config.stopVelocityThreshold) {
          p.vx = 0;
          p.vz = 0;
          p.angularVel = 0;
        } else {
          const ratio = newSpeed / speed;
          p.vx *= ratio;
          p.vz *= ratio;
        }
      }
    }

    // 2. Pocket detection & rim gravity well
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.active) continue;

      for (let k = 0; k < POCKET_COORDS.length; k++) {
        const pocket = POCKET_COORDS[k];
        const dx = pocket.x - p.x;
        const dz = pocket.z - p.z;
        const distSq = dx * dx + dz * dz;
        const dist = Math.sqrt(distSq);

        // Capture threshold: if center is well within pocket mouth
        const captureRadius = pocketR - p.radius * 0.18;
        if (dist < captureRadius) {
          p.active = false;
          p.vx = 0;
          p.vz = 0;
          p.pocketingProgress = 0.02;
          p.pocketX = pocket.x;
          p.pocketZ = pocket.z;
          onEvent?.({
            type: 'POCKET',
            speed: 1,
            involvesStriker: p.type === 'STRIKER',
            pieceType: p.type,
            pieceId: p.id,
            x: pocket.x,
            z: pocket.z,
          });
          break;
        } else if (dist < pocketR + p.radius * 0.35 && dist > 0.0001) {
          // Subtle bevel lip attraction toward pocket center
          const pull = 3.6 * dt;
          p.vx += (dx / dist) * pull;
          p.vz += (dz / dist) * pull;
        }
      }
    }

    // 3. Board Cushion / Boundary Rebounds
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.active) continue;

      // Skip wall bounce if right inside a corner pocket mouth
      let nearPocket = false;
      for (let k = 0; k < POCKET_COORDS.length; k++) {
        const pk = POCKET_COORDS[k];
        const dx = pk.x - p.x;
        const dz = pk.z - p.z;
        if (dx * dx + dz * dz < (pocketR * 1.08) ** 2) {
          nearPocket = true;
          break;
        }
      }
      if (nearPocket) continue;

      const limit = halfBoard - p.radius;
      let hitWall = false;
      let impactSpeed = 0;

      if (p.x < -limit) {
        p.x = -limit;
        impactSpeed = Math.abs(p.vx);
        p.vx = Math.abs(p.vx) * this.config.wallRestitution;
        p.angularVel = -p.vz * 1.5;
        hitWall = true;
      } else if (p.x > limit) {
        p.x = limit;
        impactSpeed = Math.abs(p.vx);
        p.vx = -Math.abs(p.vx) * this.config.wallRestitution;
        p.angularVel = p.vz * 1.5;
        hitWall = true;
      }

      if (p.z < -limit) {
        p.z = -limit;
        impactSpeed = Math.max(impactSpeed, Math.abs(p.vz));
        p.vz = Math.abs(p.vz) * this.config.wallRestitution;
        p.angularVel = p.vx * 1.5;
        hitWall = true;
      } else if (p.z > limit) {
        p.z = limit;
        impactSpeed = Math.max(impactSpeed, Math.abs(p.vz));
        p.vz = -Math.abs(p.vz) * this.config.wallRestitution;
        p.angularVel = -p.vx * 1.5;
        hitWall = true;
      }

      if (hitWall && impactSpeed > 0.35) {
        onEvent?.({
          type: 'CUSHION',
          speed: impactSpeed,
          involvesStriker: p.type === 'STRIKER',
          x: p.x,
          z: p.z,
        });
      }
    }

    // 4. Pairwise Circle-to-Circle Collision Detection & Impulse Resolution
    // Run 2 positional relaxation iterations to guarantee zero overlap/tunneling in dense clusters
    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < pieces.length; i++) {
        const a = pieces[i];
        if (!a.active) continue;

        for (let j = i + 1; j < pieces.length; j++) {
          const b = pieces[j];
          if (!b.active) continue;

          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const minDist = a.radius + b.radius;
          const distSq = dx * dx + dz * dz;

          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            // Normal vector from A to B
            const nx = dist > 0.00001 ? dx / dist : 1;
            const nz = dist > 0.00001 ? dz / dist : 0;

            // Positional overlap correction weighted by inverse mass
            const overlap = minDist - dist;
            const invMassA = 1 / a.mass;
            const invMassB = 1 / b.mass;
            const totalInvMass = invMassA + invMassB;

            const correction = (overlap / totalInvMass) * 0.92;
            a.x -= nx * correction * invMassA;
            a.z -= nz * correction * invMassA;
            b.x += nx * correction * invMassB;
            b.z += nz * correction * invMassB;

            // Relative velocity along normal
            const rvx = b.vx - a.vx;
            const rvz = b.vz - a.vz;
            const velAlongNormal = rvx * nx + rvz * nz;

            // Only resolve velocity impulse if moving toward each other
            if (velAlongNormal < 0) {
              const e = Math.min(a.restitution, b.restitution);
              const jImpulse = (-(1 + e) * velAlongNormal) / totalInvMass;

              const impulseX = jImpulse * nx;
              const impulseZ = jImpulse * nz;

              a.vx -= impulseX * invMassA;
              a.vz -= impulseZ * invMassA;
              b.vx += impulseX * invMassB;
              b.vz += impulseZ * invMassB;

              // Tangential spin transfer
              const tx = -nz;
              const tz = nx;
              const tangentSpeed = rvx * tx + rvz * tz;
              a.angularVel += tangentSpeed * 1.8;
              b.angularVel -= tangentSpeed * 1.8;

              if (iter === 0 && Math.abs(velAlongNormal) > 0.25) {
                onEvent?.({
                  type: 'PIECE_PIECE',
                  speed: Math.abs(velAlongNormal),
                  involvesStriker: a.type === 'STRIKER' || b.type === 'STRIKER',
                  x: (a.x + b.x) * 0.5,
                  z: (a.z + b.z) * 0.5,
                });
              }
            }
          }
        }
      }
    }
  }

  /**
   * Analytical ray-circle + wall intersection for real-time aiming trajectory preview
   */
  public predictTrajectory(
    pieces: PhysicsPiece[],
    startX: number,
    startZ: number,
    dirX: number,
    dirZ: number
  ): TrajectoryPrediction {
    const strikerR = this.config.strikerRadius;
    const limit = this.config.boardHalfSize - strikerR;

    // Normalize direction
    const len = Math.hypot(dirX, dirZ);
    if (len < 0.0001) {
      return {
        startX,
        startZ,
        endX: startX,
        endZ: startZ,
        hitPieceId: null,
        hitX: null,
        hitZ: null,
        targetDeflectX: null,
        targetDeflectZ: null,
        strikerReboundX: null,
        strikerReboundZ: null,
      };
    }
    const ndx = dirX / len;
    const ndz = dirZ / len;

    // 1. Find distance to board boundaries
    let minT = 12.0;
    let wallNormalX = 0;
    let wallNormalZ = 0;

    if (Math.abs(ndx) > 0.0001) {
      const tx = ndx > 0 ? (limit - startX) / ndx : (-limit - startX) / ndx;
      if (tx > 0 && tx < minT) {
        minT = tx;
        wallNormalX = ndx > 0 ? -1 : 1;
        wallNormalZ = 0;
      }
    }
    if (Math.abs(ndz) > 0.0001) {
      const tz = ndz > 0 ? (limit - startZ) / ndz : (-limit - startZ) / ndz;
      if (tz > 0 && tz < minT) {
        minT = tz;
        wallNormalX = 0;
        wallNormalZ = ndz > 0 ? -1 : 1;
      }
    }

    // 2. Check earliest intersection with any active coin
    let hitPiece: PhysicsPiece | null = null;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.active || p.type === 'STRIKER') continue;

      const combinedR = strikerR + p.radius;
      const ox = p.x - startX;
      const oz = p.z - startZ;
      const proj = ox * ndx + oz * ndz;
      if (proj <= 0) continue;

      const perpSq = ox * ox + oz * oz - proj * proj;
      const combinedRSq = combinedR * combinedR;
      if (perpSq < combinedRSq) {
        const thc = Math.sqrt(combinedRSq - perpSq);
        const tHit = proj - thc;
        if (tHit > 0 && tHit < minT) {
          minT = tHit;
          hitPiece = p;
        }
      }
    }

    const endX = startX + ndx * minT;
    const endZ = startZ + ndz * minT;

    if (hitPiece) {
      // Calculate coin deflection normal (from striker center at impact to coin center)
      const cx = hitPiece.x - endX;
      const cz = hitPiece.z - endZ;
      const cLen = Math.hypot(cx, cz) || 1;
      const cnx = cx / cLen;
      const cnz = cz / cLen;

      // Target coin travels along (cnx, cnz)
      const targetDeflectX = hitPiece.x + cnx * 1.45;
      const targetDeflectZ = hitPiece.z + cnz * 1.45;

      // Striker deflects along tangent
      const dot = ndx * cnx + ndz * cnz;
      const sdx = ndx - cnx * dot * 0.85;
      const sdz = ndz - cnz * dot * 0.85;
      const sLen = Math.hypot(sdx, sdz) || 1;

      return {
        startX,
        startZ,
        endX,
        endZ,
        hitPieceId: hitPiece.id,
        hitX: endX,
        hitZ: endZ,
        targetDeflectX,
        targetDeflectZ,
        strikerReboundX: endX + (sdx / sLen) * 0.95,
        strikerReboundZ: endZ + (sdz / sLen) * 0.95,
      };
    }

    // Cushion bounce reflection preview
    const rdx = wallNormalX !== 0 ? -ndx : ndx;
    const rdz = wallNormalZ !== 0 ? -ndz : ndz;

    return {
      startX,
      startZ,
      endX,
      endZ,
      hitPieceId: null,
      hitX: endX,
      hitZ: endZ,
      targetDeflectX: null,
      targetDeflectZ: null,
      strikerReboundX: endX + rdx * 1.2,
      strikerReboundZ: endZ + rdz * 1.2,
    };
  }
}
