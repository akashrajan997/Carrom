import { GameMode, PieceType, QueenStatus } from './GameConfig';
import { CarromPhysicsEngine, PhysicsPiece } from './CarromPhysics';

export interface MatchState {
  mode: GameMode;
  currentTurn: 1 | 2;
  p1Score: number;
  p2Score: number;
  whiteRemaining: number;
  blackRemaining: number;
  whitePocketed: number;
  blackPocketed: number;
  queenStatus: QueenStatus;
  p1Debt: number;
  p2Debt: number;
  turnNumber: number;
  lastBannerText: string;
  lastBannerType: 'NEUTRAL' | 'GOOD' | 'QUEEN' | 'FOUL' | 'VICTORY';
  winner: 1 | 2 | null;
  winReason: string;
}

export interface ShotEvaluationResult {
  nextState: MatchState;
  continuedTurn: boolean;
  hadFoul: boolean;
  queenEvent: 'NONE' | 'POCKETED_NEEDS_COVER' | 'COVERED' | 'RETURNED';
  bannerText: string;
  bannerType: 'NEUTRAL' | 'GOOD' | 'QUEEN' | 'FOUL' | 'VICTORY';
}

export class CarromRulesEngine {
  public static createInitialMatchState(mode: GameMode): MatchState {
    return {
      mode,
      currentTurn: 1,
      p1Score: 0,
      p2Score: 0,
      whiteRemaining: 9,
      blackRemaining: 9,
      whitePocketed: 0,
      blackPocketed: 0,
      queenStatus: 'ON_BOARD',
      p1Debt: 0,
      p2Debt: 0,
      turnNumber: 1,
      lastBannerText:
        mode === 'PRACTICE'
          ? 'Practice Table — Pocket any Carromman or test trick shots'
          : 'Player 1 (White) — Break the Center Rack',
      lastBannerType: 'NEUTRAL',
      winner: null,
      winReason: '',
    };
  }

