package com.payuu.capture

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var codeInput: EditText
    private lateinit var sessionInput: EditText
    private lateinit var status: TextView
    private val projectionManager by lazy { getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager }

    private val permissionLauncher = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { permissions ->
        val camera = permissions[Manifest.permission.CAMERA] == true || ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        val mic = permissions[Manifest.permission.RECORD_AUDIO] == true || ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (!camera || !mic) {
            status.text = "Camera + microphone permission is required."
            return@registerForActivityResult
        }
        requestProjection()
    }

    private val projectionLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            status.text = "Screen capture was cancelled."
            return@registerForActivityResult
        }
        val serviceIntent = Intent(this, CaptureService::class.java).apply {
            putExtra(CaptureService.EXTRA_RESULT_CODE, result.resultCode)
            putExtra(CaptureService.EXTRA_PROJECTION_DATA, result.data)
            putExtra(CaptureService.EXTRA_SESSION, sessionInput.text.toString().trim())
            putExtra(CaptureService.EXTRA_CODE, codeInput.text.toString().trim().uppercase())
        }
        ContextCompat.startForegroundService(this, serviceIntent)
        status.text = "Screen permission granted. Connecting to Payuu Studio…"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 64, 48, 48)
        }
        val title = TextView(this).apply { text = "Payuu Capture • Android"; textSize = 24f }
        val help = TextView(this).apply { text = "Enter the pairing session and code from Payuu Studio. Then allow screen sharing." }
        sessionInput = EditText(this).apply { hint = "Session ID" }
        codeInput = EditText(this).apply { hint = "Pairing code"; inputType = 1 }
        val start = Button(this).apply { text = "Start Screen + Camera + Mic" }
        status = TextView(this).apply { text = "Ready"; textSize = 16f }
        start.setOnClickListener { beginCapture() }
        root.addView(title)
        root.addView(help)
        root.addView(sessionInput)
        root.addView(codeInput)
        root.addView(start)
        root.addView(status)
        setContentView(root)
    }

    private fun beginCapture() {
        if (sessionInput.text.isNullOrBlank() || codeInput.text.isNullOrBlank()) {
            status.text = "Enter both Session ID and pairing code."
            return
        }
        status.text = "Requesting camera + microphone…"
        val missing = buildList {
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) add(Manifest.permission.CAMERA)
            if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) add(Manifest.permission.RECORD_AUDIO)
        }
        if (missing.isNotEmpty()) permissionLauncher.launch(missing.toTypedArray()) else requestProjection()
    }

    private fun requestProjection() {
        status.text = "Requesting Android screen capture…"
        projectionLauncher.launch(projectionManager.createScreenCaptureIntent())
    }
}
