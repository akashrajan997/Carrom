import { AIDifficulty, QueenStatus } from './GameConfig';
import { CarromPhysicsEngine, POCKET_COORDS, PhysicsPiece } from './CarromPhysics';

export interface AIShotDecision {
  strikerX: number;
  dirX: number;
  dirZ: number;
  speed: number;
  targetDescription: string;
}

export class CarromAI {
  /**
   * Computes a physics-legal shot from the North baseline (z = -baselineZ)
   * for Player 2 (BLACK coins). Never teleports coins or cheats physics.
   */
  public static computeBestShot(
    pieces: PhysicsPiece[],
    physics: CarromPhysicsEngine,
    difficulty: AIDifficulty,
    queenStatus: QueenStatus
  ): AIShotDecision {
    const baselineZ = -physics.config.baselineZ;
    const halfLen = physics.config.baselineHalfLength;
    const coinR = physics.config.coinRadius;
    const strikerR = physics.config.strikerRadius;
    const contactDist = coinR + strikerR;

    // Collect candidate targets: Black coins, plus Queen if eligible or pending cover
    const blackCoins = pieces.filter((p) => p.active && p.type === 'BLACK');
    const queenPiece = pieces.find((p) => p.active && p.type === 'QUEEN');

    const canTargetQueen =
      queenPiece &&
      queenStatus === 'ON_BOARD' &&
      blackCoins.length < 9 && // At least 1 black coin already pocketed
      blackCoins.length >= 1;

    const targets: PhysicsPiece[] = [...blackCoins];
    if (canTargetQueen && queenPiece) {
      targets.unshift(queenPiece);
    }

    // Fallback if no targets found
    if (targets.length === 0 && queenPiece) {
      targets.push(queenPiece);
    }

    // Number of baseline candidate positions to evaluate based on difficulty
    const candidateSteps = difficulty === 'HARD' ? 42 : difficulty === 'MEDIUM' ? 24 : 13;

    let bestScore = -Infinity;
    let bestDecision: AIShotDecision | null = null;

    // Helper: check if a straight corridor from (x1,z1) to (x2,z2) of radius `clearance` is obstructed
    const countObstructions = (
      x1: number,
      z1: number,
      x2: number,
      z2: number,
      clearance: number,
      ignoreIds: Set<string>
    ): number => {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.001) return 0;
      const ux = dx / segLen;
      const uz = dz / segLen;

      let count = 0;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i];
        if (!p.active || p.type === 'STRIKER' || ignoreIds.has(p.id)) continue;
        const px = p.x - x1;
        const pz = p.z - z1;
        const proj = px * ux + pz * uz;
        if (proj <= 0.02 || proj >= segLen - 0.02) continue;
        const perpSq = px * px + pz * pz - proj * proj;
        const minR = clearance + p.radius;
        if (perpSq < minR * minR) {
          count++;
        }
      }
      return count;
    };

    for (let s = 0; s <= candidateSteps; s++) {
      const rawX = -halfLen + (s / candidateSteps) * (halfLen * 2);
      if (!physics.isStrikerPositionValid(pieces, rawX, baselineZ)) continue;

      for (const target of targets) {
        for (const pocket of POCKET_COORDS) {
          // Vector from target coin to pocket center
          const toPocketX = pocket.x - target.x;
          const toPocketZ = pocket.z - target.z;
          const distCoinToPocket = Math.hypot(toPocketX, toPocketZ);
          if (distCoinToPocket < 0.05) continue;

          const pDirX = toPocketX / distCoinToPocket;
          const pDirZ = toPocketZ / distCoinToPocket;

          // Ghost striker impact position needed to drive `target` along (pDirX, pDirZ)
          const ghostX = target.x - pDirX * contactDist;
          const ghostZ = target.z - pDirZ * contactDist;

          // Vector from striker on baseline to ghost impact point
          const strikeDx = ghostX - rawX;
          const strikeDz = ghostZ - baselineZ;
          const distStrikerToGhost = Math.hypot(strikeDx, strikeDz);
          if (distStrikerToGhost < 0.1) continue;

          const sDirX = strikeDx / distStrikerToGhost;
          const sDirZ = strikeDz / distStrikerToGhost;

          // Cut angle cosine: dot product between striker travel and coin-to-pocket vector
          const cutCos = sDirX * pDirX + sDirZ * pDirZ;
          // If cutCos <= 0.18, the cut is physically impossible or too thin (< ~79 deg)
          if (cutCos <= 0.22) continue;

          const ignore = new Set<string>([target.id]);
          const strikerPathBlocks = countObstructions(
            rawX,
            baselineZ,
            ghostX,
            ghostZ,
            strikerR * 0.96,
            ignore
          );
          const coinPathBlocks = countObstructions(
            target.x,
            target.z,
            pocket.x,
            pocket.z,
            coinR * 0.95,
            ignore
          );

          // Score this candidate shot
          let score = 100;
          // Prefer straighter shots (higher cutCos)
          score += cutCos * 65;
          // Prefer shorter coin-to-pocket and striker-to-coin distances
          score -= distCoinToPocket * 7.5;
          score -= distStrikerToGhost * 4.0;

          // Penalize obstructions heavily
          score -= strikerPathBlocks * 85;
          score -= coinPathBlocks * 75;

          // Prioritize Queen when eligible or cover shot when pending
          if (target.type === 'QUEEN') {
            score += difficulty === 'HARD' ? 42 : 25;
          }
          if (queenStatus === 'PENDING_COVER_P2' && target.type === 'BLACK') {
            score += 50;
          }

          // Prefer forward shots into South pockets (+Z) over tricky backward cuts unless unobstructed
          if (sDirZ > 0.1) {
            score += 12;
          }

          // Calibrate ideal speed based on distance and cut angle
          const baseSpeed =
            6.8 +
            (distStrikerToGhost + distCoinToPocket) * 0.85 +
            (1 - cutCos) * 3.2;
          const clampedSpeed = Math.min(
            physics.config.maxShotSpeed * 0.92,
            Math.max(5.5, baseSpeed)
          );

          if (score > bestScore) {
            bestScore = score;
            bestDecision = {
              strikerX: rawX,
              dirX: sDirX,
              dirZ: sDirZ,
              speed: clampedSpeed,
              targetDescription:
                target.type === 'QUEEN'
                  ? `Targeting Red Queen to ${pocket.id} Pocket`
                  : `Targeting Black Coin to ${pocket.id} Pocket`,
            };
          }
        }
      }
    }

    // Fallback cluster / center break shot if all pockets are heavily blocked
    if (!bestDecision) {
      const validX = physics.findValidStrikerX(pieces, 0.15, baselineZ);
      const target = targets[0] || { x: 0, z: 0 };
      const dx = target.x - validX;
      const dz = target.z - baselineZ;
      const len = Math.hypot(dx, dz) || 1;
      bestDecision = {
        strikerX: validX,
        dirX: dx / len,
        dirZ: dz / len,
        speed: 12.5,
        targetDescription: 'Power Break Shot',
      };
    }

    // Apply difficulty-calibrated angular & speed imperfection
    const angleSpreadDeg =
      difficulty === 'EASY' ? 4.2 : difficulty === 'MEDIUM' ? 1.35 : 0.22;
    const angleErrorRad =
      ((Math.random() - 0.5) * 2 * angleSpreadDeg * Math.PI) / 180;

    const cosE = Math.cos(angleErrorRad);
    const sinE = Math.sin(angleErrorRad);
    const finalDirX = bestDecision.dirX * cosE - bestDecision.dirZ * sinE;
    const finalDirZ = bestDecision.dirX * sinE + bestDecision.dirZ * cosE;

    const speedJitter =
      difficulty === 'EASY'
        ? 0.88 + Math.random() * 0.24
        : difficulty === 'MEDIUM'
        ? 0.95 + Math.random() * 0.1
        : 0.99 + Math.random() * 0.02;

    return {
      strikerX: bestDecision.strikerX,
      dirX: finalDirX,
      dirZ: finalDirZ,
      speed: Math.min(
        physics.config.maxShotSpeed,
        bestDecision.speed * speedJitter
      ),
      targetDescription: bestDecision.targetDescription,
    };
  }
}