  /**
   * Evaluates a completed shot after all pieces come to rest, mutating `pieces`
   * to return any fouled/uncovered coins to safe center spots and returning the updated MatchState.
   */
  public static evaluateShot(
    prevState: MatchState,
    pocketedThisShot: PieceType[],
    pieces: PhysicsPiece[],
    physics: CarromPhysicsEngine
  ): ShotEvaluationResult {
    const state: MatchState = { ...prevState };
    const player = state.currentTurn;
    const ownType: PieceType = player === 1 ? 'WHITE' : 'BLACK';
    const oppType: PieceType = player === 1 ? 'BLACK' : 'WHITE';

    const strikerPocketed = pocketedThisShot.includes('STRIKER');
    const queenPocketedNow = pocketedThisShot.includes('QUEEN');
    const ownPocketedCount = pocketedThisShot.filter((t) => t === ownType).length;
    const oppPocketedCount = pocketedThisShot.filter((t) => t === oppType).length;

    const wasPendingCover =
      (player === 1 && state.queenStatus === 'PENDING_COVER_P1') ||
      (player === 2 && state.queenStatus === 'PENDING_COVER_P2');

    let hadFoul = false;
    let continuedTurn = false;
    let queenEvent: ShotEvaluationResult['queenEvent'] = 'NONE';
    let bannerText = '';
    let bannerType: ShotEvaluationResult['bannerType'] = 'NEUTRAL';

    // Helper to return an inactive coin of a specific type back to the center of the board
    const returnPieceToBoard = (type: PieceType) => {
      const target = pieces.find((p) => p.type === type && !p.active);
      if (target) {
        const spot = physics.findSafeReturnSpot(pieces, target.id);
        target.active = true;
        target.pocketingProgress = 0;
        target.x = spot.x;
        target.z = spot.z;
        target.vx = 0;
        target.vz = 0;
      }
    };

    // In Practice Mode, simplify rules so player never loses turn unless all coins are cleared
    if (state.mode === 'PRACTICE') {
      if (strikerPocketed) {
        hadFoul = true;
        if (queenPocketedNow) {
          returnPieceToBoard('QUEEN');
          state.queenStatus = 'ON_BOARD';
          queenEvent = 'RETURNED';
        }
        bannerText = 'Striker Scratch — Reposition on Baseline';
        bannerType = 'FOUL';
      } else if (queenPocketedNow) {
        state.queenStatus = 'COVERED_P1';
        queenEvent = 'COVERED';
        bannerText = 'Red Queen Pocketed (+30 pts)';
        bannerType = 'QUEEN';
      } else if (ownPocketedCount + oppPocketedCount > 0) {
        const totalSunk = ownPocketedCount + oppPocketedCount;
        bannerText = `Pocketed ${totalSunk} Coin${totalSunk > 1 ? 's' : ''}`;
        bannerType = 'GOOD';
      } else {
        bannerText = 'Practice Mode — Aim Next Shot';
        bannerType = 'NEUTRAL';
      }

      this.recountBoard(state, pieces);
      if (state.whiteRemaining === 0 && state.blackRemaining === 0 && state.queenStatus !== 'ON_BOARD') {
        state.winner = 1;
        state.winReason = 'Practice Board Cleared!';
        bannerText = 'Practice Board Cleared!';
        bannerType = 'VICTORY';
      }

      state.lastBannerText = bannerText;
      state.lastBannerType = bannerType;
      return {
        nextState: state,
        continuedTurn: true,
        hadFoul,
        queenEvent,
        bannerText,
        bannerType,
      };
    }

    // --- STANDARD ICF COMPETITIVE RULES ---

    // 1. Check Striker Foul ("Due")
    if (strikerPocketed) {
      hadFoul = true;
      continuedTurn = false;

      // If Queen was pocketed on this shot or was pending cover, return Queen to center
      if (queenPocketedNow || wasPendingCover) {
        returnPieceToBoard('QUEEN');
        state.queenStatus = 'ON_BOARD';
        queenEvent = 'RETURNED';
      }

      // Return any own coins pocketed during the foul shot
      for (let i = 0; i < ownPocketedCount; i++) {
        returnPieceToBoard(ownType);
      }

      // Additional 1 penalty coin returned to board (or added to debt if none pocketed)
      const activeOwnOnBoard = pieces.filter((p) => p.type === ownType && p.active).length;
      if (activeOwnOnBoard < 9) {
        returnPieceToBoard(ownType);
        bannerText = `Striker Foul! 1 ${ownType === 'WHITE' ? 'White' : 'Black'} Coin Returned to Center`;
      } else {
        if (player === 1) state.p1Debt++;
        else state.p2Debt++;
        bannerText = `Striker Foul! Penalty Owed (Turn Lost)`;
      }
      bannerType = 'FOUL';
    } else {
      // No striker foul
      // 2. Handle Queen Pending Cover from previous shot
      if (wasPendingCover) {
        if (ownPocketedCount > 0) {
          state.queenStatus = player === 1 ? 'COVERED_P1' : 'COVERED_P2';
          queenEvent = 'COVERED';
          continuedTurn = true;
          bannerText = `Queen Covered by Player ${player}! (+30 Bonus)`;
          bannerType = 'QUEEN';
        } else {
          // Failed to cover Queen -> return Queen to center
          returnPieceToBoard('QUEEN');
          state.queenStatus = 'ON_BOARD';
          queenEvent = 'RETURNED';
          continuedTurn = false;
          bannerText = 'Queen Not Covered — Returned to Center Spot';
          bannerType = 'FOUL';
        }
      }

      // 3. Handle Queen Pocketed on THIS shot
      if (queenPocketedNow) {
        // Count how many own coins are currently off the board
        const totalOwnOffBoard = 9 - pieces.filter((p) => p.type === ownType && p.active).length;
        if (totalOwnOffBoard === 0) {
          // Cannot pocket Queen before pocketing at least one own coin
          returnPieceToBoard('QUEEN');
          state.queenStatus = 'ON_BOARD';
          queenEvent = 'RETURNED';
          continuedTurn = false;
          bannerText = 'Must Pocket a Coin Before Queen — Queen Returned';
          bannerType = 'FOUL';
        } else if (ownPocketedCount > 0) {
          // Sunk Queen AND own coin in the same shot -> Immediately Covered!
          state.queenStatus = player === 1 ? 'COVERED_P1' : 'COVERED_P2';
          queenEvent = 'COVERED';
          continuedTurn = true;
          bannerText = `Combo Shot! Queen Pocketed & Covered (+30 Bonus)`;
          bannerType = 'QUEEN';
        } else {
          // Queen enters Pending Cover state; player gets extra shot to cover
          state.queenStatus = player === 1 ? 'PENDING_COVER_P1' : 'PENDING_COVER_P2';
          queenEvent = 'POCKETED_NEEDS_COVER';
          continuedTurn = true;
          bannerText = `Red Queen Pocketed! Sink a ${ownType === 'WHITE' ? 'White' : 'Black'} Coin Next to Cover`;
          bannerType = 'QUEEN';
        }
      }

      // 4. Normal Coin Pocketing (when no Queen event overrode banner)
      if (!wasPendingCover && !queenPocketedNow) {
        if (ownPocketedCount > 0) {
          continuedTurn = true;
          bannerText =
            ownPocketedCount > 1
              ? `Double Strike! ${ownPocketedCount} ${ownType === 'WHITE' ? 'White' : 'Black'} Coins Pocketed`
              : `${ownType === 'WHITE' ? 'White' : 'Black'} Coin Pocketed — Shoot Again`;
          bannerType = 'GOOD';
        } else if (oppPocketedCount > 0) {
          continuedTurn = false;
          bannerText = `Opponent's Coin Pocketed — Turn Switches`;
          bannerType = 'NEUTRAL';
        } else {
          continuedTurn = false;
        }
      }

      // 5. Pay off any owed penalty debt if own coins were pocketed
      if (ownPocketedCount > 0) {
        if (player === 1 && state.p1Debt > 0) {
          returnPieceToBoard('WHITE');
          state.p1Debt--;
        } else if (player === 2 && state.p2Debt > 0) {
          returnPieceToBoard('BLACK');
          state.p2Debt--;
        }
      }
    }

    // 6. Check ICF Rule: Cannot clear final own coin while Queen is still ON_BOARD
    const ownLeftNow = pieces.filter((p) => p.type === ownType && p.active).length;
    if (ownLeftNow === 0 && state.queenStatus === 'ON_BOARD') {
      returnPieceToBoard(ownType);
      hadFoul = true;
      continuedTurn = false;
      bannerText = 'Foul! Cannot Clear Last Coin While Queen Remains on Board';
      bannerType = 'FOUL';
    }

    // 7. Recount active pieces and scores
    this.recountBoard(state, pieces);

    // 8. Check Game Over condition
    if (state.whiteRemaining === 0 && state.queenStatus !== 'ON_BOARD' && state.queenStatus !== 'PENDING_COVER_P1') {
      state.winner = 1;
      state.winReason = 'Player 1 Cleared All White Coins!';
      bannerText = 'Victory! Player 1 Wins the Championship Board';
      bannerType = 'VICTORY';
      continuedTurn = false;
    } else if (state.blackRemaining === 0 && state.queenStatus !== 'ON_BOARD' && state.queenStatus !== 'PENDING_COVER_P2') {
      state.winner = 2;
      state.winReason =
        state.mode === 'VS_AI' || state.mode === 'QUICK_MATCH'
          ? 'AI Opponent Cleared All Black Coins!'
          : 'Player 2 Cleared All Black Coins!';
      bannerText = state.winReason;
      bannerType = 'VICTORY';
      continuedTurn = false;
    }

    // 9. Advance Turn if not continuing
    if (!state.winner && !continuedTurn) {
      state.currentTurn = state.currentTurn === 1 ? 2 : 1;
      state.turnNumber++;
      if (!bannerText) {
        const nextLabel =
          state.currentTurn === 1
            ? 'Player 1 (White) Turn'
            : state.mode === 'LOCAL_2P'
            ? 'Player 2 (Black) Turn'
            : 'AI Opponent (Black) Thinking...';
        bannerText = nextLabel;
        bannerType = 'NEUTRAL';
      }
    }

    state.lastBannerText = bannerText;
    state.lastBannerType = bannerType;

    return {
      nextState: state,
      continuedTurn,
      hadFoul,
      queenEvent,
      bannerText,
      bannerType,
    };
  }

  private static recountBoard(state: MatchState, pieces: PhysicsPiece[]) {
    let whiteActive = 0;
    let blackActive = 0;

    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.active) continue;
      if (p.type === 'WHITE') whiteActive++;
      else if (p.type === 'BLACK') blackActive++;
    }

    state.whiteRemaining = whiteActive;
    state.blackRemaining = blackActive;
    state.whitePocketed = 9 - whiteActive;
    state.blackPocketed = 9 - blackActive;

    const p1QueenBonus = state.queenStatus === 'COVERED_P1' ? 30 : 0;
    const p2QueenBonus = state.queenStatus === 'COVERED_P2' ? 30 : 0;

    state.p1Score = state.whitePocketed * 10 + p1QueenBonus;
    state.p2Score = state.blackPocketed * 10 + p2QueenBonus;
  }
}
