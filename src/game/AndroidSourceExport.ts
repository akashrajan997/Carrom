export interface AndroidSourceFile {
  filename: string;
  packagePath: string;
  description: string;
  code: string;
}

export const ANDROID_KOTLIN_SOURCES: AndroidSourceFile[] = [
  {
    filename: 'MainActivity.kt',
    packagePath: 'com.carromroyale.game/MainActivity.kt',
    description: 'Jetpack Compose Activity hosting GLSurfaceView + Material 3 HUD & Lifecycle management',
    code: `package com.carromroyale.game

import android.opengl.GLSurfaceView
import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.carromroyale.game.engine.*
import com.carromroyale.game.gl.CarromGLRenderer

class MainActivity : ComponentActivity() {
    private var glSurfaceView: GLSurfaceView? = null
    private lateinit var gameController: CarromGameController

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        gameController = CarromGameController(applicationContext)

        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                CarromGameScreen(
                    controller = gameController,
                    onSurfaceCreated = { view -> glSurfaceView = view }
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        glSurfaceView?.onResume()
    }

    override fun onPause() {
        glSurfaceView?.onPause()
        gameController.pauseGame()
        super.onPause()
    }
}

@Composable
fun CarromGameScreen(
    controller: CarromGameController,
    onSurfaceCreated: (GLSurfaceView) -> Unit
) {
    val uiState by controller.uiState.collectAsState()

    Box(modifier = Modifier.fillMaxSize().background(Color(0xFF0C0A08))) {
        // Dedicated OpenGL ES 3.0 Surface independent of Compose recomposition
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                GLSurfaceView(ctx).apply {
                    setEGLContextClientVersion(3)
                    preserveEGLContextOnPause = true
                    val renderer = CarromGLRenderer(controller)
                    setRenderer(renderer)
                    renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
                    setOnTouchListener { _, event ->
                        controller.onTouchEvent(event, width.toFloat(), height.toFloat())
                        true
                    }
                    onSurfaceCreated(this)
                }
            }
        )

        // Low-occlusion Top Scoreboard & Bottom Striker Control Dock
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            TopScoreBar(uiState = uiState, onCameraToggle = { controller.cycleCamera() })
            BottomStrikerBar(
                strikerX = uiState.strikerNormalizedX,
                enabled = uiState.canPositionStriker,
                onStrikerSlide = { normX -> controller.setStrikerNormalizedX(normX) }
            )
        }
    }
}`,
  },
  {
    filename: 'CarromGLRenderer.kt',
    packagePath: 'com.carromroyale.game.gl/CarromGLRenderer.kt',
    description: 'OpenGL ES 3.0 PBR shader pipeline, VAO/VBO mesh buffers, lighting & fixed-step sync',
    code: `package com.carromroyale.game.gl

import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.SystemClock
import com.carromroyale.game.engine.CarromGameController
import com.carromroyale.game.engine.PieceType
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

class CarromGLRenderer(
    private val controller: CarromGameController
) : GLSurfaceView.Renderer {

    private val camera = Camera3D()
    private lateinit var shaderProgram: BlinnPhongShaderProgram
    private lateinit var boardMesh: GlMesh
    private lateinit var frameMesh: GlMesh
    private lateinit var coinMesh: GlMesh
    private lateinit var strikerMesh: GlMesh
    private lateinit var aimLineMesh: DynamicLineMesh

    private val vpMatrix = FloatArray(16)
    private val modelMatrix = FloatArray(16)
    private var lastFrameTimeNs = 0L

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES30.glClearColor(0.05f, 0.04f, 0.03f, 1.0f)
        GLES30.glEnable(GLES30.GL_DEPTH_TEST)
        GLES30.glEnable(GLES30.GL_CULL_FACE)

        shaderProgram = BlinnPhongShaderProgram()
        boardMesh = MeshFactory.createBoardSurfaceMesh()
        frameMesh = MeshFactory.createBevelledFrameMesh()
        coinMesh = MeshFactory.createLatheCoinMesh(radius = 0.158f, height = 0.082f)
        strikerMesh = MeshFactory.createLatheCoinMesh(radius = 0.208f, height = 0.105f)
        aimLineMesh = DynamicLineMesh()

        lastFrameTimeNs = SystemClock.elapsedRealtimeNanos()
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        GLES30.glViewport(0, 0, width, height)
        camera.setAspect(width.toFloat() / height.toFloat().coerceAtLeast(1f))
    }

    override fun onDrawFrame(gl: GL10?) {
        val nowNs = SystemClock.elapsedRealtimeNanos()
        val rawDt = ((nowNs - lastFrameTimeNs) / 1_000_000_000f).coerceIn(0f, 0.05f)
        lastFrameTimeNs = nowNs

        // Step deterministic 120Hz physics & smooth camera damping
        controller.stepFrame(rawDt)
        camera.update(rawDt, controller.currentCameraPreset, controller.activeTurn)
        camera.computeViewProjection(vpMatrix)

        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
        shaderProgram.use()
        shaderProgram.setLightAndCamera(
            lightPos = floatArrayOf(3.5f, 9.5f, 4.0f),
            eyePos = camera.position
        )

        // 1. Draw 3D Board Surface & Bevelled Hardwood Frame
        Matrix.setIdentityM(modelMatrix, 0)
        shaderProgram.drawMesh(boardMesh, vpMatrix, modelMatrix, controller.theme.surfaceColor)
        shaderProgram.drawMesh(frameMesh, vpMatrix, modelMatrix, controller.theme.frameColor)

        // 2. Draw All Active 3D Carrommen & Striker
        val pieces = controller.piecesSnapshot
        for (i in pieces.indices) {
            val p = pieces[i]
            if (!p.active && p.pocketingProgress >= 1f) continue
            Matrix.setIdentityM(modelMatrix, 0)
            val yDrop = -p.pocketingProgress * 0.22f
            Matrix.translateM(modelMatrix, 0, p.x, yDrop, p.z)
            Matrix.rotateM(modelMatrix, 0, Math.toDegrees(p.rotation.toDouble()).toFloat(), 0f, 1f, 0f)

            val mesh = if (p.type == PieceType.STRIKER) strikerMesh else coinMesh
            val color = controller.theme.colorForPiece(p.type)
            shaderProgram.drawMesh(mesh, vpMatrix, modelMatrix, color)
        }
    }
}`,
  },
  {
    filename: 'CarromPhysics.kt',
    packagePath: 'com.carromroyale.game.engine/CarromPhysics.kt',
    description: 'Fixed-timestep 120Hz 2D board-space collision & pocket resolution synchronized with 3D visuals',
    code: `package com.carromroyale.game.engine

import kotlin.math.*

data class PhysicsConfig(
    val boardHalfSize: Float = 3.7f,
    val coinRadius: Float = 0.158f,
    val strikerRadius: Float = 0.208f,
    val pocketRadius: Float = 0.248f,
    val pocketOffset: Float = 3.43f,
    val baselineZ: Float = 2.68f,
    val baselineHalfLength: Float = 2.15f,
    val coinMass: Float = 1.0f,
    val strikerMass: Float = 2.75f,
    val coinRestitution: Float = 0.88f,
    val wallRestitution: Float = 0.83f,
    val surfaceFriction: Float = 2.15f,
    val velocityDamping: Float = 0.985f,
    val stopVelocityThreshold: Float = 0.035f,
    val fixedTimeStep: Float = 1f / 120f
)

class CarromPhysics(val config: PhysicsConfig = PhysicsConfig()) {
    private var accumulator = 0f

    fun update(pieces: List<PhysicsPiece>, deltaSeconds: Float, onEvent: (CollisionEvent) -> Unit) {
        accumulator += deltaSeconds.coerceAtMost(0.05f)
        var subSteps = 0
        while (accumulator >= config.fixedTimeStep && subSteps < 10) {
            stepSimulation(pieces, config.fixedTimeStep, onEvent)
            accumulator -= config.fixedTimeStep
            subSteps++
        }
    }

    private fun stepSimulation(
        pieces: List<PhysicsPiece>,
        dt: Float,
        onEvent: (CollisionEvent) -> Unit
    ) {
        val damping = config.velocityDamping.pow(dt * 60f)

        // 1. Integrate velocity & apply kinetic surface friction
        for (p in pieces) {
            if (!p.active) continue
            val speed = hypot(p.vx, p.vz)
            if (speed > 0f) {
                p.x += p.vx * dt
                p.z += p.vz * dt
                val nextSpeed = max(0f, speed * damping - config.surfaceFriction * dt)
                if (nextSpeed < config.stopVelocityThreshold) {
                    p.vx = 0f
                    p.vz = 0f
                } else {
                    val scale = nextSpeed / speed
                    p.vx *= scale
                    p.vz *= scale
                }
            }
        }

        // 2. Pairwise elastic collision & positional overlap correction
        for (iter in 0 until 2) {
            for (i in 0 until pieces.size) {
                val a = pieces[i]
                if (!a.active) continue
                for (j in i + 1 until pieces.size) {
                    val b = pieces[j]
                    if (!b.active) continue
                    val dx = b.x - a.x
                    val dz = b.z - a.z
                    val minDist = a.radius + b.radius
                    val distSq = dx * dx + dz * dz
                    if (distSq < minDist * minDist) {
                        val dist = sqrt(distSq).coerceAtLeast(0.0001f)
                        val nx = dx / dist
                        val nz = dz / dist
                        val overlap = minDist - dist
                        val invMassA = 1f / a.mass
                        val invMassB = 1f / b.mass
                        val totalInv = invMassA + invMassB

                        val corr = (overlap / totalInv) * 0.92f
                        a.x -= nx * corr * invMassA
                        a.z -= nz * corr * invMassA
                        b.x += nx * corr * invMassB
                        b.z += nz * corr * invMassB

                        val rvx = b.vx - a.vx
                        val rvz = b.vz - a.vz
                        val vn = rvx * nx + rvz * nz
                        if (vn < 0f) {
                            val e = min(a.restitution, b.restitution)
                            val jImp = -(1f + e) * vn / totalInv
                            a.vx -= jImp * nx * invMassA
                            a.vz -= jImp * nz * invMassA
                            b.vx += jImp * nx * invMassB
                            b.vz += jImp * nz * invMassB
                        }
                    }
                }
            }
        }
    }
}`,
  },
  {
    filename: 'CarromRulesEngine.kt',
    packagePath: 'com.carromroyale.game.engine/CarromRulesEngine.kt',
    description: 'ICF Carrom rules state machine: Queen cover verification, striker fouls, and non-overlapping coin return',
    code: `package com.carromroyale.game.engine

enum class QueenStatus {
    ON_BOARD, PENDING_COVER_P1, PENDING_COVER_P2, COVERED_P1, COVERED_P2
}

enum class GamePhase {
    STRIKER_PLACEMENT, AIMING, SHOT_EXECUTION, PIECES_MOVING,
    SHOT_EVALUATION, FOUL_RESOLUTION, TURN_TRANSITION, GAME_OVER
}

class CarromRulesEngine(private val physics: CarromPhysics) {
    fun evaluateShot(
        state: MatchState,
        pocketedTypes: List<PieceType>,
        pieces: List<PhysicsPiece>
    ): ShotEvaluationResult {
        val player = state.currentTurn
        val ownType = if (player == 1) PieceType.WHITE else PieceType.BLACK
        val strikerFoul = pocketedTypes.contains(PieceType.STRIKER)
        val queenPocketed = pocketedTypes.contains(PieceType.QUEEN)
        val ownCount = pocketedTypes.count { it == ownType }

        // Enforce striker penalty & Queen cover rules
        if (strikerFoul) {
            if (queenPocketed || state.isPendingCover(player)) {
                physics.returnPieceSafely(pieces, PieceType.QUEEN)
                state.queenStatus = QueenStatus.ON_BOARD
            }
            repeat(ownCount + 1) {
                physics.returnPieceSafely(pieces, ownType)
            }
            return ShotEvaluationResult(continuedTurn = false, hadFoul = true)
        }
        return ShotEvaluationResult(continuedTurn = ownCount > 0 || queenPocketed, hadFoul = false)
    }
}`,
  },
];
