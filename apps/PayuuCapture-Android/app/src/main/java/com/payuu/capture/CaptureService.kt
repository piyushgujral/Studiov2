package com.payuu.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException

class CaptureService : Service() {
    companion object {
        const val EXTRA_RESULT_CODE = "projection_result_code"
        const val EXTRA_PROJECTION_DATA = "projection_data"
        const val EXTRA_SESSION = "session_id"
        const val EXTRA_CODE = "pairing_code"
        private const val CHANNEL_ID = "payuu_capture"
        private const val NOTIFICATION_ID = 1001
        private const val API_BASE = "https://payuu-remote-signaling.piyushgujral04.workers.dev"
        private val JSON = "application/json; charset=utf-8".toMediaType()
    }
    private val client = OkHttpClient()
    private val handler = Handler(Looper.getMainLooper())
    private var pcFactory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var eglBase: EglBase? = null
    private var screenCapturer: ScreenCapturerAndroid? = null
    private var cameraCapturer: CameraVideoCapturer? = null
    private var screenSurfaceHelper: SurfaceTextureHelper? = null
    private var cameraSurfaceHelper: SurfaceTextureHelper? = null
    private var screenSource: VideoSource? = null
    private var cameraSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var screenTrack: VideoTrack? = null
    private var cameraTrack: VideoTrack? = null
    private var micTrack: AudioTrack? = null
    private var sessionId = ""
    private var code = ""
    private var answerPolling = false
    private var dataChannel: DataChannel? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        val notification = NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("Payuu Capture").setContentText("Capturing screen, camera and microphone").setSmallIcon(android.R.drawable.presence_video_online).setOngoing(true).build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION) else startForeground(NOTIFICATION_ID, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (peer != null) return START_STICKY
        sessionId = intent?.getStringExtra(EXTRA_SESSION).orEmpty()
        code = intent?.getStringExtra(EXTRA_CODE).orEmpty().uppercase()
        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, -1) ?: -1
        val projectionData = if (Build.VERSION.SDK_INT >= 33) intent?.getParcelableExtra(EXTRA_PROJECTION_DATA, Intent::class.java) else @Suppress("DEPRECATION") intent?.getParcelableExtra(EXTRA_PROJECTION_DATA)
        if (sessionId.isBlank() || code.isBlank() || resultCode < 0 || projectionData == null) { stopSelf(); return START_NOT_STICKY }
        startCapture(projectionData)
        return START_STICKY
    }

    private fun startCapture(projectionData: Intent) {
        try {
            PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(applicationContext).setEnableInternalTracer(false).createInitializationOptions())
            eglBase = EglBase.create()
            val encoderFactory = DefaultVideoEncoderFactory(eglBase!!.eglBaseContext, true, true)
            val decoderFactory = DefaultVideoDecoderFactory(eglBase!!.eglBaseContext)
            pcFactory = PeerConnectionFactory.builder().setVideoEncoderFactory(encoderFactory).setVideoDecoderFactory(decoderFactory).createPeerConnectionFactory()
            createPeer()
            createScreenTrack(projectionData)
            createCameraTrack()
            createMicrophoneTrack()
            createMetadataChannel()
            createOffer()
        } catch (t: Throwable) { updateNotification("Capture failed: ${t.message ?: "unknown error"}"); stopCapture() }
    }

    private fun createPeer() {
        val iceServers = listOf(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        val config = PeerConnection.RTCConfiguration(iceServers).apply { bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE; rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE }
        peer = pcFactory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onSignalingChange(state: PeerConnection.SignalingState) = Unit
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) = Unit
            override fun onIceConnectionReceivingChange(receiving: Boolean) = Unit
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) = Unit
            override fun onIceCandidate(candidate: org.webrtc.IceCandidate) = Unit
            override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>) = Unit
            override fun onAddStream(stream: MediaStream) = Unit
            override fun onRemoveStream(stream: MediaStream) = Unit
            override fun onDataChannel(channel: DataChannel) = Unit
            override fun onRenegotiationNeeded() = Unit
            override fun onAddTrack(receiver: RtpReceiver, mediaStreams: Array<out MediaStream>) = Unit
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) { updateNotification("WebRTC: ${newState.name}") }
        })
    }

    private fun createScreenTrack(projectionData: Intent) {
        screenSource = pcFactory!!.createVideoSource(true)
        screenSurfaceHelper = SurfaceTextureHelper.create("PayuuScreenCapture", eglBase!!.eglBaseContext)
        screenCapturer = ScreenCapturerAndroid(projectionData, object : MediaProjection.Callback() { override fun onStop() { updateNotification("Android screen capture stopped") } })
        screenCapturer!!.initialize(screenSurfaceHelper, this, screenSource!!.capturerObserver)
        screenCapturer!!.startCapture(1280, 720, 30)
        screenTrack = pcFactory!!.createVideoTrack("payuu-screen-track", screenSource)
        screenTrack!!.setEnabled(true)
        peer!!.addTrack(screenTrack, listOf("payuu-screen"))
    }

    private fun createCameraTrack() {
        cameraSource = pcFactory!!.createVideoSource(false)
        cameraSurfaceHelper = SurfaceTextureHelper.create("PayuuCamera", eglBase!!.eglBaseContext)
        val enumerator = Camera2Enumerator(this)
        val names = enumerator.deviceNames
        val front = names.firstOrNull { enumerator.isFrontFacing(it) } ?: names.firstOrNull()
        if (front == null) return
        val capturer = enumerator.createCapturer(front, object : CameraVideoCapturer.CameraEventsHandler {
            override fun onCameraError(errorDescription: String) = updateNotification("Camera error: $errorDescription")
            override fun onCameraDisconnected() = updateNotification("Camera disconnected")
            override fun onCameraFreezed(error: String) = updateNotification("Camera frozen: $error")
            override fun onCameraOpening(cameraName: String) = Unit
            override fun onFirstFrameAvailable() = Unit
            override fun onCameraClosed() = Unit
        }) ?: return
        cameraCapturer = capturer
        capturer.initialize(cameraSurfaceHelper, this, cameraSource!!.capturerObserver)
        capturer.startCapture(1280, 720, 30)
        cameraTrack = pcFactory!!.createVideoTrack("payuu-camera-track", cameraSource)
        cameraTrack!!.setEnabled(true)
        peer!!.addTrack(cameraTrack, listOf("payuu-camera"))
    }

    private fun createMicrophoneTrack() {
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googAutoGainControl", "true"))
        }
        audioSource = pcFactory!!.createAudioSource(constraints)
        micTrack = pcFactory!!.createAudioTrack("payuu-microphone-track", audioSource)
        micTrack!!.setEnabled(true)
        peer!!.addTrack(micTrack, listOf("payuu-camera"))
    }

    private fun createMetadataChannel() {
        dataChannel = peer!!.createDataChannel("payuu-media-meta", DataChannel.Init())
        dataChannel?.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) = Unit
            override fun onStateChange() { if (dataChannel?.state() == DataChannel.State.OPEN) sendMetadata() }
            override fun onMessage(buffer: DataChannel.Buffer) {
                try {
                    val bytes = ByteArray(buffer.data.remaining())
                    buffer.data.get(bytes)
                    val command = JSONObject(String(bytes, Charsets.UTF_8))
                    if (command.optString("type") == "payuu-capture-command" && command.optString("command") == "set-microphone") {
                        val enabled = command.optBoolean("enabled", true)
                        micTrack?.setEnabled(enabled)
                        updateNotification(if (enabled) "Microphone ON • screen + camera connected" else "Microphone OFF • screen + camera connected")
                    }
                } catch (_) {}
            }
        })
    }

    private fun sendMetadata() {
        val meta = JSONObject().apply {
            put("type", "payuu-media-meta")
            put("screenStreamId", "payuu-screen")
            put("cameraStreamId", "payuu-camera")
            put("screenTrackIds", org.json.JSONArray().put("payuu-screen-track"))
            put("cameraTrackIds", org.json.JSONArray().put("payuu-camera-track"))
            put("hasScreen", true)
            put("hasCamera", cameraTrack != null)
            put("hasMicrophone", micTrack != null)
            put("hasScreenAudio", false)
            put("platform", "android-native")
        }
        dataChannel?.send(DataChannel.Buffer(java.nio.ByteBuffer.wrap(meta.toString().toByteArray(Charsets.UTF_8)), false))
    }

    private fun createOffer() {
        peer!!.createOffer(object : SdpObserver {
            override fun onCreateSuccess(desc: SessionDescription) {
                peer!!.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() { waitForIceAndSend(desc) }
                    override fun onCreateSuccess(d: SessionDescription) = Unit
                    override fun onCreateFailure(error: String) = fail(error)
                    override fun onSetFailure(error: String) = fail(error)
                }, desc)
            }
            override fun onSetSuccess() = Unit
            override fun onCreateFailure(error: String) = fail(error)
            override fun onSetFailure(error: String) = fail(error)
        }, MediaConstraints())
    }

    private fun waitForIceAndSend(desc: SessionDescription) {
        val started = System.currentTimeMillis()
        val check = object : Runnable {
            override fun run() {
                if (peer?.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE || System.currentTimeMillis() - started > 5000) postOffer(desc.description) else handler.postDelayed(this, 100)
            }
        }
        handler.post(check)
    }

    private fun postOffer(sdp: String) {
        updateNotification("Sending Android screen offer…")
        val body = JSONObject().put("sdp", sdp).toString().toRequestBody(JSON)
        val request = Request.Builder().url("$API_BASE/api/remote/session/${java.net.URLEncoder.encode(sessionId, "UTF-8")}/offer?code=${java.net.URLEncoder.encode(code, "UTF-8")}").post(body).build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = fail(e.message ?: "Signaling request failed")
            override fun onResponse(call: Call, response: Response) {
                val success = response.isSuccessful
                response.close()
                if (!success) fail("Offer rejected") else { updateNotification("Android screen + camera + mic connected"); pollAnswer() }
            }
        })
    }

    private fun pollAnswer() {
        if (answerPolling) return
        answerPolling = true
        val poll = object : Runnable {
            override fun run() {
                if (!answerPolling) return
                val request = Request.Builder().url("$API_BASE/api/remote/session/${java.net.URLEncoder.encode(sessionId, "UTF-8")}/answer?code=${java.net.URLEncoder.encode(code, "UTF-8")}").get().build()
                client.newCall(request).enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) { handler.postDelayed(poll, 1000) }
                    override fun onResponse(call: Call, response: Response) {
                        val text = response.body?.string().orEmpty()
                        val success = response.isSuccessful
                        response.close()
                        if (success) {
                            try {
                                val sdp = JSONObject(text).optString("sdp")
                                if (sdp.isNotBlank()) {
                                    peer?.setRemoteDescription(object : SdpObserver {
                                        override fun onSetSuccess() { updateNotification("Payuu Studio connected") }
                                        override fun onCreateSuccess(d: SessionDescription) = Unit
                                        override fun onCreateFailure(error: String) = fail(error)
                                        override fun onSetFailure(error: String) = fail(error)
                                    }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
                                    answerPolling = false
                                    return
                                }
                            } catch (t: Throwable) { fail(t.message ?: "Invalid answer") }
                        }
                        handler.postDelayed(poll, 1000)
                    }
                })
            }
        }
        handler.post(poll)
    }

    private fun fail(message: String) = updateNotification("Payuu Capture: $message")

    private fun updateNotification(text: String) {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID).setContentTitle("Payuu Capture").setContentText(text).setSmallIcon(android.R.drawable.presence_video_online).setOngoing(true).build()
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Payuu Capture", NotificationManager.IMPORTANCE_LOW))
        }
    }

    private fun stopCapture() {
        answerPolling = false
        handler.removeCallbacksAndMessages(null)
        try { cameraCapturer?.stopCapture() } catch (_: Throwable) {}
        try { screenCapturer?.stopCapture() } catch (_: Throwable) {}
        cameraSurfaceHelper?.dispose()
        screenSurfaceHelper?.dispose()
        peer?.close()
        peer = null
        cameraSource?.dispose()
        screenSource?.dispose()
        audioSource?.dispose()
        cameraCapturer = null
        screenCapturer = null
        cameraTrack = null
        screenTrack = null
        micTrack = null
        eglBase?.release()
        eglBase = null
        pcFactory?.dispose()
        pcFactory = null
        stopSelf()
    }

    override fun onDestroy() { stopCapture(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
